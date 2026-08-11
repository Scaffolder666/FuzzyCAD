FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

// Needs Input Chamfer
// Sparse/incomplete geometry + very faint boundary.
// Engineering leader remains clean; uncertainty is expressed by C = ?.

annotation {
    "Feature Type Name" : "FuzzyCAD Needs Input Chamfer",
    "Manipulator Change Function" : "fuzzycadNeedsInputChamferManipulatorChange"
}
export const fuzzycadNeedsInputChamfer = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Edge to chamfer", "Filter" : EntityType.EDGE }
        definition.edge is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, BLEND_BOUNDS);

        annotation { "Name" : "Width needs input", "Default" : true }
        definition.widthNeedsInput is boolean;

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

        // Derived from the edge, not a separate selector -- an unfilled
        // second "pick the body too" selector was silently leaving this
        // feature with no preview geometry at all (see needsInputFillet.fs,
        // which uses the same qOwnerBody derivation for the identical
        // reason).
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

        // NEEDS INPUT visual language: the same coherent, full-coverage
        // hand-drawn outline Proposed uses, just recolored black -- the old
        // sparse/incomplete look is retired. Uncertainty is now signaled by
        // the grey-faded original + red chamfer callout + warning icon
        // instead of by the candidate geometry itself looking unfinished.
        drawNeedsInputSketch(context, id + "needsSketch", proposedBody);

        // Makes the mark impossible to miss at a glance.
        drawWarningIcon(context, id + "warningIcon", proposedBody);

        const ref =
            (abs(tangentDir[2]) < 0.9)
            ? vector(0, 0, 1)
            : vector(0, 1, 0);

        const calloutDir =
            normalize(cross(tangentDir, ref));

        const leaderLength =
            max(definition.width * 5, 22 * millimeter);

        const labelText =
            definition.widthNeedsInput
            ? "C = ?"
            : "C = " ~ toString(round(definition.width / millimeter, 1)) ~ " mm";

        drawEngineeringLeader(
            context,
            id + "chamferLeader",
            midpoint,
            calloutDir,
            leaderLength,
            labelText
        );

        addManipulators(context, id, {
                "widthManipulator" : linearManipulator({
                        "base" : midpoint,
                        "direction" : calloutDir,
                        "offset" : definition.width,
                        "primaryParameterId" : "width"
                })
        });

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

export function fuzzycadNeedsInputChamferManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map)
returns map
{
    if (newManipulators["widthManipulator"] != undefined)
    {
        definition.width =
            newManipulators["widthManipulator"].offset;
    }

    return definition;
}


//////////////////////////////////////////////////////////////////////
//
// COHERENT BLACK OUTLINE (same structure as Proposed's own
// drawProposedSketch/handDrawProposedEdge -- full-coverage, low-jitter,
// 2 passes per edge -- just recolored black instead of blue. Needs
// Input no longer looks visually "unfinished"; the mark itself is
// signaled by the red chamfer callout + warning icon instead of by
// sparse/incomplete candidate geometry.
//
//////////////////////////////////////////////////////////////////////

