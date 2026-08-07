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
//   - The original body is left fully opaque and coincident with the
//     duplicate on purpose for now -- an in-script hide via setVisibility
//     was tried three times (4-arg, 3-arg with (query, boolean), 3-arg
//     with (id, map)) and rejected every time, so it's very likely not a
//     real/importable function under that name in this scope. Visibility
//     styling for review is being moved back to the right panel's own
//     REST-based part-appearance mechanism (already confirmed working for
//     proposedExtrude), which needs to resolve "body" to a partId --
//     that's the next thing being investigated, not a FeatureScript
//     change.

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
