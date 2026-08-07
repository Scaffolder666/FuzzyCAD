// FuzzyCAD "Proposed Fillet" custom feature -- DRAFT, built from three
// separately-verified pieces (testDuplicateBody.fs, testDuplicateEdgeMatch.fs,
// both confirmed live in Onshape's editor):
//   1. opPattern() duplicates a body while leaving the original untouched
//      (confirmed: Parts count went from 2 to 4 after two test instances).
//   2. A specific edge selected on the ORIGINAL body can be located on the
//      duplicate via evEdgeTangentLine's midpoint + qClosestTo() against
//      qCreatedBy(id + "duplicate", EntityType.EDGE) (confirmed: the
//      resulting opFillet landed on the correct corresponding edge, not a
//      parallel/opposite one).
//   3. opFillet({"entities": ..., "radius": ...}) applies correctly to that
//      matched edge (confirmed as part of the same live test).
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
//   - Zero-offset transform: unlike the test script's 50mm offset (used
//     only to make the copy visually distinguishable for testing), the
//     real feature duplicates in place so the proposed body sits exactly
//     where the original's geometry is.
//   - setVisibility (a hide, not a fade) was tried three times (4-arg,
//     3-arg with (query, boolean), 3-arg with (id, map)) and rejected
//     every time -- not a real/importable function under that name here.
//     FeatureScript apparently can't hide arbitrary entities outright,
//     but it CAN restyle their appearance: setProperty(context, {
//     "entities": ..., "propertyType": PropertyType.APPEARANCE, "value":
//     color(r, g, b, alpha) }) is a real documented function (per
//     Onshape's own FeatureScript reference). Using it here to fade the
//     ORIGINAL body to near-transparent (not the duplicate) while this
//     feature exists -- same "tied to the feature's own lifecycle, no
//     app-side bookkeeping needed" reasoning as the abandoned hide
//     attempt, just with a real function this time. UNCONFIRMED live --
//     first real use of setProperty/color() in this codebase.

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
    }
    {
        // setProperty moved to BEFORE opPattern/opFillet run: the first
        // attempt (after both ops) compiled and ran with no error, but had
        // no visible effect -- likely because definition.body's Query had
        // gone stale/empty by that point (the ops that follow re-derive
        // geometry off it, may invalidate the original resolution).
        // Applying it first, while definition.body still resolves against
        // the untouched original, should avoid that.
        setProperty(context, {
                "entities" : definition.body,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(1, 1, 1, 0.15)
        });

        opPattern(context, id + "duplicate", {
                "entities" : definition.body,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

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
    });
