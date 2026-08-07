// FuzzyCAD "Needs Input Hole" custom feature -- sibling of
// proposedHole.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// Geometry logic copied verbatim from proposedHole.fs, which is itself
// still UNCONFIRMED (NewBodyOperationType.REMOVE + "booleanScope" have
// not compiled live yet as of this writing) -- test proposedHole.fs
// first, INCLUDING its safety check that the original body doesn't get
// cut too, before trusting this sibling.
//
// Visual language CHANGED from the original plan: "outline only" isn't
// achievable -- confirmed live, setProperty's APPEARANCE property only
// accepts BODY or FACE, not EDGE. Fixed by coloring the whole proposed
// body in a different hue (amber) from Proposed*'s blue instead -- same
// fix as needsInputFillet.fs.
//
// "Depth" starts at whatever placeholder value whoever inserts this
// leaves it at -- someone else fills in the real depth via the right
// panel's existing live-edit path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Hole" }
export const fuzzycadNeedsInputHole = defineFeature(function(context is Context, id is Id, definition is map)
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
                "value" : color(1.0, 0.65, 0.0, 1.0)
        });
    });
