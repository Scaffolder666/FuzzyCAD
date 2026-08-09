FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FuzzyCAD Compare Alternatives - V3
//
// V3 restores cross-Part-Studio selection WITHOUT requiring Mate Connectors.
//
// Current component:
//   - ordinary Query in the current Part Studio.
//
// Alternative A / B:
//   - PartStudioData reference parameters.
//   - the picker can select a SOLID or imported MESH from another Part Studio.
//   - the selected candidate is instantiated only when that option is active.
//
// Placement:
//   - no Mate Connector is required.
//   - when an alternative first appears, its bounding-box center is placed at
//     the Current component's bounding-box center as a coarse starting point.
//   - this center alignment is ONLY an initial placement aid; it is not treated
//     as semantic mounting alignment.
//   - Move X/Y/Z and Rotate X/Y/Z let the collaborator place the candidate
//     manually.
//   - while editing this feature, translation and rotation manipulators expose
//     the same placement parameters directly in the viewport.
//
// Right-panel compatibility:
//   - keeps the existing hidden string parameter `activeOption` because the
//     current FuzzyCAD right panel already reads/writes it.
//   - keeps the existing hidden `accepted` boolean for Accept/Reopen.
//
// Only the selected alternative is instantiated. When Current is active, no
// alternative geometry is brought into this Part Studio at all. Rejecting the
// feature therefore naturally removes the instantiated alternative and restores
// Current.

