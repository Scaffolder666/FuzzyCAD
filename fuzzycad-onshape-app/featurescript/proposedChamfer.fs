FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

// Proposed Chamfer
// Geometry stays coherent/provisional in blue.
// Engineering callout is clean red and points back to the edited edge.

annotation { "Feature Type Name" : "FuzzyCAD Proposed Chamfer" }
export const fuzzycadProposedChamfer = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Edge to chamfer", "Filter" : EntityType.EDGE }
        definition.edge is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, BLEND_BOUNDS);

        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        if (isQueryEmpty(context, definition.edge))
        {
            return;
        }

        // Derived from the edge, not a separate selector -- matches
        // proposedFillet.fs/needsInputChamfer.fs's qOwnerBody derivation,
        // which avoids a second manual pick silently leaving this feature
        // with no preview geometry at all when it's skipped.
        const originalBody = qOwnerBody(definition.edge);
        const edgeLine = evEdgeTangentLine(context, {
                "edge" : definition.edge,
                "parameter" : 0.5
        });
        const midpoint = edgeLine.origin;
        const tangentDir = edgeLine.direction;

        if (definition.accepted)
        {
            opChamfer(context, id + "acceptedChamfer", {
                    "entities" : definition.edge,
                    "chamferType" : ChamferType.EQUAL_OFFSETS,
                    "width" : definition.width,
                    "tangentPropagation" : true
            });
            return;
        }

        const trackedSelection = startTracking(context, definition.edge);

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody =
            qPatternInstances(id + "duplicate", "proposed", EntityType.BODY);

        const copiedSelection =
            qOwnedByBody(trackedSelection, proposedBody);

        if (isQueryEmpty(context, copiedSelection))
        {
            throw regenError(
                "Could not track the selected chamfer edge onto the proposal copy.",
                definition.edge
            );
        }

        opChamfer(context, id + "previewChamfer", {
                "entities" : copiedSelection,
                "chamferType" : ChamferType.EQUAL_OFFSETS,
                "width" : definition.width,
                "tangentPropagation" : true
        });

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        drawProposedSketch(context, id + "proposalSketch", proposedBody);

        const ref =
            (abs(tangentDir[2]) < 0.9)
            ? vector(0, 0, 1)
            : vector(0, 1, 0);

        const calloutDir =
            normalize(cross(tangentDir, ref));

        const leaderLength =
            max(definition.width * 5, 22 * millimeter);

        drawEngineeringLeader(
            context,
            id + "chamferLeader",
            midpoint,
            calloutDir,
            leaderLength,
            "C = " ~ toString(round(definition.width / millimeter, 1)) ~ " mm"
        );

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });


//////////////////////////////////////////////////////////////////////
// COHERENT PROPOSED GEOMETRY
//////////////////////////////////////////////////////////////////////

