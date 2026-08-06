// FuzzyCAD "Proposed Extrude" custom feature -- DRAFT, not yet compiled/tested.
//
// This has never been run through Onshape's FeatureScript compiler (I have no
// access to it), so treat every identifier below as "best guess from spec,
// needs live verification." When you paste this in:
//
//   1. Create a new Feature Studio element in Onshape.
//   2. Onshape auto-fills a "FeatureScript <version>;" pragma and an
//      import(...) line at the top when it creates the file -- KEEP those
//      exactly as Onshape generated them, don't replace with the ones below
//      if they differ. Then paste everything from "annotation" onward.
//   3. If it doesn't compile, paste the exact error text back and I'll fix it
//      blind from the error message -- much easier than guessing cold.
//
// Design intent (matches the FuzzyCAD right panel's Extrude mark flow):
//   - "entities": the same face/sketch-region query the *original* Extrude
//     feature already uses for its own "entities" parameter. The right panel
//     will copy that query verbatim when it inserts an instance of this
//     feature, so this custom feature never has to re-derive "which profile."
//   - "depth" / "oppositeDirection": the proposed values a reviewer is
//     editing in the right panel. Every edit re-patches this feature's
//     parameters in place (see partstudio-update-feature), it does NOT touch
//     the original Extrude.
//   - operationType NEW: this must produce an independent new body, not merge
//     into the original solid -- the whole point is the proposed geometry
//     sits *next to* the untouched original so both are visible at once.

FeatureScript 2412;
import(path : "onshape/std/geometry.fs", version : "2412.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Extrude" }
export const fuzzycadProposedExtrude = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Entities to extrude" }
        definition.entities is Query;

        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);

        annotation { "Name" : "Opposite direction", "Default" : false }
        definition.oppositeDirection is boolean;
    }
    {
        var direction = evOwnerSketchPlane(context, { "entity" : definition.entities }).normal;
        if (definition.oppositeDirection)
        {
            direction = -direction;
        }

        opExtrude(context, id + "extrude1", {
                "entities" : definition.entities,
                "direction" : direction,
                "endBound" : BoundingType.BLIND,
                "endDepth" : definition.depth,
                "operationType" : NewBodyOperationType.NEW
        });

        // No in-script visual styling on purpose: the right panel already has
        // a confirmed-working mechanism to recolor a body by partId (the
        // "mark uncertain -> transparent, black edges" appearance feature,
        // via qCreatedBy + the part-appearance API). Once this feature is
        // inserted and its featureId is known, the same mechanism can style
        // the proposed body too -- no need to guess FeatureScript's own
        // styling API on top of everything else that's unverified here.
    });
