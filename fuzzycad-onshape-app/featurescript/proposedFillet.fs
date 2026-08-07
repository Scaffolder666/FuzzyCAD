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
//   - Hiding the original in-script (new in this version, UNCONFIRMED):
//     with the duplicate coincident with the original, both bodies render
//     opaque and overlapping, which just looks broken -- there's no need
//     for the right panel's opacity-styling trick here at all if the
//     original is simply hidden for as long as this feature exists. Tying
//     the hide to the feature's own recompute means Accept (feature stays)
//     keeps the original hidden -- exactly right, since the fillet is now
//     the "final" look -- and Reject (feature gets deleted) automatically
//     un-hides the original with zero extra bookkeeping on the app side.
//     setVisibility's real call shape is still unconfirmed: an earlier
//     attempt at setVisibility(context, query, boolean) (3 positional
//     args) was rejected by the compiler, but every other "op"-style
//     function in this codebase's FeatureScript takes (context, id, map)
//     -- this version guesses that setVisibility follows the same
//     convention, just with a different type signature than what was
//     tried before (hence "3 arguments not found" both times: not an
//     arg-count problem, an arg-type problem).

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

        setVisibility(context, id + "hideOriginal", {
                "entities" : definition.body,
                "visible" : false
        });
    });
