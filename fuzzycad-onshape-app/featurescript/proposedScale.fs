// FuzzyCAD "Proposed Scale" custom feature -- v3.
// v1 guessed a dedicated opScale() op -- confirmed dead live ("Function
// opScale with 3 argument(s) not found"). v2 tried building a scaling
// Transform via identityMatrix(3) * scale -- never live-tested.
//
// v3 replaces that guess with scaleNonuniformly(sx, sy, sz, point),
// confirmed real and working in a real FeatureScript source the user
// found (used there as: "opTransform(context, id, { "bodies": ...,
// "transform": scaleNonuniformly(sx, sy, sz, evVertexPoint(...)) })").
// Much better grounded than the identityMatrix guess. Since opPattern's
// own transforms don't have to be rigid (Onshape's own docs, and
// confirmed working for the rotation case), passing
// scaleNonuniformly(...) directly as one of opPattern's "transforms"
// should work the same way -- untested, but this is the most
// well-supported version of this file yet.
//
// POSITIVE_REAL_BOUNDS (confirmed via real isReal() usage examples
// elsewhere) and evVertexPoint (now ALSO independently confirmed real
// in that same reference source) are unchanged from v2.
//
// "accepted" (hidden, same mechanism as proposedMove.fs): while false,
// this feature only ever previews -- the original body is untouched, a
// duplicate gets scaled instead. The right panel patches this to true
// on Accept, which makes this SAME feature instance apply the scale to
// the REAL body instead of a throwaway copy.
//
// Pending-state preview matches proposedMove.fs's hand-drawn
// sketchy-wireframe treatment: the scaled duplicate's edges (captured
// via qOwnedByBody, same topology as the original since scaling doesn't
// add/remove edges) get a 2-4-stroke hand-drawn overlay, then the
// duplicate is deleted -- only the sketchy strokes remain.
// handDrawEdgeSketchy/RandomNumberFunction/idToNum/lcprng below are
// copied verbatim from proposedMove.fs's confirmed-working helpers.
//
// Scale dimension arrow: drawDimensionArrow() is proposedMove.fs's
// drawAxisArrow() generalized to take a prebuilt label string. Points
// from the pivot toward the SCALED position of the body's farthest
// bounding-box corner (an arbitrary but deterministic representative
// point -- not necessarily where any real geometry ends up, just a
// visual "how far did this direction stretch" indicator), labeled with
// the scale factor itself rather than a distance.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Scale" }
export const fuzzycadProposedScale = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to scale", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Scale origin", "Filter" : EntityType.VERTEX }
        definition.originPoint is Query;

        annotation { "Name" : "Scale factor" }
        isReal(definition.scaleFactor, POSITIVE_REAL_BOUNDS);

        // Controlled internally by the FuzzyCAD right panel.
        // The normal Feature dialog will not show this parameter.
        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        const originalBody = definition.body;

        const pivot = evVertexPoint(context, { "vertex" : definition.originPoint });
        const scaleTransform = scaleNonuniformly(
                definition.scaleFactor,
                definition.scaleFactor,
                definition.scaleFactor,
                pivot
        );

        // ACCEPTED STATE: scale the real body directly, no
        // duplicate/preview machinery at all, then stop.
        if (definition.accepted)
        {
            opTransform(context, id + "acceptedScale", {
                    "bodies" : originalBody,
                    "transform" : scaleTransform
            });

            return;
        }

        // PENDING STATE below (unchanged).

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [scaleTransform],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        const chordLength = 3 * millimeter;
        const variance = 0.5 * millimeter;

        var rnd = RandomNumberFunction(id);
        var allSketchyStrokes = qNothing();
        var edgeIndex = 0;

        for (var edgeQuery in evaluateQuery(context, qOwnedByBody(qEverything(EntityType.EDGE), proposedBody)))
        {
            const strokes = handDrawEdgeSketchy(
                    context,
                    id + ("sketchyEdge" ~ toString(edgeIndex)),
                    chordLength,
                    variance,
                    rnd,
                    edgeQuery
            );
            allSketchyStrokes = qUnion(allSketchyStrokes, strokes);
            edgeIndex += 1;
        }

        if (!isQueryEmpty(context, allSketchyStrokes))
        {
            opCreateCompositePart(context, id + "sketchyComposite", {
                    "bodies" : allSketchyStrokes,
                    "closed" : false
            });

            setProperty(context, {
                    "entities" : qCreatedBy(id + "sketchyComposite", EntityType.BODY),
                    "propertyType" : PropertyType.APPEARANCE,
                    "value" : color(0.05, 0.55, 1.0, 1.0)
            });
        }

        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const farCorner = bbox.maxCorner;
        const scaledOffset = (farCorner - pivot) * definition.scaleFactor;
        const dimensionColor = color(0.05, 0.55, 1.0, 1.0);

        drawDimensionArrow(
                context,
                id + "scaleArrow",
                pivot,
                scaledOffset,
                "Scale: ×" ~ toString(round(definition.scaleFactor, 2)),
                dimensionColor
        );

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