function drawProposedSketch(
    context is Context,
    id is Id,
    body is Query)
{
    const chordLength = 3.2 * millimeter;
    const variance = 0.38 * millimeter;
    const proposedColor = color(0.20, 0.52, 0.95, 0.92);

    var rnd = RandomNumberFunction(id);
    var allStrokes = qNothing();

    const edges = qOwnedByBody(qEverything(EntityType.EDGE), body);
    var edgeIndex = 0;

    for (var edgeQuery in evaluateQuery(context, edges))
    {
        const strokes = handDrawProposedEdge(
            context,
            id + ("edge" ~ toString(edgeIndex)),
            chordLength,
            variance,
            rnd,
            edgeQuery
        );

        allStrokes = qUnion(allStrokes, strokes);
        edgeIndex += 1;
    }

    if (!isQueryEmpty(context, allStrokes))
    {
        opCreateCompositePart(
            context,
            id + "composite",
            {
                "bodies" : allStrokes,
                "closed" : false
            }
        );

        setProperty(
            context,
            {
                "entities" : qCreatedBy(id + "composite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : proposedColor
            }
        );
    }
}

function handDrawProposedEdge(
    context is Context,
    id is Id,
    chordLength is ValueWithUnits,
    variance is ValueWithUnits,
    rnd is function,
    edgeQuery is Query)
returns Query
{
    const edgeLength = evLength(context, { "entities" : edgeQuery });
    const pointCount = ceil(max(edgeLength / chordLength, 5));

    // Jitter capped to a fraction of the edge's OWN length -- a short
    // edge on a small/complex area otherwise gets the same absolute
    // wobble as a long edge on a flat face, which can push a stroke
    // past the actual silhouette of the geometry.
    const maxJitter = min(variance, edgeLength * 0.05);

    const tangents = @evEdgeTangentLines(
        context,
        {
            "edge" : edgeQuery,
            "parameters" : range(0.0, 0.995, pointCount)
        }
    );

    var result = qNothing();

    // Proposed is coherent: always 2 passes, low jitter, full coverage.
    for (var strokeIndex = 0; strokeIndex < 2; strokeIndex += 1)
    {
        var pts = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            const p0 = tangents[i].origin as Vector;
            const tangentDir = normalize(tangents[i].direction as Vector);

            // Jitter only WITHIN the plane perpendicular to the edge's
            // own tangent, never along it -- along-tangent jitter can
            // push a point past its neighbor on a tightly curved edge,
            // making the fitted spline double back on itself.
            const ref = (abs(tangentDir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
            const perp1 = normalize(cross(tangentDir, ref));
            const perp2 = cross(tangentDir, perp1);

            const s = rnd();
            const factor = 0.55 + ((rnd() % 100) / 100.0) * 0.35;
            const amount = maxJitter * factor;

            const offset1 = 2 * (((s + i * 17 + strokeIndex * 29) % 100) / 100.0 - 0.5) * amount;
            const offset2 = 2 * (((s + i * 23 + strokeIndex * 37) % 100) / 100.0 - 0.5) * amount;

            pts[i] = p0 + perp1 * offset1 + perp2 * offset2;
        }

        const strokeId = id + ("stroke" ~ toString(strokeIndex));
        opFitSpline(context, strokeId, { "points" : pts });
        result = qUnion(result, qCreatedBy(strokeId, EntityType.BODY));
    }

    return result;
}
function drawEngineeringLeader(
    context is Context,
    id is Id,
    anchorPoint is Vector,
    direction is Vector,
    leaderLength is ValueWithUnits,
    labelText is string)
{
    if (leaderLength / millimeter < 0.001)
    {
        return;
    }

    const dir = normalize(direction);
    const ref = (abs(dir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
    const side = normalize(cross(dir, ref));
    const side2 = normalize(cross(dir, side));

    // Arrow points TO the edited edge/feature.
    const labelPoint = anchorPoint + dir * leaderLength;
    const arrowColor = color(0.88, 0.16, 0.12, 1.0);
    const headLength = min(max(leaderLength * 0.20, 4 * millimeter), 10 * millimeter);
    const headWidth = min(max(leaderLength * 0.09, 2.5 * millimeter), 6 * millimeter);

    var bodies = qNothing();

    opFitSpline(
        context,
        id + "leader",
        { "points" : [labelPoint, anchorPoint] }
    );

    bodies = qUnion(
        bodies,
        qCreatedBy(id + "leader", EntityType.BODY)
    );

    const headBase = anchorPoint + dir * headLength;
    const dirs = [side, -side, side2, -side2];

    for (var i = 0; i < 4; i += 1)
    {
        const wingId = id + ("wing" ~ toString(i));
        opFitSpline(
            context,
            wingId,
            {
                "points" : [
                    anchorPoint,
                    headBase + dirs[i] * headWidth
                ]
            }
        );
        bodies = qUnion(
            bodies,
            qCreatedBy(wingId, EntityType.BODY)
        );
    }

    opCreateCompositePart(
        context,
        id + "composite",
        {
            "bodies" : bodies,
            "closed" : false
        }
    );

    setProperty(
        context,
        {
            "entities" : qCreatedBy(id + "composite", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : arrowColor
        }
    );

    const textPoint = labelPoint + side2 * (4 * millimeter);
    const textPlane =
        plane(
            textPoint + side * (0.02 * millimeter),
            side
        );

    const textUv = worldToPlane(textPlane, textPoint);
    const textSketch =
        newSketchOnPlane(
            context,
            id + "labelSketch",
            { "sketchPlane" : textPlane }
        );

    const textSize = 3.6 * millimeter;

    skText(
        textSketch,
        "label",
        {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" :
                vector(
                    textUv[0] - 2.2 * textSize,
                    textUv[1] - textSize
                ),
            "secondCorner" :
                vector(
                    textUv[0] + 2.2 * textSize,
                    textUv[1] + textSize
                )
        }
    );

    skSolve(textSketch);
}
function RandomNumberFunction(id)
returns function
{
    return lcprng(idToNum(id[0]));
}

function idToNum(input is string)
returns number
{
    const chrMap =
    {
        'A' : 0, 'B' : 1, 'C' : 2, 'D' : 3, 'E' : 4, 'F' : 5, 'G' : 6, 'H' : 7,
        'I' : 8, 'J' : 9, 'K' : 10, 'L' : 11, 'M' : 12, 'N' : 13, 'O' : 14, 'P' : 15,
        'Q' : 16, 'R' : 17, 'S' : 18, 'T' : 19, 'U' : 20, 'V' : 21, 'W' : 22, 'X' : 23,
        'Y' : 24, 'Z' : 25,
        'a' : 26, 'b' : 27, 'c' : 28, 'd' : 29, 'e' : 30, 'f' : 31, 'g' : 32, 'h' : 33,
        'i' : 34, 'j' : 35, 'k' : 36, 'l' : 37, 'm' : 38, 'n' : 39, 'o' : 40, 'p' : 41,
        'q' : 42, 'r' : 43, 's' : 44, 't' : 45, 'u' : 46, 'v' : 47, 'w' : 48, 'x' : 49,
        'y' : 50, 'z' : 51,
        '_' : 99, '-' : 98
    };

    var out is string = "";

    for (var char in splitIntoCharacters(input))
    {
        var res = match(char, REGEX_NUMBER);

        if (res.hasMatch)
        {
            out = out ~ toString(res.captures[0]);
        }
        else
        {
            out = out ~ toString(chrMap[char]);
        }
    }

    return stringToNumber(out) % 100000;
}

function lcprng(seed is number)
returns function
{
    const a = 1103515245;
    const c = 12345;
    const m = 2^31;

    var state = new box(seed);

    return function()
    {
        state[] = (a * state[] + c) % m;
        return state[];
    };
}

