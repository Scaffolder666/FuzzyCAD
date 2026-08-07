// FuzzyCAD "Needs Input Scale" custom feature -- sibling of
// proposedScale.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// Geometry logic copied from proposedScale.fs v3 (scaleNonuniformly,
// confirmed real in a working reference source the user found,
// replacing the earlier identityMatrix(3) guess).
//
// Visual language CHANGED from the original plan: "outline only" (color
// just the duplicate's edges, leave faces normal) is not achievable --
// confirmed live, setProperty's APPEARANCE property only accepts BODY
// or FACE entities, not EDGE ("APPEARANCE property can only be applied
// to bodies and faces"). Every needsInput*.fs file had this same bug.
// Fixed here by coloring the whole proposed body instead, but in a
// DIFFERENT hue (amber) from Proposed*'s blue, so Needs Input and
// Proposed are still visually distinguishable at a glance even though
// both are now "filled" rather than one being an outline.
//
// "Scale factor" starts at whatever placeholder value (e.g. 1, meaning
// no change yet) whoever inserts this leaves it at -- someone else
// fills in the real factor via the right panel's existing live-edit
// path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Scale" }
export const fuzzycadNeedsInputScale = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to scale", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Scale origin", "Filter" : EntityType.VERTEX }
        definition.originPoint is Query;

        annotation { "Name" : "Scale factor" }
        isReal(definition.scaleFactor, POSITIVE_REAL_BOUNDS);
    }
    {
        const originalBody = definition.body;

        const pivot = evVertexPoint(context, { "vertex" : definition.originPoint });
        const scaleTransform = scaleNonuniformly(
                definition.scaleFactor,
                definition.scaleFactor,
                definition.scaleFactor,
                pivot
        );

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [scaleTransform],
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
                "value" : color(1.0, 0.65, 0.0, 1.0)
        });
    });
