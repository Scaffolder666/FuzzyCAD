// FuzzyCAD "Needs Input Rotate" custom feature -- sibling of
// proposedRotate.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// Geometry logic copied verbatim from proposedRotate.fs. rotationAround()
// and line() are now independently confirmed real (found used exactly
// this way in a working reference source the user found), so this is
// lower-risk than earlier noted.
//
// Visual language CHANGED from the original plan: "outline only" isn't
// achievable -- confirmed live, setProperty's APPEARANCE property only
// accepts BODY or FACE, not EDGE. Fixed by coloring the whole proposed
// body in a different hue (amber) from Proposed*'s blue instead -- same
// fix as needsInputFillet.fs.
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
        isAngle(definition.angle, ANGLE_360_BOUNDS);
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

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);
        setProperty(context, {
                "entities" : proposedBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(1.0, 0.65, 0.0, 1.0)
        });
    });
