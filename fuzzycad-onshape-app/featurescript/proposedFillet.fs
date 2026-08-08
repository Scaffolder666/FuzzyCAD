// FuzzyCAD "Proposed Fillet" custom feature -- built from pieces verified
// live in Onshape's editor across several rounds:
//   1. opPattern() duplicates a body while leaving the original untouched
//      (confirmed: Parts count went from 2 to 4 after two test instances).
//   2. A specific edge selected on the ORIGINAL body can be located on the
//      duplicate via evEdgeTangentLine's midpoint + qClosestTo() against
//      qCreatedBy(id + "duplicate", EntityType.EDGE) (confirmed: the
//      resulting opFillet landed on the correct corresponding edge, not a
//      parallel/opposite one).
//   3. opFillet({"entities": ..., "radius": ...}) applies correctly to that
//      matched edge (confirmed as part of the same live test).
//   4. setVisibility (an outright hide) is NOT a real/importable function
//      under that name here -- three call shapes tried, all rejected.
//   5. setProperty(context, {"entities": ..., "propertyType":
//      PropertyType.APPEARANCE, "value": color(r, g, b, alpha)}) IS real
//      and DOES work -- confirmed live: on a body that had never been
//      touched by the right panel's own REST-based part-appearance
//      mechanism, the original faded and the duplicate took on a distinct
//      color exactly as scripted.
//
// KNOWN LIMITATION (confirmed live, not yet fixed): if "body" is itself
// the output of an earlier Cosmo Feature proposal that the right panel
// already styled via REST (app/api/onshape/part-appearance), that body
// carries a persistent manual appearance override, and setProperty's
// styling silently has no visible effect on it -- the manual REST
// override wins. Geometry is still correct in that case (the fillet is
// really there), only the visual distinction between original/proposed
// is lost. Fixing this (e.g. having Accept clear the override instead of
// just setting opacity back to 255) is deferred; the right panel
// (parameter-mark-panel/page.tsx, SELF_STYLING_COSMO_FEATURE_TYPES) knows
// this type styles itself and does not also apply its own REST-based
// opacity toggling on top, which would just get silently overridden by
// this script every recompute anyway.
//
// Design intent (matches proposedExtrude.fs's pattern):
//   - "body" / "edge": copied verbatim by the right panel's insert flow --
//     "body" is the same body the target edge belongs to, "edge" is the
//     specific edge someone picked when marking a Fillet parameter
//     uncertain. Since query selection can only happen against geometry
//     that already exists, both are picked on the ORIGINAL body; this
//     feature does the duplicate-then-match internally so the fillet
//     preview lands on the copy, not the original.
//   - "radius": the proposed value a reviewer is editing live in the right
//     panel, same live-patch-in-place flow as Extrude's "depth".
//   - Zero-offset transform: the duplicate is created exactly where the
//     original's geometry is, so the "proposed" and "current" states
//     visually align -- distinguishing them is entirely down to the
//     appearance styling below.
//
// "accepted" (hidden, same mechanism as proposedMove.fs): while false,
// this feature only ever previews -- the original body is untouched, a
// duplicate gets the fillet instead. The right panel patches this to
// true on Accept, which makes this SAME feature instance fillet the
// REAL edge on the REAL body instead of a throwaway copy -- no separate
// "apply for real" step, no second feature.
//
// Pending-state preview now matches proposedMove.fs's hand-drawn
// sketchy-wireframe treatment instead of a solid-colored duplicate: the
// duplicate gets filleted first (so the new rounded edge is captured
// too, via qOwnedByBody reading its CURRENT edges post-fillet, not just
// its original topology), a 2-4-stroke hand-drawn overlay is built from
// those edges, then the duplicate itself is deleted -- only the sketchy
// strokes remain, avoiding the same "solid body's own edges always
// render" problem proposedMove.fs hit. handDrawEdgeSketchy/
// RandomNumberFunction/idToNum/lcprng below are copied verbatim from
// proposedMove.fs's own confirmed-working versions of the same helpers.
//
// Radius dimension arrow: drawDimensionArrow() is proposedMove.fs's
// drawAxisArrow() generalized to take a prebuilt label string. Its
// direction is NOT the true fillet-cut bisector (that would need the
// two adjacent faces' normals, via a qAdjacent(edge, ..., EntityType.
// FACE) call whose exact argument shape isn't confirmed anywhere in
// this codebase yet) -- instead it points along an arbitrary-but-
// deterministic direction perpendicular to the edge's own tangent
// (edge tangent × world Z, or × world Y if the edge is nearly vertical,
// same "avoid a degenerate cross product" trick used elsewhere). Close
// enough to "point away from the edge" to read as a radius callout
// without a new unconfirmed API guess.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Fillet" }
export const fuzzycadProposedFillet = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to fillet", "Filter" : EntityType.BODY }
        definition.body is Query;

        // Accepts individual edges OR a whole face -- selecting a face
        // fillets its entire edge loop in one pass (matches native
        // Onshape Fillet's own face-selection behavior). "||" combining
        // entity types in a Filter is confirmed via an Onshape-employee-
        // answered forum thread, not independently compiled by us yet.
        annotation { "Name" : "Edges or face to round", "Filter" : EntityType.EDGE || EntityType.FACE }
        definition.edge is Query;

        annotation { "Name" : "Radius" }
        isLength(definition.radius, LENGTH_BOUNDS);

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

        // Expand any selected FACEs into their own boundary edges
        // (qAdjacent with AdjacencyType.EDGE, confirmed via an Onshape-
        // employee-answered forum thread), union with any
        // directly-selected EDGEs, so everything below only ever deals
        // with a flat, possibly-multi-entity edge query.
        // qEntityFilter(query, EntityType) is confirmed via forum usage
        // examples -- neither of these two calls has been independently
        // compiled by us yet.
        const selectedFaces = qEntityFilter(definition.edge, EntityType.FACE);
        const selectedEdges = qEntityFilter(definition.edge, EntityType.EDGE);
        const edgesFromFaces = qAdjacent(selectedFaces, AdjacencyType.EDGE, EntityType.EDGE);
        const targetEdges = qUnion(selectedEdges, edgesFromFaces);

        // ACCEPTED STATE: fillet the real edges on the real body
        // directly, no duplicate/preview machinery at all, then stop.
        // Passing the WHOLE multi-edge query into ONE opFillet call
        // (instead of filleting edges one at a time) lets Onshape's own
        // solver blend smoothly across a tangent-connected loop -- per
        // live feedback, filleting a curved boundary edge-segment-by-
        // edge-segment is what produced a "chopped into many facets"
        // look instead of one smooth fillet surface.
        if (definition.accepted)
        {
            opFillet(context, id + "acceptedFillet", {
                    "entities" : targetEdges,
                    "radius" : definition.radius
            });

            return;
        }

        // PENDING STATE below.

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);
        const copiedEdges = qCreatedBy(id + "duplicate", EntityType.EDGE);

        // Match each ORIGINAL target edge to its corresponding
        // duplicate edge by nearest point, and average all their
        // midpoints into ONE anchor point for the dimension label --
        // see needsInputFillet.fs's identical comment for the full
        // rationale (single shared "radius" parameter, so one
        // representative anchor/direction is used).
        var matchedEdges = qNothing();
        var anchorSum = vector(0, 0, 0) * meter;
        var anchorTangent = vector(1, 0, 0);
        var edgeCount = 0;

        for (var originalEdge in evaluateQuery(context, targetEdges))
        {
            const tangentLine = evEdgeTangentLine(context, {
                    "edge" : originalEdge,
                    "parameter" : 0.5
            });
            const edgeMidpoint = tangentLine.origin;

            matchedEdges = qUnion(matchedEdges, qClosestTo(copiedEdges, edgeMidpoint));

            anchorSum = anchorSum + edgeMidpoint;
            if (edgeCount == 0)
            {
                anchorTangent = tangentLine.direction;
            }
            edgeCount += 1;
        }

        const midpoint = anchorSum / max(edgeCount, 1);

        opFillet(context, id + "fillet", {
                "entities" : matchedEdges,
                "radius" : definition.radius
        });

        // Fade the original -- no-ops silently if "originalBody" already
        // carries a manual appearance override from the right panel's
        // REST mechanism (see the KNOWN LIMITATION note above).
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
                    "value" : color(0.25, 0.55, 0.95, 1.0)
            });
        }

        const tangentDir = anchorTangent;
        const perpReference = (abs(tangentDir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
        const radiusDir = normalize(cross(tangentDir, perpReference));
        const dimensionColor = color(0.25, 0.55, 0.95, 1.0);

        drawDimensionArrow(
                context,
                id + "radiusArrow",
                midpoint,
                radiusDir * definition.radius,
                "R: " ~ toString(round(definition.radius / millimeter, 1)) ~ " mm",
                dimensionColor
        );

        // Remove the temporary filleted duplicate now that its edges have
        // been sampled into the sketchy strokes -- this is what removes
        // the solid black CAD edges that setProperty alone can never hide
        // (Onshape always renders a body's own edges regardless of its
        // face appearance).
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

    const shaftWidth = min(max(distanceMm * 0.09, 1.0), 3.5) * millimeter;
    const headLength = min(distanceMm * 0.45, 12) * millimeter;
    const headWidth = shaftWidth * 4;

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
