// FuzzyCAD "Needs Input Move" custom feature -- sibling of
// proposedMove.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// Geometry logic copied verbatim from proposedMove.fs (confirmed live:
// built entirely from opPattern-with-a-nonzero-transform + setProperty).
// Only the final appearance styling differs, same edges-only-outline
// treatment as needsInputFillet.fs.
//
// "Move X/Y/Z" start at whatever placeholder values (e.g. 0) whoever
// inserts this leaves them at -- someone else fills in the real numbers
// via the right panel's existing live-edit path. At all-zero, the
// duplicate is coincident with the original -- that's fine, the
// outlined-edges styling still shows there's an open question here even
// before any real displacement is entered.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Move" }
export const fuzzycadNeedsInputMove = defineFeature(function(context is Context, id is Id, definition is map)
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

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        const proposedEdges = qCreatedBy(id + "duplicate", EntityType.EDGE);
        setProperty(context, {
                "entities" : proposedEdges,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.3, 0.7, 1.0, 1.0)
        });
    });
