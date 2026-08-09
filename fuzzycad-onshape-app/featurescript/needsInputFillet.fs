FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");


//////////////////////////////////////////////////////////////////////
//
// FUZZYCAD NEEDS INPUT FILLET
//
// UI:
//   - Select EDGE(s) or FACE(s) directly.
//   - No separate BODY selector.
//   - Radius may remain unresolved.
//
// PENDING:
//
//   selected EDGE/FACE
//          ↓
//   automatically find owner body
//          ↓
//   track selected topology
//          ↓
//   zero-offset duplicate whole body
//          ↓
//   recover tracked EDGE/FACE on duplicate
//          ↓
//   fillet duplicate
//          ↓
//   draw fuzzy visualization over ENTIRE resulting body
//          ↓
//   delete exact duplicate
//
// ACCEPTED:
//
//   selected EDGE/FACE
//          ↓
//   opFillet directly on real body
//
// This restores the original FuzzyCAD visual language:
// the entire proposed object becomes provisional / sketchy,
// instead of visually emphasizing only the fillet patch.
//
//////////////////////////////////////////////////////////////////////


annotation
{
    "Feature Type Name" :
        "FuzzyCAD Needs Input Fillet",

    "Manipulator Change Function" :
        "fuzzycadNeedsInputFilletManipulatorChange"
}