annotation {
    "Feature Type Name" : "FuzzyCAD Compare Alternatives",
    "Manipulator Change Function" : "compareAlternativesManipulatorChange"
}
export const fuzzycadCompareAlternatives = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation {
            "Name" : "Current component",
            "Filter" : EntityType.BODY && AllowMeshGeometry.YES,
            "MaxNumberOfPicks" : 1
        }
        definition.currentComponent is Query;

        // Reference parameter: this is what restores selecting an object
        // from another Part Studio/tab.
        annotation {
            "Name" : "Alternative A",
            "MaxNumberOfPicks" : 1
        }
        definition.alternativeA is PartStudioData;

        annotation { "Name" : "Alternative A - Move X" }
        isLength(definition.alternativeAMoveX, LENGTH_BOUNDS);

        annotation { "Name" : "Alternative A - Move Y" }
        isLength(definition.alternativeAMoveY, LENGTH_BOUNDS);

        annotation { "Name" : "Alternative A - Move Z" }
        isLength(definition.alternativeAMoveZ, LENGTH_BOUNDS);

        annotation { "Name" : "Alternative A - Rotate X" }
        isAngle(definition.alternativeARotateX, ANGLE_360_BOUNDS);

        annotation { "Name" : "Alternative A - Rotate Y" }
        isAngle(definition.alternativeARotateY, ANGLE_360_BOUNDS);

        annotation { "Name" : "Alternative A - Rotate Z" }
        isAngle(definition.alternativeARotateZ, ANGLE_360_BOUNDS);

        annotation {
            "Name" : "Include a second alternative",
            "Default" : false
        }
        definition.hasAlternativeB is boolean;

        if (definition.hasAlternativeB)
        {
            annotation {
                "Name" : "Alternative B",
                "MaxNumberOfPicks" : 1
            }
            definition.alternativeB is PartStudioData;

            annotation { "Name" : "Alternative B - Move X" }
            isLength(definition.alternativeBMoveX, LENGTH_BOUNDS);

            annotation { "Name" : "Alternative B - Move Y" }
            isLength(definition.alternativeBMoveY, LENGTH_BOUNDS);

            annotation { "Name" : "Alternative B - Move Z" }
            isLength(definition.alternativeBMoveZ, LENGTH_BOUNDS);

            annotation { "Name" : "Alternative B - Rotate X" }
            isAngle(definition.alternativeBRotateX, ANGLE_360_BOUNDS);

            annotation { "Name" : "Alternative B - Rotate Y" }
            isAngle(definition.alternativeBRotateY, ANGLE_360_BOUNDS);

            annotation { "Name" : "Alternative B - Rotate Z" }
            isAngle(definition.alternativeBRotateZ, ANGLE_360_BOUNDS);
        }

        // Existing right-panel state. Keep this exact parameter ID/value
        // convention because page.tsx already reads/writes it.
        annotation {
            "Name" : "Active option",
            "Default" : "CURRENT",
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.activeOption is string;

        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        const currentBodies = evaluateQuery(context, definition.currentComponent);
        if (size(currentBodies) != 1)
        {
            throw regenError(
                "Select exactly one Current component (currently resolves to "
                    ~ toString(size(currentBodies))
                    ~ " -- Current must be picked from THIS Part Studio; use "
                    ~ "Alternative A/B for a body from another tab).",
                ["currentComponent"]
            );
        }

        // CURRENT: upstream Current geometry is already the desired result.
        // Do not instantiate anything from another Part Studio.
        if (definition.activeOption == "CURRENT")
        {
            return;
        }

        const useAlternativeB =
            definition.activeOption == "ALTERNATIVE_B" &&
            definition.hasAlternativeB;

        var source is PartStudioData = definition.alternativeA;
        var moveX = definition.alternativeAMoveX;
        var moveY = definition.alternativeAMoveY;
        var moveZ = definition.alternativeAMoveZ;
        var rotateX = definition.alternativeARotateX;
        var rotateY = definition.alternativeARotateY;
        var rotateZ = definition.alternativeARotateZ;
        var parameterName = "alternativeA";

        if (useAlternativeB)
        {
            source = definition.alternativeB;
            moveX = definition.alternativeBMoveX;
            moveY = definition.alternativeBMoveY;
            moveZ = definition.alternativeBMoveZ;
            rotateX = definition.alternativeBRotateX;
            rotateY = definition.alternativeBRotateY;
            rotateZ = definition.alternativeBRotateZ;
            parameterName = "alternativeB";
        }

        // PartStudioData goes directly into the official Instantiator.
        // addInstance returns a query which resolves to the newly instantiated
        // candidate after instantiate() runs.
        const instantiator = newInstantiator(id + "candidateInstantiator");
        const candidateQuery = addInstance(instantiator, source, {
                "name" : useAlternativeB ? "alternativeB" : "alternativeA"
        });
        instantiate(context, instantiator);

        if (isQueryEmpty(context, candidateQuery))
        {
            throw regenError(
                "The selected alternative did not produce any body geometry.",
                [parameterName]
            );
        }

        // Coarse initial placement only: center the downloaded/reference
        // candidate on Current. This is intentionally NOT a claim that the
        // centers are semantically corresponding mounting points. The user
        // corrects the final placement with the six placement parameters or
        // viewport manipulators below.
        const currentBox = evBox3d(context, {
                    "topology" : definition.currentComponent,
                    "tight" : true
        });
        const candidateBox = evBox3d(context, {
                    "topology" : candidateQuery,
                    "tight" : true
        });

        const currentCenter = boxCenter(currentBox);
        const candidateCenter = boxCenter(candidateBox);
        const centerAlignment = transform(currentCenter - candidateCenter);

        // World-axis rotations around Current's center. Translation is applied
        // last, so rotations remain centered on the candidate even after it is
        // moved away from Current's exact center.
        const rotateAroundX = rotationAround(
                line(currentCenter, X_DIRECTION),
                rotateX
        );
        const rotateAroundY = rotationAround(
                line(currentCenter, Y_DIRECTION),
                rotateY
        );
        const rotateAroundZ = rotationAround(
                line(currentCenter, Z_DIRECTION),
                rotateZ
        );

        const moveTransform = transform(vector(moveX, moveY, moveZ));

        // FeatureScript transform multiplication applies the right-most
        // transform first:
        // 1. center candidate on Current
        // 2. rotate X
        // 3. rotate Y
        // 4. rotate Z
        // 5. apply user translation
        const placement =
            moveTransform *
            rotateAroundZ *
            rotateAroundY *
            rotateAroundX *
            centerAlignment;

        opTransform(context, id + "placeCandidate", {
                "bodies" : candidateQuery,
                "transform" : placement
        });

        // Only one candidate occupies the design at a time. Current is an
        // upstream body, so deleting it inside this feature is reversible:
        // switching activeOption back to CURRENT regenerates from upstream and
        // Current naturally exists again.
        opDeleteBodies(context, id + "removeCurrent", {
                "entities" : definition.currentComponent
        });

        // Placement manipulators are only interactive while the native feature
        // dialog is open. They are deliberately disabled after Accept.
        if (!definition.accepted)
        {
            addPlacementManipulators(
                    context,
                    id,
                    currentBox,
                    currentCenter,
                    moveX,
                    moveY,
                    moveZ,
                    rotateX,
                    rotateY,
                    rotateZ
            );
        }
    },
    {
        "alternativeAMoveX" : 0 * millimeter,
        "alternativeAMoveY" : 0 * millimeter,
        "alternativeAMoveZ" : 0 * millimeter,
        "alternativeARotateX" : 0 * degree,
        "alternativeARotateY" : 0 * degree,
        "alternativeARotateZ" : 0 * degree,
        "alternativeBMoveX" : 0 * millimeter,
        "alternativeBMoveY" : 0 * millimeter,
        "alternativeBMoveZ" : 0 * millimeter,
        "alternativeBRotateX" : 0 * degree,
        "alternativeBRotateY" : 0 * degree,
        "alternativeBRotateZ" : 0 * degree
    });