//////////////////////////////////////////////////////////////////////
//
// FILLED DIMENSION ARROW (proposedMove.fs's drawAxisArrow, generalized
// to take a prebuilt label string instead of an axis name + auto-built
// "X: N mm" text -- everything else, including the STILL-UNCONFIRMED-
// LIVE filled-2D-arrow-via-opExtractSurface construction, is unchanged)
//
//////////////////////////////////////////////////////////////////////

function drawDimensionArrow(
    context is Context,
    id is Id,
    start is Vector,
    axisOffset is Vector,
    labelText is string,
    arrowColor is map)
{
    const distance = norm(axisOffset);
    const distanceMm = distance / millimeter;

    if (distanceMm < 0.001)
    {
        return;
    }

    const direction = normalize(axisOffset);

    const reference = (abs(direction[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
    const planeNormal = normalize(cross(direction, reference));
    const arrowPlane = plane(start, planeNormal, direction);

    const shaftWidth = min(max(distanceMm * 0.12, 2.5), 7) * millimeter;
    const headLength = min(distanceMm * 0.5, 24) * millimeter;
    const headWidth = shaftWidth * 4.5;

    const arrowSketch = newSketchOnPlane(context, id + "arrowSketch", { "sketchPlane" : arrowPlane });

    skLineSegment(arrowSketch, "headUpper", {
            "start" : vector(distance, 0 * meter),
            "end" : vector(distance - headLength, headWidth / 2)
    });
    skLineSegment(arrowSketch, "headLower", {
            "start" : vector(distance, 0 * meter),
            "end" : vector(distance - headLength, -headWidth / 2)
    });
    skLineSegment(arrowSketch, "headUpperTransition", {
            "start" : vector(distance - headLength, headWidth / 2),
            "end" : vector(distance - headLength, shaftWidth / 2)
    });
    skLineSegment(arrowSketch, "headLowerTransition", {
            "start" : vector(distance - headLength, -headWidth / 2),
            "end" : vector(distance - headLength, -shaftWidth / 2)
    });
    skLineSegment(arrowSketch, "shaftUpper", {
            "start" : vector(distance - headLength, shaftWidth / 2),
            "end" : vector(0 * meter, shaftWidth / 2)
    });
    skLineSegment(arrowSketch, "shaftLower", {
            "start" : vector(distance - headLength, -shaftWidth / 2),
            "end" : vector(0 * meter, -shaftWidth / 2)
    });
    skLineSegment(arrowSketch, "shaftBack", {
            "start" : vector(0 * meter, shaftWidth / 2),
            "end" : vector(0 * meter, -shaftWidth / 2)
    });

    skSolve(arrowSketch);

    opExtractSurface(context, id + "arrowSurface", {
            "faces" : qSketchRegion(id + "arrowSketch"),
            "offset" : 0 * meter,
            "useFacesAroundToTrimOffset" : false
    });

    opDeleteBodies(context, id + "deleteArrowSketch", {
            "entities" : qCreatedBy(id + "arrowSketch")
    });

    setProperty(context, {
            "entities" : qCreatedBy(id + "arrowSurface", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : arrowColor
    });

    const midPoint = start + axisOffset / 2;
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : arrowPlane });
    const labelUv = worldToPlane(arrowPlane, midPoint);
    const labelOffset = headWidth / 2 + 1.5 * millimeter;
    const textHeight = 2.5 * millimeter;

    skText(labelSketch, "labelText", {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - textHeight * 1.5, labelUv[1] + labelOffset),
            "secondCorner" : vector(labelUv[0] + textHeight * 1.5, labelUv[1] + labelOffset + textHeight)
    });

    skSolve(labelSketch);
}

//////////////////////////////////////////////////////////////////////
//
// HAND-DRAWN EDGE (copied verbatim from proposedMove.fs)
//
//////////////////////////////////////////////////////////////////////

function handDrawEdgeSketchy(
    context is Context,
    id is Id,
    chordLength is ValueWithUnits,
    variance is ValueWithUnits,
    rnd is function,
    edgeQuery is Query)
{
    var edgeLength = evLength(context, { "entities" : edgeQuery });
    var pointCount = ceil(max(edgeLength / chordLength, 5));

    var tangents = @evEdgeTangentLines(context, {
            "edge" : edgeQuery,
            "parameters" : range(0.0, 1.0, pointCount)
    });

    var rawRandom = rnd() % 100;
    var numStrokes = 2 + floor(rawRandom / 33);

    var strokesQuery = qNothing();

    for (var strokeIndex = 0; strokeIndex < numStrokes; strokeIndex += 1)
    {
        var newPoints = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            // .origin already carries length units -- do NOT multiply by meter.
            var basePt = tangents[i].origin as Vector;

            var s1 = rnd();
            var s2 = rnd();

            var jitterFactor = 0.5 + ((s2 % 100) / 100.0) * 0.5;

            var offsetX = 2 * ((((s1 + i * 17 + strokeIndex * 29) % 100) / 100.0) - 0.5) * variance * jitterFactor;
            var offsetY = 2 * ((((s1 + i * 23 + strokeIndex * 37) % 100) / 100.0) - 0.5) * variance * jitterFactor;
            var offsetZ = 2 * ((((s1 + i * 31 + strokeIndex * 41) % 100) / 100.0) - 0.5) * variance * jitterFactor;

            var perturbed = basePt;
            perturbed[0] += offsetX;
            perturbed[1] += offsetY;
            perturbed[2] += offsetZ;

            newPoints[i] = perturbed;
        }

        const strokeId = id + ("_stroke" ~ toString(strokeIndex));
        opFitSpline(context, strokeId, { "points" : newPoints });
        strokesQuery = qUnion(strokesQuery, qCreatedBy(strokeId, EntityType.BODY));
    }

    return strokesQuery;
}