export const fuzzycadNeedsInputFillet =
defineFeature(function(
    context is Context,
    id is Id,
    definition is map)
    precondition
    {
        //////////////////////////////////////////////////////////////////
        // NATIVE-STYLE SELECTION
        //
        // Keep parameter id "edge" so existing right-panel code does not
        // need to change unnecessarily.
        //////////////////////////////////////////////////////////////////

        annotation
        {
            "Name" :
                "Edges or faces to fillet",

            "Filter" :
                (EntityType.EDGE || EntityType.FACE)
                &&
                BodyType.SOLID
        }
        definition.edge is Query;


        //////////////////////////////////////////////////////////////////
        // FILLET RADIUS
        //////////////////////////////////////////////////////////////////

        annotation
        {
            "Name" :
                "Radius"
        }
        isLength(
            definition.radius,
            BLEND_BOUNDS
        );


        //////////////////////////////////////////////////////////////////
        // TRUE = the collaborator knows filleting is needed,
        // but does not yet know the radius.
        //////////////////////////////////////////////////////////////////

        annotation
        {
            "Name" :
                "Radius needs input",

            "Default" :
                true
        }
        definition.radiusNeedsInput is boolean;


        //////////////////////////////////////////////////////////////////
        // Controlled by FuzzyCAD right panel.
        //////////////////////////////////////////////////////////////////

        annotation
        {
            "Name" :
                "Accepted",

            "Default" :
                false,

            "UIHint" :
                UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        //////////////////////////////////////////////////////////////////
        // No selection yet.
        //////////////////////////////////////////////////////////////////

        if (
            isQueryEmpty(
                context,
                definition.edge
            )
        )
        {
            return;
        }


        //////////////////////////////////////////////////////////////////
        // Automatically derive owning body/bodies.
        //
        // The user no longer selects a body manually.
        //////////////////////////////////////////////////////////////////

        const originalBodies =
            qOwnerBody(
                definition.edge
            );


        //////////////////////////////////////////////////////////////////
        //
        // ACCEPTED STATE
        //
        // Send the original EDGE/FACE query directly to opFillet.
        //
        //////////////////////////////////////////////////////////////////

        if (
            definition.accepted
        )
        {
            opFillet(
                context,
                id + "acceptedFillet",
                {
                    "entities" :
                        definition.edge,

                    "radius" :
                        definition.radius,

                    "tangentPropagation" :
                        true,

                    "crossSection" :
                        FilletCrossSection.CIRCULAR
                }
            );


            return;
        }


        //////////////////////////////////////////////////////////////////
        //
        // PENDING STATE
        //
        //////////////////////////////////////////////////////////////////


        //////////////////////////////////////////////////////////////////
        // Start tracking the selected topology BEFORE duplication.
        //
        // We use this instead of the old:
        //
        //     midpoint
        //        ↓
        //     qClosestTo
        //
        // correspondence logic.
        //////////////////////////////////////////////////////////////////

        const trackedSelection =
            startTracking(
                context,
                definition.edge
            );


        //////////////////////////////////////////////////////////////////
        // Duplicate the complete owning body.
        //
        // This exact body exists only temporarily so that we can build a
        // COMPLETE fuzzy proposed object.
        //////////////////////////////////////////////////////////////////

        opPattern(
            context,
            id + "duplicate",
            {
                "entities" :
                    originalBodies,

                "transforms" :
                    [
                        transform(
                            vector(
                                0,
                                0,
                                0
                            )
                            *
                            meter
                        )
                    ],

                "instanceNames" :
                    [
                        "proposed"
                    ]
            }
        );


        //////////////////////////////////////////////////////////////////
        // Query only the pattern copy.
        //////////////////////////////////////////////////////////////////

        const proposedBody =
            qPatternInstances(
                id + "duplicate",
                "proposed",
                EntityType.BODY
            );


        //////////////////////////////////////////////////////////////////
        // Track the selected EDGE/FACE onto the duplicated body.
        //
        // qOwnedByBody(queryToFilter, body) keeps only tracked entities
        // belonging to the duplicate.
        //////////////////////////////////////////////////////////////////

        const copiedSelection =
            qOwnedByBody(
                trackedSelection,
                proposedBody
            );


        //////////////////////////////////////////////////////////////////
        // Safety check.
        //
        // If topology tracking gives us nothing, report the actual
        // problematic selection instead of letting opFillet fail later
        // with an opaque FILLET_FAILED.
        //////////////////////////////////////////////////////////////////

        if (
            isQueryEmpty(
                context,
                copiedSelection
            )
        )
        {
            throw regenError(
                "Could not track the selected fillet geometry onto the proposal copy.",
                definition.edge
            );
        }


        //////////////////////////////////////////////////////////////////
        // Fillet the DUPLICATE.
        //
        // FACE remains FACE.
        // EDGE remains EDGE.
        //
        // No manual face-to-edge expansion.
        //////////////////////////////////////////////////////////////////

        opFillet(
            context,
            id + "previewFillet",
            {
                "entities" :
                    copiedSelection,

                "radius" :
                    definition.radius,

                "tangentPropagation" :
                    true,

                "crossSection" :
                    FilletCrossSection.CIRCULAR
            }
        );


        //////////////////////////////////////////////////////////////////
        // Fade the real object into the background.
        //////////////////////////////////////////////////////////////////

        setProperty(
            context,
            {
                "entities" :
                    originalBodies,

                "propertyType" :
                    PropertyType.APPEARANCE,

                "value" :
                    color(
                        0.75,
                        0.75,
                        0.75,
                        0.08
                    )
            }
        );


        //////////////////////////////////////////////////////////////////
        //
        // IMPORTANT VISUALIZATION
        //
        // Draw the scribble over the ENTIRE resulting proposed object.
        //
        // NOT:
        //     only fillet surface
        //
        // YES:
        //     entire filleted body
        //
        // This is what softens the hard CAD boundary and makes the whole
        // object read as provisional.
        //
        //////////////////////////////////////////////////////////////////

        drawSketchyFaceFill(
            context,
            id + "faceFill",
            proposedBody
        );


        //////////////////////////////////////////////////////////////////
        //
        // FIND ONE REPRESENTATIVE ORIGINAL EDGE
        //
        // Only used to position:
        //
        //     R:? arrow
        //     radius dimension
        //     manipulator
        //
        // It has NOTHING to do with which geometry is filleted.
        //
        //////////////////////////////////////////////////////////////////

        const selectedEdges =
            qEntityFilter(
                definition.edge,
                EntityType.EDGE
            );


        const selectedFaces =
            qEntityFilter(
                definition.edge,
                EntityType.FACE
            );


        var anchorEdge =
            qNothing();


        //////////////////////////////////////////////////////////////////
        // If user explicitly selected an edge, use its first edge.
        //////////////////////////////////////////////////////////////////

        if (
            !isQueryEmpty(
                context,
                selectedEdges
            )
        )
        {
            anchorEdge =
                qNthElement(
                    selectedEdges,
                    0
                );
        }


        //////////////////////////////////////////////////////////////////
        // If user selected only faces, use one outer boundary edge just
        // for placing the annotation.
        //////////////////////////////////////////////////////////////////

        else if (
            !isQueryEmpty(
                context,
                selectedFaces
            )
        )
        {
            const faceBoundaryEdges =
                qLoopEdges(
                    selectedFaces
                );


            if (
                !isQueryEmpty(
                    context,
                    faceBoundaryEdges
                )
            )
            {
                anchorEdge =
                    qNthElement(
                        faceBoundaryEdges,
                        0
                    );
            }
        }


        //////////////////////////////////////////////////////////////////
        //
        // RADIUS UI
        //
        //////////////////////////////////////////////////////////////////

        if (
            !isQueryEmpty(
                context,
                anchorEdge
            )
        )
        {
            const tangentLine =
                evEdgeTangentLine(
                    context,
                    {
                        "edge" :
                            anchorEdge,

                        "parameter" :
                            0.5
                    }
                );


            const midpoint =
                tangentLine.origin;


            const tangentDir =
                tangentLine.direction;


            const perpReference =
                (
                    abs(
                        tangentDir[2]
                    )
                    <
                    0.9
                )
                ?
                vector(
                    0,
                    0,
                    1
                )
                :
                vector(
                    0,
                    1,
                    0
                );


            const radiusDir =
                normalize(
                    cross(
                        tangentDir,
                        perpReference
                    )
                );


            const dimensionColor =
                color(
                    0,
                    0,
                    0,
                    0.92
                );


            //////////////////////////////////////////////////////////////////
            // UNKNOWN RADIUS
            //
            // Large fuzzy arrow.
            //////////////////////////////////////////////////////////////////

            if (
                definition.radiusNeedsInput
            )
            {
                drawBigFuzzyRadiusArrow(
                    context,

                    id + "radiusGesture",

                    midpoint,

                    radiusDir,

                    30 * millimeter,

                    "R: ?",

                    dimensionColor
                );
            }


            //////////////////////////////////////////////////////////////////
            // KNOWN RADIUS
            //
            // Once someone provides the value, switch back to a precise
            // dimension arrow.
            //////////////////////////////////////////////////////////////////

            else
            {
                drawDimensionArrow(
                    context,

                    id + "radiusArrow",

                    midpoint,

                    radiusDir
                    *
                    definition.radius,

                    "R: "
                    ~
                    toString(
                        round(
                            definition.radius
                            /
                            millimeter,

                            1
                        )
                    )
                    ~
                    " mm",

                    dimensionColor
                );
            }


            //////////////////////////////////////////////////////////////////
            // Interactive radius handle.
            //////////////////////////////////////////////////////////////////

            addManipulators(
                context,
                id,
                {
                    "radiusManipulator" :
                        linearManipulator(
                            {
                                "base" :
                                    midpoint,

                                "direction" :
                                    radiusDir,

                                "offset" :
                                    definition.radius,

                                "primaryParameterId" :
                                    "radius"
                            }
                        )
                }
            );
        }


        //////////////////////////////////////////////////////////////////
        // Delete the exact temporary CAD proposal.
        //
        // The whole-body hand-drawn representation stays behind.
        //////////////////////////////////////////////////////////////////

        opDeleteBodies(
            context,
            id + "deleteTemporaryProposal",
            {
                "entities" :
                    proposedBody
            }
        );
    });


//////////////////////////////////////////////////////////////////////
//
// MANIPULATOR CHANGE
//
//////////////////////////////////////////////////////////////////////

export function fuzzycadNeedsInputFilletManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map)
returns map
{
    if (
        newManipulators[
            "radiusManipulator"
        ]
        !=
        undefined
    )
    {
        definition.radius =
            newManipulators[
                "radiusManipulator"
            ].offset;
    }


    return definition;
}


