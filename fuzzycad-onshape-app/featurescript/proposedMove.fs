// FuzzyCAD "Proposed Move" custom feature -- v3.
//
// v3 rewrite based on a real, working FeatureScript source the user
// found (a "hand drawn sketchy wireframe" custom feature) which
// confirmed several previously-guessed functions are real and
// correctly shaped, and taught a cleaner pattern for the dashed
// outline than v2's per-dash setProperty calls:
//   - opCreateCompositePart(context, id, {"bodies": ..., "closed":
//     boolean}) merges many wire bodies (like our dash segments) into
//     ONE body -- confirmed live in that source. Used here so all the
//     dash segments get ONE setProperty call instead of one per dash.
//   - skText / newSketchOnPlane / worldToPlane / skSolve -- confirmed
//     live: a real, working way to place 3D text. Used here to add an
//     actual distance label ("12.5mm") near the arrow's midpoint --
//     the "ruler" the user asked for, which I'd wrongly assumed was
//     out of reach.
//   - qUnion(...) to accumulate the per-dash body queries into one.
//
// Still true from v2: Onshape draws every body's own edges as default
// black lines regardless of face opacity, confirmed live -- there is
// no way found to suppress a body's own edge rendering. The proposed
// body's own complete outline will always be visible alongside the
// dashed skeleton; the dashes are an additional cue on top, not a
// replacement for the real outline (matches how the reference source
// itself works too -- it doesn't try to hide the base model's edges
// either, it draws additional sketchy strokes over/near them).

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Move" }
export const fuzzycadProposedMove = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to move", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Move X" }
        isLength(definition.moveX, LENGTH_BOUNDS);

        annotation { "Name" : "Move Y" }
        isLength(definition.moveY, LENGTH_BOUNDS);

        annotation { "Name" : "Move Z" }
        isLength(definition.moveZ, LENGTH_BOUNDS);
    }
    {
        const originalBody = definition.body;
        const offset = vector(definition.moveX, definition.moveY, definition.moveZ);

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(offset)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        // The proposed body is invisible -- the dashed wire skeleton
        // below is what actually represents it visually.
        setProperty(context, {
                "entities" : proposedBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.25, 0.55, 0.95, 0.0)
        });

        const dashColor = color(0.25, 0.55, 0.95, 1.0);

        // Build every dash segment, but collect them into ONE query and
        // style them with a single setProperty call via
        // opCreateCompositePart -- confirmed pattern, instead of one
        // setProperty per dash.
        const proposedEdges = evaluateQuery(context, qCreatedBy(id + "duplicate", EntityType.EDGE));
        const dashSteps = 10;
        var allDashes = qNothing();
        for (var e = 0; e < size(proposedEdges); e += 1)
        {
            for (var i = 0; i < dashSteps; i += 2)
            {
                const t0 = i / dashSteps;
                const t1 = (i + 1) / dashSteps;
                const p0 = evEdgeTangentLine(context, { "edge" : proposedEdges[e], "parameter" : t0 }).origin;
                const p1 = evEdgeTangentLine(context, { "edge" : proposedEdges[e], "parameter" : t1 }).origin;
                const dashId = id + "dash" + toString(e) + "_" + toString(i);
                opFitSpline(context, dashId, { "points" : [p0, p1] });
                allDashes = qUnion(allDashes, qCreatedBy(dashId, EntityType.BODY));
            }
        }

        opCreateCompositePart(context, id + "dashComposite", {
                "bodies" : allDashes,
                "closed" : false
        });

        setProperty(context, {
                "entities" : qCreatedBy(id + "dashComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : dashColor
        });

        // Directional arrow, same as v2.
        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const originCenter = vector(
                (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
                (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
                (bbox.minCorner[2] + bbox.maxCorner[2]) / 2
        );
        const arrowEnd = originCenter + offset;
        opFitSpline(context, id + "arrow", { "points" : [originCenter, arrowEnd] });
        setProperty(context, {
                "entities" : qCreatedBy(id + "arrow", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : dashColor
        });

        // Distance label ("the ruler") at the arrow's midpoint, on a
        // plane facing along the move direction -- same skText pattern
        // confirmed in the reference source (there used for rotation
        // angles in degrees; here for a move distance in millimeters).
        const moveDistanceMm = norm(offset) / millimeter;
        const midPoint = (originCenter + arrowEnd) / 2;
        const labelPlane = plane(midPoint, normalize(offset));
        const labelSketch = newSketchOnPlane(context, id + "distanceLabelSketch", {
                "sketchPlane" : labelPlane
        });
        const labelUv = worldToPlane(labelPlane, midPoint);
        const textSize = 3 * millimeter;
        skText(labelSketch, "distanceLabelText", {
                "text" : toString(round(moveDistanceMm, 1)) + " mm",
                "fontName" : "OpenSans-Regular.ttf",
                "firstCorner" : vector(labelUv[0] - textSize, labelUv[1] - textSize),
                "secondCorner" : vector(labelUv[0] + textSize, labelUv[1] + textSize)
        });
        skSolve(labelSketch);
    });
