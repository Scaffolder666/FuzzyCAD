// FuzzyCAD "Needs Input Rotate" custom feature -- sibling of
// proposedRotate.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// Geometry logic copied verbatim from proposedRotate.fs, which is
// itself still UNCONFIRMED (rotationAround()/line() haven't compiled
// live yet as of this writing) -- test proposedRotate.fs first; once
// that compiles, this sibling should too since the only difference is
// the final appearance styling (edges-only-outline, same as
// needsInputFillet.fs, instead of a filled duplicate).
//
// "Angle" starts at whatever placeholder value (e.g. 0) whoever inserts
// this leaves it at -- someone else fills in the real angle via the
// right panel's existing live-edit path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Rotate" }
export const fuzzycadNeedsInputRotate = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to rotate", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Rotation axis", "Filter" : EntityType.EDGE }
        definition.axis is Query;

        annotation { "Name" : "Angle" }
        isAngle(definition.angle, ANGLE_BOUNDS);
    }
    {
        const originalBody = definition.body;

        const axisStart = evEdgeTangentLine(context, {
                "edge" : definition.axis,
                "parameter" : 0.0
        }).origin;

        const axisEnd = evEdgeTangentLine(context, {
                "edge" : definition.axis,
                "parameter" : 1.0
        }).origin;

        const axisDirection = normalize(axisEnd - axisStart);
        const rotation = rotationAround(line(axisStart, axisDirection), definition.angle);

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [rotation],
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