//////////////////////////////////////////////////////////////////////
//
// LARGE FUZZY RADIUS ARROW
//
// Used while radiusNeedsInput == true.
//
// This is deliberately much larger than the old 8 mm gesture.
//
// Visual meaning:
//
//     whole-body scribble
//         = geometry remains provisional
//
//     R:? arrow
//         = specifically the fillet radius remains unresolved
//
//////////////////////////////////////////////////////////////////////

function drawBigFuzzyRadiusArrow(
    context is Context,
    id is Id,
    start is Vector,
    direction is Vector,
    nominalLength is ValueWithUnits,
    labelText is string,
    gestureColor is map)
{
    if (
        norm(
            direction
        )
        <
        0.0001
    )
    {
        return;
    }


    const dir =
        normalize(
            direction
        );


    const reference =
        (
            abs(
                dir[2]
            )
            <
            0.9
        )
        ?
        vector(
            0,
            0,
            1
        )
        :
        vector(
            0,
            1,
            0
        );


    const perp1 =
        normalize(
            cross(
                dir,
                reference
            )
        );


    const perp2 =
        normalize(
            cross(
                dir,
                perp1
            )
        );


    var rnd =
        RandomNumberFunctionWithSalt(
            id,
            "BIG_RADIUS_ARROW"
        );


    var allStrokes =
        qNothing();


    //////////////////////////////////////////////////////////////////
    // SHAFT
    //
    // Three slightly different passes give the line a hand-drawn feel
    // while preserving an obvious direction.
    //////////////////////////////////////////////////////////////////

    const shaftStrokeCount =
        3;


    const shaftPointCount =
        8;


    for (
        var s = 0;
        s < shaftStrokeCount;
        s += 1
    )
    {
        var pts =
            makeArray(
                shaftPointCount,
                undefined
            );


        for (
            var i = 0;
            i < shaftPointCount;
            i += 1
        )
        {
            const t =
                i
                /
                (
                    shaftPointCount
                    -
                    1
                );


            const basePt =
                start
                +
                dir
                *
                (
                    nominalLength
                    *
                    t
                );


            const spread =
                nominalLength
                *
                (
                    0.012
                    +
                    0.018
                    *
                    t
                );


            const r1 =
                rnd();


            const r2 =
                rnd();


            const j1 =
                (
                    (
                        r1
                        +
                        i * 19
                        +
                        s * 53
                    )
                    %
                    100
                )
                /
                100.0
                -
                0.5;


            const j2 =
                (
                    (
                        r2
                        +
                        i * 41
                        +
                        s * 67
                    )
                    %
                    100
                )
                /
                100.0
                -
                0.5;


            pts[i] =
                basePt
                +
                perp1
                *
                (
                    spread
                    *
                    j1
                )
                +
                perp2
                *
                (
                    spread
                    *
                    j2
                    *
                    0.55
                );
        }


        const strokeId =
            id
            +
            (
                "_shaft"
                ~
                toString(
                    s
                )
            );


        opFitSpline(
            context,
            strokeId,
            {
                "points" :
                    pts
            }
        );


        allStrokes =
            qUnion(
                allStrokes,

                qCreatedBy(
                    strokeId,
                    EntityType.BODY
                )
            );
    }


    //////////////////////////////////////////////////////////////////
    // LARGE ARROW HEAD
    //////////////////////////////////////////////////////////////////

    const tipPt =
        start
        +
        dir
        *
        nominalLength;


    const headLength =
        min(
            nominalLength
            *
            0.34,

            11 * millimeter
        );


    const headHalfWidth =
        min(
            nominalLength
            *
            0.20,

            7 * millimeter
        );


    //////////////////////////////////////////////////////////////////
    // Two sides of arrow head.
    //
    // Two passes each so it visually matches the scribbled shaft.
    //////////////////////////////////////////////////////////////////

    for (
        var sideIndex = 0;
        sideIndex < 2;
        sideIndex += 1
    )
    {
        const sideSign =
            (
                sideIndex
                ==
                0
            )
            ?
            -1
            :
            1;


        const headBase =
            tipPt
            -
            dir
            *
            headLength
            +
            perp1
            *
            (
                headHalfWidth
                *
                sideSign
            );


        for (
            var pass = 0;
            pass < 2;
            pass += 1
        )
        {
            const headPointCount =
                5;


            var headPts =
                makeArray(
                    headPointCount,
                    undefined
                );


            for (
                var h = 0;
                h < headPointCount;
                h += 1
            )
            {
                const t =
                    h
                    /
                    (
                        headPointCount
                        -
                        1
                    );


                const basePt =
                    headBase
                    +
                    (
                        tipPt
                        -
                        headBase
                    )
                    *
                    t;


                const jitterSize =
                    0.45
                    *
                    millimeter;


                const r1 =
                    rnd();


                const r2 =
                    rnd();


                const j1 =
                    (
                        (
                            r1
                            +
                            h * 23
                            +
                            pass * 37
                            +
                            sideIndex * 61
                        )
                        %
                        100
                    )
                    /
                    100.0
                    -
                    0.5;


                const j2 =
                    (
                        (
                            r2
                            +
                            h * 31
                            +
                            pass * 43
                            +
                            sideIndex * 71
                        )
                        %
                        100
                    )
                    /
                    100.0
                    -
                    0.5;


                headPts[h] =
                    basePt
                    +
                    perp1
                    *
                    (
                        jitterSize
                        *
                        j1
                    )
                    +
                    perp2
                    *
                    (
                        jitterSize
                        *
                        j2
                    );
            }


            const headStrokeId =
                id
                +
                (
                    "_head"
                    ~
                    toString(
                        sideIndex
                    )
                    ~
                    "_"
                    ~
                    toString(
                        pass
                    )
                );


            opFitSpline(
                context,
                headStrokeId,
                {
                    "points" :
                        headPts
                }
            );


            allStrokes =
                qUnion(
                    allStrokes,

                    qCreatedBy(
                        headStrokeId,
                        EntityType.BODY
                    )
                );
        }
    }


    //////////////////////////////////////////////////////////////////
    // Combine and style arrow.
    //////////////////////////////////////////////////////////////////

    if (
        !isQueryEmpty(
            context,
            allStrokes
        )
    )
    {
        opCreateCompositePart(
            context,
            id + "arrowComposite",
            {
                "bodies" :
                    allStrokes,

                "closed" :
                    false
            }
        );


        setProperty(
            context,
            {
                "entities" :
                    qCreatedBy(
                        id + "arrowComposite",
                        EntityType.BODY
                    ),

                "propertyType" :
                    PropertyType.APPEARANCE,

                "value" :
                    gestureColor
            }
        );
    }


    //////////////////////////////////////////////////////////////////
    // BIG R:? LABEL
    //////////////////////////////////////////////////////////////////

    const labelPlane =
        plane(
            tipPt,
            perp1,
            dir
        );


    const labelSketch =
        newSketchOnPlane(
            context,
            id + "labelSketch",
            {
                "sketchPlane" :
                    labelPlane
            }
        );


    const labelUv =
        worldToPlane(
            labelPlane,
            tipPt
        );


    const textHeight =
        3.8
        *
        millimeter;


    skText(
        labelSketch,
        "labelText",
        {
            "text" :
                labelText,

            "fontName" :
                "OpenSans-Regular.ttf",

            "firstCorner" :
                vector(
                    labelUv[0]
                    -
                    textHeight
                    *
                    1.6,

                    labelUv[1]
                    +
                    3
                    *
                    millimeter
                ),

            "secondCorner" :
                vector(
                    labelUv[0]
                    +
                    textHeight
                    *
                    1.6,

                    labelUv[1]
                    +
                    3
                    *
                    millimeter
                    +
                    textHeight
                )
        }
    );


    skSolve(
        labelSketch
    );
}


