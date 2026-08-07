// FuzzyCAD "Test Duplicate + Edge Match" -- DRAFT, isolated experiment,
// step 2 of building "FuzzyCAD Proposed Fillet".
//
// Step 1 (testDuplicateBody.fs v2, CONFIRMED WORKING live: Parts count
// went from 2 to 4 after inserting two instances) proved opPattern can
// duplicate a whole body while leaving the original untouched.
//
// Step 2, this file: Fillet needs a specific EDGE on the duplicate, not
// just the whole duplicated body. The edge has to be picked on the
// ORIGINAL body in the dialog (the copy doesn't exist yet when the user
// is selecting), so after opPattern creates the copy, this script tries
// to find "the same edge" on the new body by:
//   1. Sampling a point on the original selected edge (evEdgeTangentLine
//      at parameter 0.5 -- roughly the midpoint).
//   2. Applying the exact same transform used for the duplicate to that
//      point.
//   3. Using qClosestTo() against all edges created by the duplicate
//      operation (qCreatedBy(id + "duplicate", EntityType.EDGE)) to find
//      whichever copied edge ends up closest to that transformed point.
//
// v1 of this file tried to visualize the match with setVisibility(),
// which turned out not to exist under that call shape at all (tried
// both 4-arg and 3-arg forms, both rejected by the compiler -- likely
// not the real function name/signature, possibly not even imported by
// common.fs). Rather than keep guessing at a visualization helper, v2
// skips straight to applying a real opFillet() to the matched edge with
// a deliberately large test radius -- if qClosestTo() found the wrong
// edge, a fillet in the wrong place will be immediately obvious in the
// viewport; if it found the right one, this doubles as the first real
// test of the actual Fillet operation this whole exercise is for.
//
// Uncertain pieces, most likely to need fixing:
//  1. evEdgeTangentLine's exact call shape (context, {"edge": ..., "parameter": 0.5})
//     -- confident on the general idea, less confident on exact key names.
//  2. qClosestTo(context, query, point) -- confident this or something
//     very close to it exists in the std library for exactly this kind
//     of "which entity ended up nearest this point" lookup, not fully
//     confident on argument order/shape.
//  3. opFillet's parameter keys ("entities" + "radius") -- guessed by
//     analogy with opExtrude/opBoolean's "entities"-style keys seen
//     working elsewhere in this codebase's FeatureScript, not yet
//     confirmed directly.
//
// Test plan: select one specific EDGE on the original body (pick a edge
// that's easy to visually identify, e.g. one straight edge of a
// rectangular face, not a symmetric/ambiguous one). Insert. If it
// compiles: the copy should appear offset by 50mm on X same as before,
// but now with a visible 5mm-radius round on ONE edge of the copy --
// check whether that rounded edge is the one that actually corresponds
// to the edge you selected on the original (same relative position on
// the copy), not a parallel or opposite edge.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Test Duplicate Edge Match" }
export const fuzzycadTestDuplicateEdgeMatch = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to duplicate", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Edge to match on the copy", "Filter" : EntityType.EDGE }
        definition.edge is Query;
    }
    {
        const offset = vector(50, 0, 0) * millimeter;

        opPattern(context, id + "duplicate", {
                "entities" : definition.body,
                "transforms" : [transform(offset)],
                "instanceNames" : ["copy"]
        });

        const midpoint = evEdgeTangentLine(context, {
                "edge" : definition.edge,
                "parameter" : 0.5
        }).origin;

        const targetPoint = midpoint + offset;

        const copiedEdges = qCreatedBy(id + "duplicate", EntityType.EDGE);
        const matchedEdge = qClosestTo(copiedEdges, targetPoint);

        opFillet(context, id + "fillet", {
                "entities" : matchedEdge,
                "radius" : 5 * millimeter
        });
    });
