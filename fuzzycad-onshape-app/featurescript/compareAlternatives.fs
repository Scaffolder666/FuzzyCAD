FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FuzzyCAD Compare Alternatives - V4
//
// V4 changes the model architecture:
//
//   Comparison slot / placeholder = local body in this Part Studio
//   Current option               = PartStudioData from another Part Studio
//   Alternative A                = PartStudioData from another Part Studio
//   Alternative B (optional)     = PartStudioData from another Part Studio
//
// The three concrete candidates are now symmetric. The current Part Studio
// only owns a temporary placeholder that marks the decision location.
//
// IMPORTANT:
// - Candidate references select an ENTIRE source Part Studio.
// - This deliberately avoids the IMPORT_DERIVED_NO_PARTS failure produced by
//   mesh-only Part Studios. Mesh support is not claimed in this V4.
// - All BRep solid bodies in the referenced Part Studio are treated as one
//   candidate option.
// - No Mate Connector is required on any candidate.
// - The source candidate origin is placed at the placeholder body's bounding-
//   box center. Per-option XYZ translation and XYZ rotation provide manual
//   placement adjustment.
// - While the comparison is open, the placeholder stays in the model but is
//   faded.
// - Once Accept selected sets accepted=true, the chosen candidate remains
//   instantiated and the placeholder is deleted.
//
// UNCONFIRMED (flagging for whoever debugs a compile failure next):
// - `PartStudioItemType.ENTIRE_PART_STUDIO` as a "Filter" value on a
//   PartStudioData parameter -- not verified against a real compile.
// - `source.partQuery` as a writable field on the PartStudioData map --
//   not verified against a real compile.
// If the Feature Studio editor rejects either of these, that is almost
// certainly why nothing reaches the right panel: a Feature Studio that
// doesn't compile publishes no custom feature type, so there is nothing
// to insert and nothing for the panel to detect.
//
// Right-panel protocol stays unchanged:
//   activeOption = "CURRENT" | "ALTERNATIVE_A" | "ALTERNATIVE_B"
//   accepted     = boolean