//////////////////////////////////////////////////////////////////////
//
// PRECISE DIMENSION ARROW
//
// Used after the radius is known.
//
//////////////////////////////////////////////////////////////////////

function drawDimensionArrow(
    context is Context,
    id is Id,
    start is Vector,
    axisOffset is Vector,
    labelText is string,
    arrowColor is map)
{
    const distance =
        norm(
            axisOffset
        );


    const distanceMm =
        distance
        /
        millimeter;


    if (
        distanceMm
        <
        0.001
    )
    {
        return;
    }


    const direction =
        normalize(
            axisOffset
        );


    const reference =
        (
            abs(
                direction[2]
            )
            <
            0.9
        )
        ?
        vector(
            0,
            0,
            1
        )
        :
        vector(
            0,
            1,
            0
        );


    const planeNormal =
        normalize(
            cross(
                direction,
                reference
            )
        );


    const arrowPlane =
        plane(
            start,
            planeNormal,
            direction
        );


    const shaftWidth =
        min(
            max(
                distanceMm
                *
                0.12,

                2.5
            ),

            7
        )
        *
        millimeter;


    const headLength =
        min(
            distanceMm
            *
            0.5,

            24
        )
        *
        millimeter;


    const headWidth =
        shaftWidth
        *
        4.5;


    const arrowSketch =
        newSketchOnPlane(
            context,
            id + "arrowSketch",
            {
                "sketchPlane" :
                    arrowPlane
            }
        );


    skLineSegment(
        arrowSketch,
        "headUpper",
        {
            "start" :
                vector(
                    distance,
                    0 * meter
                ),

            "end" :
                vector(
                    distance - headLength,
                    headWidth / 2
                )
        }
    );


    skLineSegment(
        arrowSketch,
        "headLower",
        {
            "start" :
                vector(
                    distance,
                    0 * meter
                ),

            "end" :
                vector(
                    distance - headLength,
                    -headWidth / 2
                )
        }
    );


    skLineSegment(
        arrowSketch,
        "headUpperTransition",
        {
            "start" :
                vector(
                    distance - headLength,
                    headWidth / 2
                ),

            "end" :
                vector(
                    distance - headLength,
                    shaftWidth / 2
                )
        }
    );


    skLineSegment(
        arrowSketch,
        "headLowerTransition",
        {
            "start" :
                vector(
                    distance - headLength,
                    -headWidth / 2
                ),

            "end" :
                vector(
                    distance - headLength,
                    -shaftWidth / 2
                )
        }
    );


    skLineSegment(
        arrowSketch,
        "shaftUpper",
        {
            "start" :
                vector(
                    distance - headLength,
                    shaftWidth / 2
                ),

            "end" :
                vector(
                    0 * meter,
                    shaftWidth / 2
                )
        }
    );


    skLineSegment(
        arrowSketch,
        "shaftLower",
        {
            "start" :
                vector(
                    distance - headLength,
                    -shaftWidth / 2
                ),

            "end" :
                vector(
                    0 * meter,
                    -shaftWidth / 2
                )
        }
    );


    skLineSegment(
        arrowSketch,
        "shaftBack",
        {
            "start" :
                vector(
                    0 * meter,
                    shaftWidth / 2
                ),

            "end" :
                vector(
                    0 * meter,
                    -shaftWidth / 2
                )
        }
    );


    skSolve(
        arrowSketch
    );


    opExtractSurface(
        context,
        id + "arrowSurface",
        {
            "faces" :
                qSketchRegion(
                    id + "arrowSketch"
                ),

            "offset" :
                0 * meter,

            "useFacesAroundToTrimOffset" :
                false
        }
    );


    opDeleteBodies(
        context,
        id + "deleteArrowSketch",
        {
            "entities" :
                qCreatedBy(
                    id + "arrowSketch"
                )
        }
    );


    setProperty(
        context,
        {
            "entities" :
                qCreatedBy(
                    id + "arrowSurface",
                    EntityType.BODY
                ),

            "propertyType" :
                PropertyType.APPEARANCE,

            "value" :
                arrowColor
        }
    );


    const midPoint =
        start
        +
        axisOffset
        /
        2;


    const labelSketch =
        newSketchOnPlane(
            context,
            id + "labelSketch",
            {
                "sketchPlane" :
                    arrowPlane
            }
        );


    const labelUv =
        worldToPlane(
            arrowPlane,
            midPoint
        );


    const labelOffset =
        headWidth
        /
        2
        +
        1.5
        *
        millimeter;


    const textHeight =
        2.5
        *
        millimeter;


    skText(
        labelSketch,
        "labelText",
        {
            "text" :
                labelText,

            "fontName" :
                "OpenSans-Regular.ttf",

            "firstCorner" :
                vector(
                    labelUv[0]
                    -
                    textHeight
                    *
                    1.5,

                    labelUv[1]
                    +
                    labelOffset
                ),

            "secondCorner" :
                vector(
                    labelUv[0]
                    +
                    textHeight
                    *
                    1.5,

                    labelUv[1]
                    +
                    labelOffset
                    +
                    textHeight
                )
        }
    );


    skSolve(
        labelSketch
    );
}


