// FuzzyCAD "Needs Input Fillet" custom feature -- sibling of
// proposedFillet.fs, a separate Cosmo Feature type (not a mode flag) --
// see needsInputExtrude.fs's header comment for the full rationale on
// why these are separate types and how the lifecycle differs from
// Proposed*.
//
// Geometry logic (duplicate the body, match the picked edge on the
// copy, fillet it) is copied verbatim from proposedFillet.fs, confirmed
// live.
//
// Visual language CHANGED from the original plan: "outline only" (color
// just the duplicate's edges, leave faces normal) is not achievable --
// confirmed live, setProperty's APPEARANCE property only accepts BODY
// or FACE entities, not EDGE ("APPEARANCE property can only be applied
// to bodies and faces"). Fixed here by coloring the whole proposed body
// instead, but in a DIFFERENT hue (amber) from Proposed*'s blue, so
// Needs Input and Proposed stay visually distinguishable even though
// both are now "filled" rather than one being an outline.
//
// "radius" starts at whatever placeholder value whoever inserts this
// leaves it at -- someone else fills in the real number via the right
// panel's existing live-edit path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Fillet" }
export const fuzzycadNeedsInputFillet = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to fillet", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Edge to round", "Filter" : EntityType.EDGE }
        definition.edge is Query;

        annotation { "Name" : "Radius" }
        isLength(definition.radius, LENGTH_BOUNDS);
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

        opFillet(context, id + "fillet", {
                "entities" : matchedEdge,
                "radius" : definition.radius
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
