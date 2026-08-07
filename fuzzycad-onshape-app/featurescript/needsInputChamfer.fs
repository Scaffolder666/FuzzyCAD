// FuzzyCAD "Needs Input Chamfer" custom feature -- sibling of
// proposedChamfer.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// Geometry logic copied verbatim from proposedChamfer.fs (itself copied
// from the confirmed-live proposedFillet.fs, swapping opFillet for
// opChamfer with a "width" key -- still unconfirmed, same risk noted in
// proposedChamfer.fs).
//
// Visual language CHANGED from the original plan: "outline only" isn't
// achievable -- confirmed live, setProperty's APPEARANCE property only
// accepts BODY or FACE, not EDGE. Fixed by coloring the whole proposed
// body in a different hue (amber) from Proposed*'s blue instead --
// same fix as needsInputFillet.fs.
//
// "width" starts at whatever placeholder value whoever inserts this
// leaves it at -- someone else fills in the real number via the right
// panel's existing live-edit path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Chamfer" }
export const fuzzycadNeedsInputChamfer = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to chamfer", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Edge to chamfer", "Filter" : EntityType.EDGE }
        definition.edge is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, LENGTH_BOUNDS);
    }
    {
        const originalBody = definition.body;

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const midpoint = evEdgeTangentLine(context, {
                "edge" : definition.edge,
                "parameter" : 0.5
        }).origin;

        const copiedEdges = qCreatedBy(id + "duplicate", EntityType.EDGE);
        const matchedEdge = qClosestTo(copiedEdges, midpoint);

        opChamfer(context, id + "chamfer", {
                "entities" : matchedEdge,
                "width" : definition.width
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