//////////////////////////////////////////////////////////////////////
//
// RANDOM NUMBER GENERATOR (copied verbatim from proposedMove.fs)
//
//////////////////////////////////////////////////////////////////////

function RandomNumberFunction(id) returns function
{
    return lcprng(idToNum(id[0]));
}

function idToNum(input is string) returns number
{
    const chrMap = {
            'A' : 0, 'B' : 1, 'C' : 2, 'D' : 3, 'E' : 4, 'F' : 5, 'G' : 6,
            'H' : 7, 'I' : 8, 'J' : 9, 'K' : 10, 'L' : 11, 'M' : 12, 'N' : 13,
            'O' : 14, 'P' : 15, 'Q' : 16, 'R' : 17, 'S' : 18, 'T' : 19, 'U' : 20,
            'V' : 21, 'W' : 22, 'X' : 23, 'Y' : 24, 'Z' : 25,
            'a' : 26, 'b' : 27, 'c' : 28, 'd' : 29, 'e' : 30, 'f' : 31, 'g' : 32,
            'h' : 33, 'i' : 34, 'j' : 35, 'k' : 36, 'l' : 37, 'm' : 38, 'n' : 39,
            'o' : 40, 'p' : 41, 'q' : 42, 'r' : 43, 's' : 44, 't' : 45, 'u' : 46,
            'v' : 47, 'w' : 48, 'x' : 49, 'y' : 50, 'z' : 51,
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

function lcprng(seed is number) returns function
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