annotation {
    "Feature Type Name" : "FuzzyCAD Compare Alternatives"
}
export const fuzzycadCompareAlternatives = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        // Local host geometry. This is NOT one of the competing candidates.
        // It only marks where this component decision lives in the current
        // Part Studio.
        annotation {
            "Name" : "Comparison slot",
            "Filter" : EntityType.BODY,
            "MaxNumberOfPicks" : 1
        }
        definition.comparisonSlot is Query;

        // CURRENT OPTION -------------------------------------------------
        // PartStudioData is a real cross-tab reference parameter.
        // V4 deliberately selects the ENTIRE Part Studio rather than an
        // individual solid item. This matches the intended workflow where
        // each candidate lives in its own source Part Studio.
        annotation {
            "Name" : "Current Part Studio",
            "Filter" : PartStudioItemType.ENTIRE_PART_STUDIO,
            "MaxNumberOfPicks" : 1
        }
        definition.currentOption is PartStudioData;

        annotation { "Name" : "Current - Move X" }
        isLength(definition.currentMoveX, LENGTH_BOUNDS);

        annotation { "Name" : "Current - Move Y" }
        isLength(definition.currentMoveY, LENGTH_BOUNDS);

        annotation { "Name" : "Current - Move Z" }
        isLength(definition.currentMoveZ, LENGTH_BOUNDS);

        annotation { "Name" : "Current - Rotate X" }
        isAngle(definition.currentRotateX, ANGLE_360_BOUNDS);

        annotation { "Name" : "Current - Rotate Y" }
        isAngle(definition.currentRotateY, ANGLE_360_BOUNDS);

        annotation { "Name" : "Current - Rotate Z" }
        isAngle(definition.currentRotateZ, ANGLE_360_BOUNDS);

        // ALTERNATIVE A --------------------------------------------------
        annotation {
            "Name" : "Alternative A Part Studio",
            "Filter" : PartStudioItemType.ENTIRE_PART_STUDIO,
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

        // OPTIONAL ALTERNATIVE B ----------------------------------------
        annotation {
            "Name" : "Include a second alternative",
            "Default" : false
        }
        definition.hasAlternativeB is boolean;

        if (definition.hasAlternativeB)
        {
            annotation {
                "Name" : "Alternative B Part Studio",
                "Filter" : PartStudioItemType.ENTIRE_PART_STUDIO,
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

        // Controlled by the FuzzyCAD right panel.
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
        if (isQueryEmpty(context, definition.comparisonSlot))
        {
            throw regenError(
                "Select a local placeholder body for Comparison slot.",
                ["comparisonSlot"]
            );
        }

        // The placeholder defines the slot location only.
        const slotBox = evBox3d(context, {
                "topology" : definition.comparisonSlot,
                "tight" : true
        });

        const slotCenter = vector(
                (slotBox.minCorner[0] + slotBox.maxCorner[0]) / 2,
                (slotBox.minCorner[1] + slotBox.maxCorner[1]) / 2,
                (slotBox.minCorner[2] + slotBox.maxCorner[2]) / 2
        );

        // Pick one candidate and its independently remembered placement.
        var source is PartStudioData = definition.currentOption;
        var moveX = definition.currentMoveX;
        var moveY = definition.currentMoveY;
        var moveZ = definition.currentMoveZ;
        var rotateX = definition.currentRotateX;
        var rotateY = definition.currentRotateY;
        var rotateZ = definition.currentRotateZ;
        var instanceName = "current";

        if (definition.activeOption == "ALTERNATIVE_A")
        {
            source = definition.alternativeA;
            moveX = definition.alternativeAMoveX;
            moveY = definition.alternativeAMoveY;
            moveZ = definition.alternativeAMoveZ;
            rotateX = definition.alternativeARotateX;
            rotateY = definition.alternativeARotateY;
            rotateZ = definition.alternativeARotateZ;
            instanceName = "alternativeA";
        }
        else if (
            definition.activeOption == "ALTERNATIVE_B" &&
            definition.hasAlternativeB)
        {
            source = definition.alternativeB;
            moveX = definition.alternativeBMoveX;
            moveY = definition.alternativeBMoveY;
            moveZ = definition.alternativeBMoveZ;
            rotateX = definition.alternativeBRotateX;
            rotateY = definition.alternativeBRotateY;
            rotateZ = definition.alternativeBRotateZ;
            instanceName = "alternativeB";
        }

        // The reference points at the entire source Part Studio. Instantiate
        // only its BRep solid bodies. This intentionally excludes mesh-only
        // geometry, surfaces, sketches, mate connectors, etc.
        source.partQuery = qBodyType(source.partQuery, BodyType.SOLID);

        // Official PartStudioData -> Instantiator path. Placement is
        // applied via a SEPARATE opTransform call after instantiate(),
        // exactly like V3 (confirmed compiling and inserting live) --
        // V4 originally tried passing "transform" directly inside
        // addInstance's options map, which is not a confirmed field on
        // that map and is the most likely single cause of a compile or
        // silent-no-placement failure. Reverted to the confirmed pattern.
        const instantiator = newInstantiator(id + "activeCandidate");
        const candidateQuery = addInstance(instantiator, source, {
                "name" : instanceName
        });
        instantiate(context, instantiator);

        if (isQueryEmpty(context, candidateQuery))
        {
            throw regenError(
                "The selected candidate Part Studio has no solid bodies to instantiate.",
                [instanceName == "current" ? "currentOption" : instanceName == "alternativeA" ? "alternativeA" : "alternativeB"]
            );
        }

        // Candidate placement:
        //
        // 1. rotate candidate around its own source origin;
        // 2. translate that origin to the placeholder center;
        // 3. apply the saved XYZ offset from that slot center.
        //
        // This intentionally does NOT guess a mounting point from candidate
        // geometry. The collaborator controls the final placement.
        const sourceOrigin = vector(0, 0, 0) * meter;

        const rotateAroundX = rotationAround(
                line(sourceOrigin, X_DIRECTION),
                rotateX
        );

        const rotateAroundY = rotationAround(
                line(sourceOrigin, Y_DIRECTION),
                rotateY
        );

        const rotateAroundZ = rotationAround(
                line(sourceOrigin, Z_DIRECTION),
                rotateZ
        );

        const moveOffset = vector(moveX, moveY, moveZ);
        const translation = transform(slotCenter + moveOffset);

        const placement =
            translation *
            rotateAroundZ *
            rotateAroundY *
            rotateAroundX;

        opTransform(context, id + "placeCandidate", {
                "bodies" : candidateQuery,
                "transform" : placement
        });

        if (definition.accepted)
        {
            // Commit point: the chosen candidate is now the real geometry for
            // this slot. Remove the local placeholder only after acceptance.
            opDeleteBodies(context, id + "removeAcceptedSlot", {
                    "entities" : definition.comparisonSlot
            });
            return;
        }

        // Open comparison: keep the slot query alive and merely fade the
        // placeholder. Switching Current/A/B only changes which external
        // candidate is instantiated; the slot itself is never deleted.
        setProperty(context, {
                "entities" : definition.comparisonSlot,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.06)
        });
    },
    {
        "currentMoveX" : 0 * millimeter,
        "currentMoveY" : 0 * millimeter,
        "currentMoveZ" : 0 * millimeter,
        "currentRotateX" : 0 * degree,
        "currentRotateY" : 0 * degree,
        "currentRotateZ" : 0 * degree,

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