//////////////////////////////////////////////////////////////////////
//
// WHOLE-BODY HAND-DRAWN FACE FILL
//
// This intentionally covers EVERY face of the temporary proposed body.
//
// Important visual goal:
//
//   exact CAD body
//       -> disappears
//
//   complete proposed geometry
//       -> remains as loose scribble
//
// Boundary-adjacent strokes use extra variance so the visualization
// does not read as a set of crisp hard B-rep edges.
//
// Line density reduced ~1/3 from the previous version (46-52 primary /
// 7-10 secondary) per live feedback that the fill read as too dense --
// now 31-35 primary / 5-7 secondary.
//
//////////////////////////////////////////////////////////////////////

function drawSketchyFaceFill(
    context is Context,
    id is Id,
    body is Query)
{
    const chordLength =
        3 * millimeter;


    const variance =
        0.4 * millimeter;


    var rnd =
        RandomNumberFunctionWithSalt(
            id,
            "faceFill"
        );


    var allStrokes =
        qNothing();


    const faces =
        qOwnedByBody(
            body,
            EntityType.FACE
        );


    var faceIndex =
        0;


    for (
        var faceQuery
        in evaluateQuery(
            context,
            faces
        )
    )
    {
        const faceId =
            id
            +
            (
                "face"
                ~
                toString(
                    faceIndex
                )
            );


        //////////////////////////////////////////////////////////////////
        // PRIMARY ISO CURVES
        //////////////////////////////////////////////////////////////////

        const primaryCount =
            31
            +
            (
                rnd()
                %
                5
            );


        var primaryNames =
            makeArray(
                primaryCount,
                ""
            );


        for (
            var n = 0;
            n < primaryCount;
            n += 1
        )
        {
            primaryNames[n] =
                "primary"
                ~
                toString(
                    n
                );
        }


        const primaryGuideId =
            faceId
            +
            "primaryGuides";


        opCreateCurvesOnFace(
            context,
            primaryGuideId,
            {
                "curveDefinition" :
                    [
                        curveOnFaceDefinition(
                            faceQuery,
                            FaceCurveCreationType.DIR1_AUTO_SPACED_ISO,
                            primaryNames,
                            primaryCount
                        )
                    ],

                "showCurves" :
                    false,

                "skipTrim" :
                    false
            }
        );


        const primaryGuides =
            qCreatedBy(
                primaryGuideId,
                EntityType.EDGE
            );


        var primaryIndex =
            0;


        for (
            var guideEdge
            in evaluateQuery(
                context,
                primaryGuides
            )
        )
        {
            const isEndpoint =
                (
                    primaryIndex
                    ==
                    0
                )
                ||
                (
                    primaryIndex
                    ==
                    primaryCount
                    -
                    1
                );


            const distFromEdge =
                min(
                    primaryIndex,
                    primaryCount
                    -
                    1
                    -
                    primaryIndex
                );


            const centerProximity =
                min(
                    distFromEdge
                    /
                    (
                        primaryCount
                        /
                        2.0
                    ),

                    1.0
                );


            const keepProbability =
                isEndpoint
                ?
                1.0
                :
                (
                    0.18
                    +
                    0.82
                    *
                    centerProximity
                );


            if (
                isEndpoint
                ||
                (
                    (
                        (
                            rnd()
                            %
                            100
                        )
                        /
                        100.0
                    )
                    <
                    keepProbability
                )
            )
            {
                const r =
                    min(
                        0.03
                        +
                        (
                            (
                                rnd()
                                %
                                24
                            )
                            /
                            100.0
                        )
                        *
                        0.25,

                        1
                    );


                const g =
                    min(
                        0.03
                        +
                        (
                            (
                                rnd()
                                %
                                29
                            )
                            /
                            100.0
                        )
                        *
                        0.25,

                        1
                    );


                const b =
                    min(
                        0.03
                        +
                        (
                            (
                                rnd()
                                %
                                25
                            )
                            /
                            100.0
                        )
                        *
                        0.25,

                        1
                    );


                //////////////////////////////////////////////////////////////////
                // Extra variance at face boundary:
                //
                // intentionally prevents the outer lines from reading as
                // perfect CAD edges.
                //////////////////////////////////////////////////////////////////

                const strokeVariance =
                    isEndpoint
                    ?
                    variance
                    *
                    2.5
                    :
                    variance;


                const strokes =
                    handDrawScribbleGuide(
                        context,

                        faceId
                        +
                        (
                            "primaryStroke"
                            ~
                            toString(
                                primaryIndex
                            )
                        ),

                        chordLength,
                        strokeVariance,
                        rnd,
                        guideEdge,

                        r,
                        g,
                        b,

                        0.55,

                        false,

                        0.06
                    );


                allStrokes =
                    qUnion(
                        allStrokes,
                        strokes
                    );
            }


            primaryIndex +=
                1;
        }


        opDeleteBodies(
            context,
            faceId + "deletePrimaryGuides",
            {
                "entities" :
                    qCreatedBy(
                        primaryGuideId,
                        EntityType.BODY
                    )
            }
        );


        //////////////////////////////////////////////////////////////////
        // SECONDARY ISO CURVES
        //////////////////////////////////////////////////////////////////

        const secondaryCount =
            5
            +
            (
                rnd()
                %
                3
            );


        var secondaryNames =
            makeArray(
                secondaryCount,
                ""
            );


        for (
            var m = 0;
            m < secondaryCount;
            m += 1
        )
        {
            secondaryNames[m] =
                "secondary"
                ~
                toString(
                    m
                );
        }


        const secondaryGuideId =
            faceId
            +
            "secondaryGuides";


        opCreateCurvesOnFace(
            context,
            secondaryGuideId,
            {
                "curveDefinition" :
                    [
                        curveOnFaceDefinition(
                            faceQuery,
                            FaceCurveCreationType.DIR2_AUTO_SPACED_ISO,
                            secondaryNames,
                            secondaryCount
                        )
                    ],

                "showCurves" :
                    false,

                "skipTrim" :
                    false
            }
        );


        const secondaryGuides =
            qCreatedBy(
                secondaryGuideId,
                EntityType.EDGE
            );


        var secondaryIndex =
            0;


        for (
            var guideEdge2
            in evaluateQuery(
                context,
                secondaryGuides
            )
        )
        {
            if (
                (
                    (
                        rnd()
                        %
                        100
                    )
                    /
                    100.0
                )
                <
                0.45
            )
            {
                const r2 =
                    min(
                        0.10
                        +
                        (
                            (
                                rnd()
                                %
                                20
                            )
                            /
                            100.0
                        )
                        *
                        0.3,

                        1
                    );


                const g2 =
                    min(
                        0.10
                        +
                        (
                            (
                                rnd()
                                %
                                22
                            )
                            /
                            100.0
                        )
                        *
                        0.3,

                        1
                    );


                const b2 =
                    min(
                        0.10
                        +
                        (
                            (
                                rnd()
                                %
                                22
                            )
                            /
                            100.0
                        )
                        *
                        0.3,

                        1
                    );


                const strokes2 =
                    handDrawScribbleGuide(
                        context,

                        faceId
                        +
                        (
                            "secondaryStroke"
                            ~
                            toString(
                                secondaryIndex
                            )
                        ),

                        chordLength,
                        variance,
                        rnd,
                        guideEdge2,

                        r2,
                        g2,
                        b2,

                        0.4,

                        true,

                        0.10
                    );


                allStrokes =
                    qUnion(
                        allStrokes,
                        strokes2
                    );
            }


            secondaryIndex +=
                1;
        }


        opDeleteBodies(
            context,
            faceId + "deleteSecondaryGuides",
            {
                "entities" :
                    qCreatedBy(
                        secondaryGuideId,
                        EntityType.BODY
                    )
            }
        );


        faceIndex +=
            1;
    }


    if (
        !isQueryEmpty(
            context,
            allStrokes
        )
    )
    {
        opCreateCompositePart(
            context,
            id + "faceFillComposite",
            {
                "bodies" :
                    allStrokes,

                "closed" :
                    false
            }
        );
    }
}


