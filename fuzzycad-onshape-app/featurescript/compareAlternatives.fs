FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FuzzyCAD Compare Alternatives - V5
//
// V5 keeps V4's symmetric candidate model, but separates two concepts V4
// still coupled together:
//
//   comparisonSlot = the local body that tells collaborators WHERE this
//                    design decision lives.
//   anchor         = the persistent world-space point used to place every
//                    candidate while Current / Alternative A / Alternative B
//                    are switched repeatedly.
//
// V4's bug (confirmed by reading its own body, not by compiling): every
// candidate was rotated/translated around a hardcoded world-origin point
// (`vector(0, 0, 0) * meter`), i.e. V4 assumed each candidate's source Part
// Studio was modeled around world origin. Any two candidates modeled at
// different distances from their own origin would misalign on switching.
// V5 replaces this with candidate-center-based placement (see below) and a
// FIXED anchor point instead of a value re-derived from comparisonSlot's
// current bounding box every regen.
//
// When `useStoredAnchor` is true, the anchor is supplied once (e.g. by a
// future FuzzyCAD panel setup flow) and never recomputed from mutable
// geometry. Existing/manual instances and anything inserted without setting
// this (the toolbar's current "compare" tool included -- see
// buildCustomFeatureParameters's "compare" case in parameter-mark-panel/
// page.tsx, which deliberately omits useStoredAnchor/anchorX/Y/Z and lets
// them fall back to these defaults) stay on the V4 behavior: the slot
// body's current bounding-box center, recomputed live.
//
// Candidate references select an ENTIRE source Part Studio. All BRep solid
// bodies in that referenced Part Studio are treated as one candidate
// option. Each candidate remembers its own XYZ translation and XYZ
// rotation.
//
// Placement is candidate-center based rather than source-origin based: a
// source Part Studio does not need to have been modeled around world
// origin. Its instantiated bounding-box center is aligned to the anchor,
// then that candidate's own saved transform is applied around its own
// center.
//
// Right-panel protocol:
//   protocolVersion = "COMPARE_V5_ANCHOR"
//   activeOption    = "CURRENT" | "ALTERNATIVE_A" | "ALTERNATIVE_B"
//   accepted        = boolean
//
// CONFIRMED THIS SESSION (checked against Onshape's own FeatureScript docs
// and forum, not a real compile -- flagging for whoever debugs a compile
// failure next):
// - `PartStudioItemType.ENTIRE_PART_STUDIO` as a "Filter" value on a
//   PartStudioData parameter IS a real, documented pattern (Onshape's own
//   FsDoc examples use `Filter: PartStudioItemType.SOLID ||
//   PartStudioItemType.ENTIRE_PART_STUDIO`). There was a real bug where a
//   Filter of ENTIRE_PART_STUDIO ALONE (exactly what's used here, no other
//   type combined) failed with "No entities or features available"
//   (forum.onshape.com/discussion/14071) -- an Onshape employee said this
//   should be fixed as of September 2020, so likely fine now, but that's a
//   report, not a retest.
// - `defineFeature(function(...) precondition {...} {...}, {defaults})` --
//   a trailing map as a second argument to defineFeature, used below for
//   every isLength/isAngle-bounded parameter without an inline "Default"
//   annotation -- IS real, documented Onshape syntax (forum.onshape.com/
//   discussion/18107 and /24513 both show this exact form: FeatureScript
//   has "FeatureScript defaults" supplied this way, distinct from "UI
//   defaults" supplied via inline annotation, since isLength/isAngle
//   parameters can't carry an inline "Default" the way boolean/string ones
//   can). This session initially (wrongly) suspected this pattern as
//   unprecedented/invalid; it isn't.
// STILL UNCONFIRMED BY ME THIS SESSION (only checked by reading this file's
// own prior comments, not independently verified):
// - `source.partQuery` as a writable field on the PartStudioData map, and
//   the newInstantiator/addInstance/instantiate sequence below, going
//   through a SEPARATE opTransform call afterward rather than a "transform"
//   key inside addInstance's own options map. A prior comment in this same
//   file claimed this exact shape matched "V3 (confirmed compiling and
//   inserting live)" before this session started working on Compare --
//   that's a secondhand claim from this file's own history, not something
//   verified fresh here.
// - The REST Feature API's wire serialization for a PartStudioData
//   parameter (what JSON shape a POST .../features body needs for
//   currentOption/alternativeA/alternativeB) has never been captured live
//   and isn't documented anywhere found so far. The toolbar's insert path
//   works around this by omitting these parameters from the insert JSON
//   entirely and letting Onshape's native dialog collect them post-insert.
// If the Feature Studio editor rejects any of the FeatureScript itself,
// that is almost certainly why nothing reaches the right panel: a Feature
// Studio that doesn't compile publishes no custom feature type, so there
// is nothing to insert and nothing for the panel to detect.

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

        // Persistent anchor, written once by a future setup flow. Stays
        // hidden in Onshape's native dialog: this is protocol state, not a
        // value a collaborator should type in by hand.
        annotation {
            "Name" : "Use stored anchor",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.useStoredAnchor is boolean;

        annotation {
            "Name" : "Anchor X",
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        isLength(definition.anchorX, LENGTH_BOUNDS);

        annotation {
            "Name" : "Anchor Y",
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        isLength(definition.anchorY, LENGTH_BOUNDS);

        annotation {
            "Name" : "Anchor Z",
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        isLength(definition.anchorZ, LENGTH_BOUNDS);

        // CURRENT OPTION -------------------------------------------------
        // PartStudioData is a real cross-tab reference parameter.
        // V4/V5 deliberately select the ENTIRE Part Studio rather than an
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
            "Name" : "Protocol version",
            "Default" : "COMPARE_V5_ANCHOR",
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.protocolVersion is string;

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

        // Backward-compatible fallback for manually created / pre-V5
        // instances, and for anything inserted (like the toolbar's
        // "compare" tool today) without ever setting useStoredAnchor: the
        // slot body's current bounding-box center is used exactly as V4
        // did. Once a real setup flow starts writing a persistent anchor
        // with useStoredAnchor=true, repeated candidate switching no
        // longer depends on re-measuring the slot body every regen.
        var anchorCenter = vector(
                definition.anchorX,
                definition.anchorY,
                definition.anchorZ
        );

        if (!definition.useStoredAnchor)
        {
            const slotBox = evBox3d(context, {
                    "topology" : definition.comparisonSlot,
                    "tight" : true
            });

            anchorCenter = vector(
                    (slotBox.minCorner[0] + slotBox.maxCorner[0]) / 2,
                    (slotBox.minCorner[1] + slotBox.maxCorner[1]) / 2,
                    (slotBox.minCorner[2] + slotBox.maxCorner[2]) / 2
            );
        }

        // Pick one candidate and its independently remembered placement.
        var source is PartStudioData = definition.currentOption;
        var moveX = definition.currentMoveX;
        var moveY = definition.currentMoveY;
        var moveZ = definition.currentMoveZ;
        var rotateX = definition.currentRotateX;
        var rotateY = definition.currentRotateY;
        var rotateZ = definition.currentRotateZ;
        var instanceName = "current";
        var parameterName = "currentOption";

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
            parameterName = "alternativeA";
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
            parameterName = "alternativeB";
        }

        // The reference points at the entire source Part Studio. Instantiate
        // only its BRep solid bodies. This intentionally excludes mesh-only
        // geometry, surfaces, sketches, mate connectors, etc.
        source.partQuery = qBodyType(source.partQuery, BodyType.SOLID);

        // Official PartStudioData -> Instantiator path. Placement is
        // applied via a SEPARATE opTransform call after instantiate(),
        // exactly like V3 (per this file's own prior history -- see the
        // header comment's "STILL UNCONFIRMED BY ME" section, this specific
        // claim is secondhand, not verified fresh this session). Passing a
        // "transform" key directly inside addInstance's options map is NOT
        // a confirmed field on that map -- avoid re-introducing it.
        const instantiator = newInstantiator(id + "activeCandidate");
        const candidateQuery = addInstance(instantiator, source, {
                "name" : instanceName
        });
        instantiate(context, instantiator);

        if (isQueryEmpty(context, candidateQuery))
        {
            throw regenError(
                "The selected candidate Part Studio has no solid bodies to instantiate.",
                [parameterName]
            );
        }

        // Candidate-center alignment avoids assuming that every source Part
        // Studio was modeled around world origin (V4's bug -- see header).
        // Rotation is around the candidate's own instantiated center;
        // translation then places that same center at the fixed anchor +
        // this option's saved XYZ offset.
        const candidateBox = evBox3d(context, {
                "topology" : candidateQuery,
                "tight" : true
        });

        const candidateCenter = vector(
                (candidateBox.minCorner[0] + candidateBox.maxCorner[0]) / 2,
                (candidateBox.minCorner[1] + candidateBox.maxCorner[1]) / 2,
                (candidateBox.minCorner[2] + candidateBox.maxCorner[2]) / 2
        );

        const rotateAroundX = rotationAround(
                line(candidateCenter, X_DIRECTION),
                rotateX
        );

        const rotateAroundY = rotationAround(
                line(candidateCenter, Y_DIRECTION),
                rotateY
        );

        const rotateAroundZ = rotationAround(
                line(candidateCenter, Z_DIRECTION),
                rotateZ
        );

        const moveOffset = vector(moveX, moveY, moveZ);
        const moveCenterToAnchor =
            transform(anchorCenter + moveOffset - candidateCenter);

        const placement =
            moveCenterToAnchor *
            rotateAroundZ *
            rotateAroundY *
            rotateAroundX;

        opTransform(context, id + "placeCandidate", {
                "bodies" : candidateQuery,
                "transform" : placement
        });

        if (definition.accepted)
        {
            // Commit point: the chosen candidate remains as final geometry.
            // The local slot marker is removed only here. Reopening the
            // feature regenerates from upstream, so the slot can return.
            opDeleteBodies(context, id + "removeAcceptedSlot", {
                    "entities" : definition.comparisonSlot
            });
            return;
        }

        // Open comparison: slot stays alive. Current/A/B switching only
        // changes which external candidate is instantiated.
        setProperty(context, {
                "entities" : definition.comparisonSlot,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.06)
        });
    },
    {
        "useStoredAnchor" : false,
        "anchorX" : 0 * millimeter,
        "anchorY" : 0 * millimeter,
        "anchorZ" : 0 * millimeter,

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
