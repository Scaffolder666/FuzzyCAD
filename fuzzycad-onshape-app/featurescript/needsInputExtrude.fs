// FuzzyCAD "Needs Input Extrude" custom feature -- DRAFT, not yet
// compiled. Sibling of proposedExtrude.fs, NOT a mode flag on it: this
// is a deliberately separate Cosmo Feature type, so it shows up as its
// own distinct entry in Onshape's own Insert toolbar, next to (not
// buried inside) "FuzzyCAD Proposed Extrude".
//
// Semantic difference from Proposed*: whoever inserts THIS one knows an
// extrude is needed here but does not know the depth yet -- "depth"
// starts at whatever placeholder value they leave it at (e.g. 0 or a
// round default), and someone else fills in the real number later via
// the right panel's existing live-edit mechanism (no new plumbing
// needed there, it's the same BTMParameterQuantity edit path already
// built for Proposed*). There's no "Accept becomes final" step the way
// Proposed* has -- once answered, this is just marked resolved directly
// (the answerer IS the domain expert supplying ground truth, not a
// guess for someone else to confirm).
//
// Geometry logic is copied verbatim from proposedExtrude.fs (confirmed
// live). The ONLY change: proposedExtrude.fs deliberately has NO
// in-script appearance styling (relies on the right panel's REST-based
// opacity toggle instead) -- this version DOES self-style, using the
// same setProperty-on-edges technique confirmed working for
// proposedFillet.fs, so it reads as an "outline highlight" (edges only,
// bright) rather than Proposed*'s "filled volume" look, distinguishing
// "needs a decision" from "here's a concrete proposal" at a glance
// without needing a different color family.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Extrude" }
export const fuzzycadNeedsInputExtrude = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Entities to extrude", "Filter" : EntityType.FACE }
        definition.entities is Query;

        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);

        annotation { "Name" : "Opposite direction", "Default" : false }
        definition.oppositeDirection is boolean;
    }
    {
        const facesToExtrude = evaluateQuery(context, definition.entities);
        var direction = evFaceTangentPlane(context, {
                "face" : facesToExtrude[0],
                "parameter" : vector(0.5, 0.5)
            }).normal;
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

        const newEdges = qCreatedBy(id + "extrude1", EntityType.EDGE);
        setProperty(context, {
                "entities" : newEdges,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.3, 0.7, 1.0, 1.0)
        });
    });
