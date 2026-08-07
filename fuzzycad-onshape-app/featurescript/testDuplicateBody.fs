// FuzzyCAD "Test Duplicate Body" -- DRAFT, isolated experiment, not yet
// compiled/tested. This is step 1 of building "FuzzyCAD Proposed Fillet":
// unlike Extrude (which can use operationType NEW to create an
// independent new body from nothing), Fillet/Boolean/Move/Rotate/Scale
// all edit an EXISTING body in place -- to keep the original untouched
// while previewing a proposal, we need to duplicate the target body
// first, then operate on the copy. This script does ONLY the duplicate
// step, isolated, so we can confirm the mechanism works before building
// the full Fillet feature on top of it -- same "verify the small piece
// live before stacking more on it" approach as qCreatedBy and the
// Extrude ghost earlier.
//
// Confirmed-real precedent this is based on: the native Onshape "Move"
// (transform) feature this app already inserts via
// partstudio-add-feature/route.ts has a real "makeCopy" boolean
// parameter (confirmed live, captured JSON). That's a native FEATURE's
// own UI parameter name, not necessarily the exact key the underlying
// opTransform() FeatureScript function itself expects -- worth flagging
// since it's the shakiest guess in this file.
//
// When you paste this in: same drill as before -- keep Onshape's own
// auto-generated "FeatureScript <version>;" + import(...) lines, paste
// the rest, and send back whatever error appears (if any). Once this
// compiles and a manually-inserted instance produces a real overlapping
// duplicate solid, we've confirmed the technique and can build the real
// Fillet feature on top of it.

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
        // Uncertain pieces, most-likely-to-need-fixing first:
        //  1. "bodies" -- opTransform's actual parameter key for "what to
        //     transform" might be "entities" or something else instead.
        //  2. "makeCopy" -- may not be the real underlying key even though
        //     the native Move feature's own UI parameter is named that.
        //  3. transform(vector(0, 0, 0) * meter) -- a zero-translation
        //     transform, used here as a stand-in for "identity" (no
        //     actual position change, we only want the copy to exist in
        //     place). If FeatureScript has a dedicated identity-transform
        //     constant/constructor, that'd be more correct than this.
        opTransform(context, id + "duplicate", {
                "bodies" : definition.entities,
                "transform" : transform(vector(0, 0, 0) * meter),
                "makeCopy" : true
        });
    });