function boxCenter(bbox is Box3d) returns Vector
{
    return vector(
            (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
            (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
            (bbox.minCorner[2] + bbox.maxCorner[2]) / 2
    );
}

function addPlacementManipulators(
    context is Context,
    id is Id,
    currentBox is Box3d,
    currentCenter is Vector,
    moveX is ValueWithUnits,
    moveY is ValueWithUnits,
    moveZ is ValueWithUnits,
    rotateX is ValueWithUnits,
    rotateY is ValueWithUnits,
    rotateZ is ValueWithUnits)
{
    const moveOffset = vector(moveX, moveY, moveZ);
    const placedCenter = currentCenter + moveOffset;

    const boxSize = norm(currentBox.maxCorner - currentBox.minCorner);
    const radius = max(boxSize * 0.35, 12 * millimeter);

    addManipulators(context, id, {
            "placementMove" : triadManipulator({
                    "base" : currentCenter,
                    "offset" : moveOffset
            }),
            "placementRotateX" : angularManipulator({
                    "axisOrigin" : placedCenter,
                    "axisDirection" : X_DIRECTION,
                    "rotationOrigin" : placedCenter + Y_DIRECTION * radius,
                    "angle" : rotateX
            }),
            "placementRotateY" : angularManipulator({
                    "axisOrigin" : placedCenter,
                    "axisDirection" : Y_DIRECTION,
                    "rotationOrigin" : placedCenter + Z_DIRECTION * radius,
                    "angle" : rotateY
            }),
            "placementRotateZ" : angularManipulator({
                    "axisOrigin" : placedCenter,
                    "axisDirection" : Z_DIRECTION,
                    "rotationOrigin" : placedCenter + X_DIRECTION * radius,
                    "angle" : rotateZ
            })
    });
}

export function compareAlternativesManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map) returns map
{
    const useAlternativeB =
        definition.activeOption == "ALTERNATIVE_B" &&
        definition.hasAlternativeB;

    if (newManipulators["placementMove"] != undefined)
    {
        const newOffset = newManipulators["placementMove"].offset;

        if (useAlternativeB)
        {
            definition.alternativeBMoveX = newOffset[0];
            definition.alternativeBMoveY = newOffset[1];
            definition.alternativeBMoveZ = newOffset[2];
        }
        else
        {
            definition.alternativeAMoveX = newOffset[0];
            definition.alternativeAMoveY = newOffset[1];
            definition.alternativeAMoveZ = newOffset[2];
        }
    }

    if (newManipulators["placementRotateX"] != undefined)
    {
        if (useAlternativeB)
        {
            definition.alternativeBRotateX =
                newManipulators["placementRotateX"].angle;
        }
        else
        {
            definition.alternativeARotateX =
                newManipulators["placementRotateX"].angle;
        }
    }

    if (newManipulators["placementRotateY"] != undefined)
    {
        if (useAlternativeB)
        {
            definition.alternativeBRotateY =
                newManipulators["placementRotateY"].angle;
        }
        else
        {
            definition.alternativeARotateY =
                newManipulators["placementRotateY"].angle;
        }
    }

    if (newManipulators["placementRotateZ"] != undefined)
    {
        if (useAlternativeB)
        {
            definition.alternativeBRotateZ =
                newManipulators["placementRotateZ"].angle;
        }
        else
        {
            definition.alternativeARotateZ =
                newManipulators["placementRotateZ"].angle;
        }
    }

    return definition;
}