//////////////////////////////////////////////////////////////////////
//
// SINGLE SCRIBBLE GUIDE
//
//////////////////////////////////////////////////////////////////////

function handDrawScribbleGuide(
    context is Context,
    id is Id,
    chordLength is ValueWithUnits,
    variance is ValueWithUnits,
    rnd is function,
    edgeQuery is Query,
    red is number,
    green is number,
    blue is number,
    alpha is number,
    singlePass is boolean,
    mistakeChance is number)
{
    var edgeLength =
        evLength(
            context,
            {
                "entities" :
                    edgeQuery
            }
        );


    var pointCount =
        ceil(
            max(
                edgeLength
                /
                chordLength,

                5
            )
        );


    var tangents =
        @evEdgeTangentLines(
            context,
            {
                "edge" :
                    edgeQuery,

                "parameters" :
                    range(
                        0.0,
                        1.0,
                        pointCount
                    )
            }
        );


    var rawRandom =
        rnd()
        %
        100;


    var numStrokes =
        singlePass
        ?
        1
        :
        (
            1
            +
            floor(
                rawRandom
                /
                34
            )
        );


    var strokesQuery =
        qNothing();


    for (
        var strokeIndex = 0;
        strokeIndex < numStrokes;
        strokeIndex += 1
    )
    {
        var newPoints =
            makeArray(
                pointCount,
                undefined
            );


        for (
            var i = 0;
            i < pointCount;
            i += 1
        )
        {
            var basePt =
                tangents[i].origin
                as Vector;


            var s1 =
                rnd();


            var s2 =
                rnd();


            var jitterFactor =
                0.5
                +
                (
                    (
                        s2
                        %
                        100
                    )
                    /
                    100.0
                )
                *
                0.5;


            var isMistake =
                (
                    (
                        (
                            rnd()
                            %
                            100
                        )
                        /
                        100.0
                    )
                    <
                    mistakeChance
                );


            var mistakeFactor =
                isMistake
                ?
                (
                    1.30
                    +
                    (
                        (
                            rnd()
                            %
                            100
                        )
                        /
                        100.0
                    )
                    *
                    1.11
                )
                :
                1.0;


            var offsetX =
                2
                *
                (
                    (
                        (
                            (
                                s1
                                +
                                i * 17
                                +
                                strokeIndex * 29
                            )
                            %
                            100
                        )
                        /
                        100.0
                    )
                    -
                    0.5
                )
                *
                variance
                *
                jitterFactor
                *
                mistakeFactor;


            var offsetY =
                2
                *
                (
                    (
                        (
                            (
                                s1
                                +
                                i * 31
                                +
                                strokeIndex * 43
                            )
                            %
                            100
                        )
                        /
                        100.0
                    )
                    -
                    0.5
                )
                *
                variance
                *
                jitterFactor
                *
                mistakeFactor;


            var offsetZ =
                2
                *
                (
                    (
                        (
                            (
                                s1
                                +
                                i * 47
                                +
                                strokeIndex * 61
                            )
                            %
                            100
                        )
                        /
                        100.0
                    )
                    -
                    0.5
                )
                *
                variance
                *
                jitterFactor
                *
                mistakeFactor;


            var perturbed =
                basePt;


            perturbed[0] +=
                offsetX;


            perturbed[1] +=
                offsetY;


            perturbed[2] +=
                offsetZ;


            newPoints[i] =
                perturbed;
        }


        const strokeId =
            id
            +
            (
                "_stroke"
                ~
                toString(
                    strokeIndex
                )
            );


        opFitSpline(
            context,
            strokeId,
            {
                "points" :
                    newPoints
            }
        );


        const strokeBody =
            qCreatedBy(
                strokeId,
                EntityType.BODY
            );


        const colorJitter =
            (
                rnd()
                %
                100
            )
            /
            100.0;


        const strokeAlpha =
            min(
                max(
                    alpha
                    +
                    (
                        colorJitter
                        -
                        0.5
                    )
                    *
                    0.2,

                    0.1
                ),

                1.0
            );


        setProperty(
            context,
            {
                "entities" :
                    strokeBody,

                "propertyType" :
                    PropertyType.APPEARANCE,

                "value" :
                    color(
                        red,
                        green,
                        blue,
                        strokeAlpha
                    )
            }
        );


        strokesQuery =
            qUnion(
                strokesQuery,
                strokeBody
            );
    }


    return strokesQuery;
}


