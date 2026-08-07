// FuzzyCAD "Proposed Move" custom feature -- v2, adds a dashed-outline
// + directional-arrow visualization on top of the v1 mechanism (opPattern
// duplication + setProperty fade/color), which was fully confirmed live.
//
// v2 is a genuinely experimental batch -- multiple NEW FeatureScript
// calls, none used anywhere else in this codebase yet, found via web
// research (not confirmed live) rather than guessed cold:
//   1. opFitSpline(context, id, {"points": [p0, p1]}) -- draws a real,
//      persistent 3D curve between two points, found via an Onshape
//      forum example: "opFitSpline(context, id + "line_1", { "points" :
//      [ startPoint, endPoint ] });". Used here in a loop to build many
//      short segments = a dashed line.
//   2. evBox3d(context, {"topology": ..., "tight": true}) -- bounding
//      box, found via forum example: "var bbox = evBox3d(context, {
//      "topology" : definition.SelectedBody, "tight" : true })",
//      returning .minCorner/.maxCorner as (presumably) 3-element
//      indexable arrays of length quantities. Used to find the original
//      body's center as the arrow's start point.
//   3. toString(number) -- guessed conversion for building unique ids
//      inside the dash loop (id + "dash" + toString(e) + ...) -- id
//      concatenation via "+" IS confirmed elsewhere (id + "extrude1"
//      etc.), but concatenating a LOOP INDEX specifically is new.
//
// Design: the proposed body itself is made fully invisible (alpha 0) --
// what's actually visible is a dashed wire skeleton traced along its
// edges (sample each edge at 10 parameter steps, connect only every
// OTHER pair as a short opFitSpline segment, skip the rest -- the
// skipped pairs become the gaps) plus a single straight line from the
// original body's bounding-box center to its moved position, standing
// in for a directional arrow (no arrowhead geometry yet -- keeping this
// first pass simpler given how much else here is unconfirmed).
//
// If this doesn't compile, the exact line number in the error will say
// which of the three new pieces above is wrong -- paste it back rather
// than guessing further blind. Given how much is new here, expect more
// than one round.

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

        // Onshape draws every body's edges as plain black/dark lines by
        // default REGARDLESS of face opacity -- confirmed live: the
        // original body's own outline stayed fully visible even at
        // alpha 0.08, and the dash segments below (with no appearance
        // set of their own) rendered in that same default look, so the
        // two were visually indistinguishable. Coloring each dash/arrow
        // segment the same blue used for "proposed" elsewhere fixes
        // that: black solid = current, blue dashed = proposed.
        //
        // First attempt queried each dash by EntityType.EDGE and got a
        // real compiler/runtime error, confirmed live: "APPEARANCE
        // property can only be applied to bodies and faces" -- each
        // opFitSpline call creates its own wire-type BODY (not a bare
        // edge floating with no owning body), so the fix is querying
        // EntityType.BODY for each dash/arrow id instead.
        const dashColor = color(0.25, 0.55, 0.95, 1.0);

        const proposedEdges = evaluateQuery(context, qCreatedBy(id + "duplicate", EntityType.EDGE));
        const dashSteps = 10;
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
                setProperty(context, {
                        "entities" : qCreatedBy(dashId, EntityType.BODY),
                        "propertyType" : PropertyType.APPEARANCE,
                        "value" : dashColor
                });
            }
        }

        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const originCenter = vector(
                (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
                (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
                (bbox.minCorner[2] + bbox.maxCorner[2]) / 2
        );
        opFitSpline(context, id + "arrow", { "points" : [originCenter, originCenter + offset] });
        setProperty(context, {
                "entities" : qCreatedBy(id + "arrow", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : dashColor
        });
    });
