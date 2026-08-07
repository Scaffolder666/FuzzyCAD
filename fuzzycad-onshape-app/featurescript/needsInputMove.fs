// FuzzyCAD "Needs Input Move" custom feature -- sibling of
// proposedMove.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// Geometry logic copied from proposedMove.fs's core mechanism (confirmed
// live: opPattern-with-a-nonzero-transform + setProperty) -- NOT the
// dashed-outline/arrow/label styling proposedMove.fs v3 adds, since
// that's extra polish for a KNOWN value, not needed for a placeholder
// one here.
//
// Visual language CHANGED from the original plan: "outline only" isn't
// achievable -- confirmed live, setProperty's APPEARANCE property only
// accepts BODY or FACE, not EDGE. Fixed by coloring the whole proposed
// body in a different hue (amber) from Proposed*'s blue instead -- same
// fix as needsInputFillet.fs.
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

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);
        setProperty(context, {
                "entities" : proposedBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(1.0, 0.65, 0.0, 1.0)
        });
    });
