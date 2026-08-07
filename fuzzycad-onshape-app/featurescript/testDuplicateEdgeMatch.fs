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
// This script does NOT fillet anything yet -- it only duplicates the
// body and then sets the appearance/opacity of the matched copy edge's
// owning body so it's visually obvious in the viewport whether the
// "closest edge" match actually landed on the right edge (the one
// topologically corresponding to what you selected), not some other
// edge that happened to be geometrically nearby.
//
// Uncertain pieces, most likely to need fixing:
//  1. evEdgeTangentLine's exact call shape (context, {"edge": ..., "parameter": 0.5})
//     -- confident on the general idea, less confident on exact key names.
//  2. qClosestTo(context, query, point) -- confident this or something
//     very close to it exists in the std library for exactly this kind
//     of "which entity ended up nearest this point" lookup, not fully
//     confident on argument order/shape.
//
// Test plan: select one specific EDGE on the original body (pick a edge
// that's easy to visually identify, e.g. one straight edge of a
// rectangular face, not a symmetric/ambiguous one). Insert. If it
// compiles: the copy should appear offset by 50mm on X same as before,
// and the SPECIFIC copied edge that matches your original selection
// should be the one that ends up highlighted/selected in the resulting
// feature (Onshape highlights whatever a feature's output query
// resolves to when you click the feature in the tree) -- check whether
// that's the edge you'd expect (i.e., same edge on the copy, not a
// parallel or opposite one).

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

        setVisibility(context, id + "highlight", matchedEdge, true);
    });