//////////////////////////////////////////////////////////////////////
//
// DETERMINISTIC RANDOM
//
//////////////////////////////////////////////////////////////////////

function RandomNumberFunctionWithSalt(
    id,
    salt)
returns function
{
    const baseSeed =
        idToNum(
            id[0]
        );


    const saltSeed =
        idToNum(
            salt
        );


    return lcprng(
        (
            baseSeed
            +
            saltSeed
            *
            97
        )
        %
        100000
    );
}


function idToNum(
    input is string)
returns number
{
    const chrMap =
    {
        'A' : 0,
        'B' : 1,
        'C' : 2,
        'D' : 3,
        'E' : 4,
        'F' : 5,
        'G' : 6,
        'H' : 7,
        'I' : 8,
        'J' : 9,
        'K' : 10,
        'L' : 11,
        'M' : 12,
        'N' : 13,
        'O' : 14,
        'P' : 15,
        'Q' : 16,
        'R' : 17,
        'S' : 18,
        'T' : 19,
        'U' : 20,
        'V' : 21,
        'W' : 22,
        'X' : 23,
        'Y' : 24,
        'Z' : 25,

        'a' : 26,
        'b' : 27,
        'c' : 28,
        'd' : 29,
        'e' : 30,
        'f' : 31,
        'g' : 32,
        'h' : 33,
        'i' : 34,
        'j' : 35,
        'k' : 36,
        'l' : 37,
        'm' : 38,
        'n' : 39,
        'o' : 40,
        'p' : 41,
        'q' : 42,
        'r' : 43,
        's' : 44,
        't' : 45,
        'u' : 46,
        'v' : 47,
        'w' : 48,
        'x' : 49,
        'y' : 50,
        'z' : 51,

        '_' : 99,
        '-' : 98
    };


    var out is string =
        "";


    for (
        var char
        in splitIntoCharacters(
            input
        )
    )
    {
        var res =
            match(
                char,
                REGEX_NUMBER
            );


        if (
            res.hasMatch
        )
        {
            out =
                out
                ~
                toString(
                    res.captures[0]
                );
        }
        else
        {
            out =
                out
                ~
                toString(
                    chrMap[
                        char
                    ]
                );
        }
    }


    return stringToNumber(
        out
    )
    %
    100000;
}


function lcprng(
    seed is number)
returns function
{
    const a =
        1103515245;


    const c =
        12345;


    const m =
        2^31;


    var state =
        new box(
            seed
        );


    return function()
    {
        state[] =
            (
                a
                *
                state[]
                +
                c
            )
            %
            m;


        return state[];
    };
}
