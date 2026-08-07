// FuzzyCAD "Proposed Move" custom feature -- built ENTIRELY from pieces
// already confirmed live in Onshape's editor (see proposedFillet.fs for
// the individual confirmations):
//   - opPattern() duplicates a body while leaving the original untouched.
//   - opPattern's own "transforms" array doesn't have to be a zero
//     offset -- passing the real desired translation directly means the
//     duplicate is created ALREADY moved, no separate opTransform() call
//     needed at all (opTransform itself is still unconfirmed for a plain
//     move -- the one live test of it was for the abandoned "makeCopy"
//     duplication attempt, not a clean move-only case, so this avoids
//     relying on it).
//   - setProperty(context, {"entities": ..., "propertyType":
//     PropertyType.APPEARANCE, "value": color(r,g,b,alpha)}) fades the
//     original and colors the proposal, confirmed live for Fillet.
//
// Since every piece here is already-confirmed, this one has the highest
// chance of compiling clean on the first try of the three requested
// (Move/Scale/Rotate) -- Scale and Rotate each need at least one
// genuinely new, unconfirmed FeatureScript call.
//
// Same KNOWN LIMITATION as proposedFillet.fs: if "body" is itself the
// output of an earlier Cosmo Feature proposal already styled via the
// right panel's REST mechanism, the appearance styling below silently
// has no visible effect (manual REST override wins) -- geometry is still
// correct. The right panel's SELF_STYLING_COSMO_FEATURE_TYPES set knows
// this type styles itself and skips its own REST opacity toggling here.

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

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(definition.moveX, definition.moveY, definition.moveZ))],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

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
