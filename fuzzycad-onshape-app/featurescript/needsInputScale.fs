// FuzzyCAD "Needs Input Scale" custom feature -- sibling of
// proposedScale.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// Geometry logic copied verbatim from proposedScale.fs v2, which
// dropped the dead-end opScale guess in favor of opPattern with a
// scaling Transform (transform(identityMatrix(3) * scale, point)) --
// see proposedScale.fs's header for the full research trail and what's
// still unconfirmed there. Test proposedScale.fs first; once that
// compiles, this sibling should too since the only difference is the
// final appearance styling (edges-only-outline instead of a filled
// duplicate).
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

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(identityMatrix(3) * definition.scaleFactor, pivot)],
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
