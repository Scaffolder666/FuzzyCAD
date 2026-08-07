// FuzzyCAD "Proposed Rotate" custom feature -- DRAFT, not yet compiled.
// Reuses the confirmed opPattern-duplicate + setProperty-style pieces
// from proposedFillet.fs/proposedMove.fs, but needs genuinely NEW,
// UNCONFIRMED FeatureScript to build a rotation Transform:
//
//   1. The rotation axis is picked as an EDGE (definition.axis). Its
//      origin point at two different parameters (0.0 and 1.0) is read
//      via evEdgeTangentLine -- reusing ONLY the ".origin" field, which
//      IS confirmed working (used throughout proposedFillet.fs). The
//      axis direction is then computed as the difference between those
//      two points, normalized -- ordinary vector math, not a new guess.
//   2. line(origin, direction) -- guessed constructor for a Line value.
//      Not confirmed.
//   3. rotationAround(axis is Line, angle is ValueWithUnits) returns
//      Transform -- guessed function name/signature for building a
//      rotation Transform. Not confirmed. This is the single biggest
//      risk in this file; if it doesn't compile, paste the exact error
//      and I'll adjust from there rather than guessing again blind.
//   4. isAngle(definition.angle, ANGLE_BOUNDS) -- guessed by analogy
//      with isLength(..., LENGTH_BOUNDS), which IS confirmed working for
//      Extrude's depth and Fillet's radius. The bound constant name
//      (ANGLE_BOUNDS) is the guessed part; LENGTH_BOUNDS's real name
//      being confirmed doesn't guarantee this one's spelling.
//
// Same appearance-styling approach and same known REST-override
// limitation as proposedFillet.fs/proposedMove.fs.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Rotate" }
export const fuzzycadProposedRotate = defineFeature(function(context is Context, id is Id, definition is map)
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

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        setProperty(context, {
                "entities" : proposedBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.25, 0.55, 0.95, 1.0)
        });
    });