function drawNeedsInputSketch(
    context is Context,
    id is Id,
    body is Query)
{
    const chordLength = 3.2 * millimeter;
    const variance = 0.38 * millimeter;
    const needsInputColor = color(0.08, 0.08, 0.08, 0.92);

    var rnd = RandomNumberFunctionWithSalt(id, "needsInputOutline");
    var allStrokes = qNothing();

    const edges = qOwnedByBody(qEverything(EntityType.EDGE), body);
    var edgeIndex = 0;

    for (var edgeQuery in evaluateQuery(context, edges))
    {
        const strokes = handDrawCoherentEdge(
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
            id + "faceFillComposite",
            {
                "bodies" : allStrokes,
                "closed" : false
            }
        );

        setProperty(
            context,
            {
                "entities" : qCreatedBy(id + "faceFillComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : needsInputColor
            }
        );
    }
}

function handDrawCoherentEdge(
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

    const tangents = @evEdgeTangentLines(
        context,
        {
            "edge" : edgeQuery,
            "parameters" : range(0.0, 0.995, pointCount)
        }
    );

    var result = qNothing();

    for (var strokeIndex = 0; strokeIndex < 2; strokeIndex += 1)
    {
        var pts = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            var p = tangents[i].origin as Vector;
            const s = rnd();
            const factor = 0.55 + ((rnd() % 100) / 100.0) * 0.35;

            p[0] += 2 * (((s + i * 17 + strokeIndex * 29) % 100) / 100.0 - 0.5) * variance * factor;
            p[1] += 2 * (((s + i * 23 + strokeIndex * 37) % 100) / 100.0 - 0.5) * variance * factor;
            p[2] += 2 * (((s + i * 31 + strokeIndex * 41) % 100) / 100.0 - 0.5) * variance * factor;

            pts[i] = p;
        }

        const strokeId = id + ("stroke" ~ toString(strokeIndex));
        opFitSpline(context, strokeId, { "points" : pts });
        result = qUnion(result, qCreatedBy(strokeId, EntityType.BODY));
    }

    return result;
}

//////////////////////////////////////////////////////////////////////
//
// WARNING ICON
//
// A filled red triangle with a "!" mark, floated above the candidate
// body's own bounding box -- makes a Needs Input mark impossible to
// miss at a glance, on top of (not instead of) the red engineering
// callout the feature already draws.
//
//////////////////////////////////////////////////////////////////////

function drawWarningIcon(
    context is Context,
    id is Id,
    body is Query)
{
    const bbox = evBox3d(context, { "topology" : body, "tight" : true });
    const size = min(max(norm(bbox.maxCorner - bbox.minCorner) * 0.12, 8 * millimeter), 20 * millimeter);
    const half = size / 2;

    const center =
        vector(
            (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
            (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
            bbox.maxCorner[2]
        ) + vector(0, 0, 1) * (size * 0.9);

    const iconColor = color(0.90, 0.10, 0.08, 1.0);
    const iconPlane = plane(center, vector(0, 1, 0));
    const uv = worldToPlane(iconPlane, center);

    const triSketch = newSketchOnPlane(context, id + "triSketch", { "sketchPlane" : iconPlane });

    skLineSegment(triSketch, "side1", {
            "start" : vector(uv[0], uv[1] + half),
            "end" : vector(uv[0] - half * 0.95, uv[1] - half * 0.75)
    });
    skLineSegment(triSketch, "side2", {
            "start" : vector(uv[0] - half * 0.95, uv[1] - half * 0.75),
            "end" : vector(uv[0] + half * 0.95, uv[1] - half * 0.75)
    });
    skLineSegment(triSketch, "side3", {
            "start" : vector(uv[0] + half * 0.95, uv[1] - half * 0.75),
            "end" : vector(uv[0], uv[1] + half)
    });

    skSolve(triSketch);

    opExtractSurface(context, id + "triSurface", {
            "faces" : qSketchRegion(id + "triSketch"),
            "offset" : 0 * meter,
            "useFacesAroundToTrimOffset" : false
    });

    opDeleteBodies(context, id + "deleteTriSketch", {
            "entities" : qCreatedBy(id + "triSketch")
    });

    setProperty(context, {
            "entities" : qCreatedBy(id + "triSurface", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : iconColor
    });

    const textSketch = newSketchOnPlane(context, id + "iconText", { "sketchPlane" : iconPlane });
    const textSize = size * 0.30;

    skText(textSketch, "exclamation", {
            "text" : "!",
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(uv[0] - textSize * 0.3, uv[1] - half * 0.55),
            "secondCorner" : vector(uv[0] + textSize * 0.3, uv[1] - half * 0.55 + textSize * 1.5)
    });

    skSolve(textSketch);
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

function RandomNumberFunctionWithSalt(id, salt)
returns function
{
    const baseSeed = idToNum(id[0]);
    const saltSeed = idToNum(salt);
    return lcprng((baseSeed + saltSeed * 97) % 100000);
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

