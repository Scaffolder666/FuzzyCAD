// FuzzyCAD "Proposed Hole" custom feature -- DRAFT, not yet compiled.
// Reuses two already-confirmed pieces:
//   - opPattern() zero-offset duplication + setProperty appearance
//     styling, same as proposedFillet.fs/proposedChamfer.fs/etc.
//   - evFaceTangentPlane's direction-from-face logic + oppositeDirection
//     toggle, copied verbatim from proposedExtrude.fs (confirmed live).
//
// The genuinely NEW, UNCONFIRMED piece: cutting material OUT of a body
// instead of adding a new one. proposedExtrude.fs uses
// NewBodyOperationType.NEW (confirmed). This guesses
// NewBodyOperationType.REMOVE is the sibling enum value for a cut, which
// seems likely but is unconfirmed.
//
// The trickier problem: the duplicate is coincident with the original
// (zero offset, same as every other tool in this set) -- if the REMOVE
// extrude isn't scoped to a specific body, it could plausibly cut into
// BOTH the original and the duplicate (they occupy the same space),
// destroying the "never touch the original" guarantee. Guessing there's
// a "booleanScope" key (matching the native Extrude feature's own
// "Scope" selector, visible in its UI when Operation type = Remove) that
// restricts the cut to just the duplicate. This is the single biggest
// risk in this file -- if scoping doesn't work as guessed, the original
// body may get cut too, so test this one on a body you don't mind
// re-copying/undoing if it goes wrong, and check the ORIGINAL is still
// solid (no hole) after inserting.
//
// The hole's PROFILE ("entities", a sketch face) is picked on the
// ORIGINAL body's geometry (same reasoning as Fillet's "edge" param --
// query selection only works against geometry that already exists when
// the dialog is open). Since opPattern only duplicates definition.body
// (not the sketch), the profile face itself isn't duplicated -- but
// because the copy sits at the exact same location as the original
// (zero offset), the original profile's geometry still lines up
// correctly against the copy, so no separate profile-matching step
// (like Fillet's evEdgeTangentLine + qClosestTo) should be needed here.
//
// Same appearance-styling approach and same known REST-override
// limitation as the other Proposed* features in this directory.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Hole" }
export const fuzzycadProposedHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to modify", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Hole profile", "Filter" : EntityType.FACE }
        definition.entities is Query;

        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);

        annotation { "Name" : "Opposite direction", "Default" : false }
        definition.oppositeDirection is boolean;
    }
    {
        const originalBody = definition.body;

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        const facesToCut = evaluateQuery(context, definition.entities);
        var direction = evFaceTangentPlane(context, {
                "face" : facesToCut[0],
                "parameter" : vector(0.5, 0.5)
            }).normal;
        if (definition.oppositeDirection)
        {
            direction = -direction;
        }

        opExtrude(context, id + "hole", {
                "entities" : definition.entities,
                "direction" : direction,
                "endBound" : BoundingType.BLIND,
                "endDepth" : definition.depth,
                "operationType" : NewBodyOperationType.REMOVE,
                "booleanScope" : proposedBody
        });

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
