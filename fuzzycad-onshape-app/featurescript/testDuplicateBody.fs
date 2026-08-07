// FuzzyCAD "Test Duplicate Body" -- DRAFT v2, isolated experiment.
// v1 used opTransform() with a "makeCopy" key (borrowed from the native
// Move feature's own UI parameter name) and the user's live test showed
// the original body being relocated instead of a second body being
// created -- Parts count stayed at 2, and the highlighted result looked
// like an outline overlapping the original, not a real second solid.
// Conclusion: "makeCopy" is not a real opTransform() parameter; it's
// likely something the native Move feature's own internal logic branches
// on, not something opTransform itself understands.
//
// v2 tries a different std-library function that is actually meant to
// keep the original body and produce transformed COPIES of it:
// opPattern(). This is the same underlying call Linear/Circular/Mirror
// pattern features use -- e.g. Mirror pattern's whole job is "leave the
// original alone, create one transformed copy" which is exactly the
// shape we want here (we just use a small offset transform instead of a
// mirror transform, so the copy is visibly distinguishable from the
// original for this test).
//
// Uncertain pieces in this version, most-likely-to-need-fixing first:
//  1. "entities" -- opPattern's key for "what to copy". Fairly confident
//     on this one (matches the query-parameter naming used elsewhere).
//  2. "transforms" -- plural, an array of Transform, one per copy
//     produced. Also fairly confident.
//  3. "instanceNames" -- pattern features generate this array (one string
//     per transform) to name each resulting instance; unsure whether it's
//     required or optional, so it's included defensively.
//
// Same drill as before: keep Onshape's own auto-generated
// "FeatureScript <version>;" + import(...) lines, paste the rest, insert
// a fresh instance (delete the old "FuzzyCAD Test Duplicate Body 2" test
// first so we're not looking at stale state), and report back what
// happens -- does Parts become 3, and is there a real second solid body
// offset from the original?

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Test Duplicate Body" }
export const fuzzycadTestDuplicateBody = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to duplicate", "Filter" : EntityType.BODY }
        definition.entities is Query;
    }
    {
        // Offset by 50mm on X so a real copy is visibly separated from
        // the original -- easy to eyeball whether this actually produced
        // a second solid or not.
        opPattern(context, id + "duplicate", {
                "entities" : definition.entities,
                "transforms" : [transform(vector(50, 0, 0) * millimeter)],
                "instanceNames" : ["copy"]
        });
    });
