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

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Fillet" }
export const fuzzycadProposedFillet = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to fillet", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Edge to round", "Filter" : EntityType.EDGE }
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

        // ACCEPTED STATE: fillet the real edge on the real body directly,
        // no duplicate/preview machinery at all, then stop.
        if (definition.accepted)
        {
            opFillet(context, id + "acceptedFillet", {
                    "entities" : definition.edge,
                    "radius" : definition.radius
            });

            return;
        }

        // PENDING STATE below (unchanged).

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        const midpoint = evEdgeTangentLine(context, {
                "edge" : definition.edge,
                "parameter" : 0.5
        }).origin;

        const copiedEdges = qCreatedBy(id + "duplicate", EntityType.EDGE);
        const matchedEdge = qClosestTo(copiedEdges, midpoint);

        opFillet(context, id + "fillet", {
                "entities" : matchedEdge,
                "radius" : definition.radius
        });

        // Fade the original, give the proposal a clearly distinct color --
        // no-ops silently if "originalBody" already carries a manual
        // appearance override from the right panel's REST mechanism (see
        // the KNOWN LIMITATION note above).
        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        setProperty(context, {
                "entities" : proposedBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.25, 0.55, 0.95, 1.0)
        });
    });
