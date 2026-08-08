FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");


//////////////////////////////////////////////////////////////////////
//
// FUZZYCAD NEEDS INPUT ROTATE
//
// User interaction:
//
//   Body to rotate
//   Rotation reference
//   Angle
//   Angle needs input
//
// Rotation reference supports:
//
//   - straight edge / line
//   - circular edge
//   - circular arc
//   - cylindrical face
//   - Mate Connector
//
// Example:
//
//             ○
//             │
//             │ automatically inferred rotation axis
//             │
//
// Selecting the circular edge of a pivot hole therefore gives the
// center axis of that circle.
//
// PENDING:
//   - original remains in place but faded
//   - rotated duplicate represents the candidate geometry
//   - entire candidate body receives fuzzy hand-drawn face fill
//   - if angle is unknown, show fuzzy "?°" gesture
//   - if angle is known, show exact dashed angle arc
//   - exact temporary duplicate is then deleted
//
// ACCEPTED:
//   - rotate the real body directly
//
//////////////////////////////////////////////////////////////////////


annotation
{
    "Feature Type Name" :
        "FuzzyCAD Needs Input Rotate"
}

export const fuzzycadNeedsInputRotate =
defineFeature(function(
    context is Context,
    id is Id,
    definition is map)
    precondition
    {
        //////////////////////////////////////////////////////////////////
        // BODY TO ROTATE
        //////////////////////////////////////////////////////////////////

        annotation
        {
            "Name" :
                "Body to rotate",

            "Filter" :
                EntityType.BODY
        }
        definition.body is Query;


        //////////////////////////////////////////////////////////////////
        // ROTATION REFERENCE
        //
        // IMPORTANT:
        //
        // We no longer force the collaborator to find a straight EDGE.
        //
        // QueryFilterCompound.ALLOWS_AXIS supports geometry from which
        // Onshape can infer an axis:
        //
        //   line
        //   circle
        //   arc
        //   cylinder
        //   mate connector
        //
        //////////////////////////////////////////////////////////////////

        annotation
        {
            "Name" :
                "Rotation reference",

            "Filter" :
                QueryFilterCompound.ALLOWS_AXIS,

            "MaxNumberOfPicks" :
                1
        }
        definition.axis is Query;


        //////////////////////////////////////////////////////////////////
        // ANGLE
        //////////////////////////////////////////////////////////////////

        annotation
        {
            "Name" :
                "Angle"
        }
        isAngle(
            definition.angle,
            ANGLE_360_BOUNDS
        );


        //////////////////////////////////////////////////////////////////
        // TRUE:
        //
        // We know WHAT should rotate and around WHICH reference,
        // but do not yet know HOW FAR.
        //////////////////////////////////////////////////////////////////

        annotation
        {
            "Name" :
                "Angle needs input",

            "Default" :
                true
        }
        definition.angleNeedsInput is boolean;


        //////////////////////////////////////////////////////////////////
        // Controlled internally by FuzzyCAD right panel.
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
        // Wait until both required geometry inputs exist.
        //////////////////////////////////////////////////////////////////

        if (
            isQueryEmpty(
                context,
                definition.body
            )
            ||
            isQueryEmpty(
                context,
                definition.axis
            )
        )
        {
            return;
        }


        //////////////////////////////////////////////////////////////////
        // ORIGINAL BODY
        //////////////////////////////////////////////////////////////////

        const originalBody =
            definition.body;


        //////////////////////////////////////////////////////////////////
        //
        // EXTRACT ROTATION AXIS
        //
        // This is the main change from the old implementation.
        //
        // OLD:
        //
        //   evEdgeTangentLine(parameter 0)
        //   evEdgeTangentLine(parameter 1)
        //   axis = normalize(end - start)
        //
        // That only made sense for straight edges and breaks conceptually
        // for a closed circular edge.
        //
        // NEW:
        //
        //   evAxis()
        //
        // Circle:
        //   circle center + normal
        //
        // Cylinder:
        //   cylinder center line
        //
        // Straight edge:
        //   edge line itself
        //
        //////////////////////////////////////////////////////////////////

        const rotationAxis =
            evAxis(
                context,
                {
                    "axis" :
                        definition.axis
                }
            );


        const axisStart =
            rotationAxis.origin;


        const axisDirection =
            rotationAxis.direction;


        //////////////////////////////////////////////////////////////////
        // ROTATION TRANSFORM
        //////////////////////////////////////////////////////////////////

        const rotation =
            rotationAround(
                rotationAxis,
                definition.angle
            );


        //////////////////////////////////////////////////////////////////
        //
        // ACCEPTED STATE
        //
        //////////////////////////////////////////////////////////////////

        if (
            definition.accepted
        )
        {
            opTransform(
                context,
                id + "acceptedRotate",
                {
                    "bodies" :
                        originalBody,

                    "transform" :
                        rotation
                }
            );


            return;
        }


        //////////////////////////////////////////////////////////////////
        //
        // PENDING STATE
        //
        // Create a complete rotated candidate body.
        //
        //////////////////////////////////////////////////////////////////

        opPattern(
            context,
            id + "duplicate",
            {
                "entities" :
                    originalBody,

                "transforms" :
                    [
                        rotation
                    ],

                "instanceNames" :
                    [
                        "proposed"
                    ]
            }
        );


        const proposedBody =
            qCreatedBy(
                id + "duplicate",
                EntityType.BODY
            );


        //////////////////////////////////////////////////////////////////
        // FADE ORIGINAL BODY
        //////////////////////////////////////////////////////////////////

        setProperty(
            context,
            {
                "entities" :
                    originalBody,

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
        // WHOLE-BODY FUZZY VISUALIZATION
        //
        // Important:
        //
        // The entire resulting proposed object receives the loose
        // hand-drawn fill.
        //
        // We are NOT highlighting only the changed edge or one exact
        // surface.
        //
        //////////////////////////////////////////////////////////////////

        drawSketchyFaceFill(
            context,
            id + "faceFill",
            proposedBody
        );


        //////////////////////////////////////////////////////////////////
        //
        // FIND A LARGE, VISIBLE RADIUS FOR THE ROTATION GESTURE
        //
        // Find whichever bounding-box corner lies farthest from the
        // rotation axis.
        //
        //////////////////////////////////////////////////////////////////

        const bbox =
            evBox3d(
                context,
                {
                    "topology" :
                        originalBody,

                    "tight" :
                        true
                }
            );


        const corners =
            [
                vector(
                    bbox.minCorner[0],
                    bbox.minCorner[1],
                    bbox.minCorner[2]
                ),

                vector(
                    bbox.minCorner[0],
                    bbox.minCorner[1],
                    bbox.maxCorner[2]
                ),

                vector(
                    bbox.minCorner[0],
                    bbox.maxCorner[1],
                    bbox.minCorner[2]
                ),

                vector(
                    bbox.minCorner[0],
                    bbox.maxCorner[1],
                    bbox.maxCorner[2]
                ),

                vector(
                    bbox.maxCorner[0],
                    bbox.minCorner[1],
                    bbox.minCorner[2]
                ),

                vector(
                    bbox.maxCorner[0],
                    bbox.minCorner[1],
                    bbox.maxCorner[2]
                ),

                vector(
                    bbox.maxCorner[0],
                    bbox.maxCorner[1],
                    bbox.minCorner[2]
                ),

                vector(
                    bbox.maxCorner[0],
                    bbox.maxCorner[1],
                    bbox.maxCorner[2]
                )
            ];


        var arcRadius =
            0 * meter;


        var bestPerpOffset =
            vector(
                0,
                0,
                0
            )
            *
            meter;


        var bestAlongAxis =
            vector(
                0,
                0,
                0
            )
            *
            meter;


        for (
            var c = 0;
            c < 8;
            c += 1
        )
        {
            const cornerOffset =
                corners[c]
                -
                axisStart;


            const alongAxisC =
                dot(
                    cornerOffset,
                    axisDirection
                )
                *
                axisDirection;


            const perpOffsetC =
                cornerOffset
                -
                alongAxisC;


            const radiusC =
                norm(
                    perpOffsetC
                );


            if (
                radiusC
                >
                arcRadius
            )
            {
                arcRadius =
                    radiusC;


                bestPerpOffset =
                    perpOffsetC;


                bestAlongAxis =
                    alongAxisC;
            }
        }


        //////////////////////////////////////////////////////////////////
        //
        // DRAW ROTATION INFORMATION
        //
        //////////////////////////////////////////////////////////////////

        if (
            arcRadius
            /
            millimeter
            >
            0.001
        )
        {
            const perpVec =
                normalize(
                    bestPerpOffset
                );


            const perpVec2 =
                normalize(
                    cross(
                        axisDirection,
                        perpVec
                    )
                );


            const arcCenter =
                axisStart
                +
                bestAlongAxis;


            const dimensionColor =
                color(
                    0,
                    0,
                    0,
                    0.88
                );


            //////////////////////////////////////////////////////////////////
            //
            // UNKNOWN ANGLE
            //
            // Don't visualize the placeholder numerical value.
            //
            // Draw an intentionally approximate hand-drawn sweep.
            //
            //////////////////////////////////////////////////////////////////

            if (
                definition.angleNeedsInput
            )
            {
                drawFuzzyAngleGesture(
                    context,

                    id + "angleGesture",

                    arcCenter,

                    axisDirection,

                    perpVec,

                    perpVec2,

                    arcRadius,

                    "?°",

                    dimensionColor
                );
            }


            //////////////////////////////////////////////////////////////////
            //
            // KNOWN ANGLE
            //
            //////////////////////////////////////////////////////////////////

            else
            {
                drawAngleArc(
                    context,

                    id + "angleArc",

                    arcCenter,

                    axisDirection,

                    perpVec,

                    perpVec2,

                    arcRadius,

                    definition.angle,

                    toString(
                        round(
                            definition.angle
                            /
                            degree,

                            1
                        )
                    )
                    ~
                    "°",

                    dimensionColor
                );
            }
        }


        //////////////////////////////////////////////////////////////////
        // REMOVE EXACT TEMPORARY CAD BODY
        //
        // The loose whole-body scribble remains.
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
// PRECISE DASHED ANGLE ARC
//
// Used only once the angle has been supplied.
//
//////////////////////////////////////////////////////////////////////

function drawAngleArc(
    context is Context,
    id is Id,
    center is Vector,
    axisDirection is Vector,
    startDir is Vector,
    otherDir is Vector,
    radius is ValueWithUnits,
    angle is ValueWithUnits,
    labelText is string,
    arcColor is map)
{
    const dashCount =
        24;


    const dashRatio =
        0.6;


    var allDashes =
        qNothing();


    for (
        var d = 0;
        d < dashCount;
        d += 1
    )
    {
        const t0 =
            d
            /
            dashCount;


        const t1 =
            t0
            +
            dashRatio
            /
            dashCount;


        var pts =
            makeArray(
                4,
                undefined
            );


        for (
            var j = 0;
            j < 4;
            j += 1
        )
        {
            const tt =
                t0
                +
                (
                    t1
                    -
                    t0
                )
                *
                (
                    j
                    /
                    3
                );


            const ang =
                angle
                *
                tt;


            const dir =
                startDir
                *
                cos(
                    ang
                )
                +
                otherDir
                *
                sin(
                    ang
                );


            pts[j] =
                center
                +
                dir
                *
                radius;
        }


        const dashId =
            id
            +
            "dash"
            +
            toString(
                d
            );


        opFitSpline(
            context,
            dashId,
            {
                "points" :
                    pts
            }
        );


        allDashes =
            qUnion(
                allDashes,

                qCreatedBy(
                    dashId,
                    EntityType.BODY
                )
            );
    }


    if (
        !isQueryEmpty(
            context,
            allDashes
        )
    )
    {
        opCreateCompositePart(
            context,
            id + "composite",
            {
                "bodies" :
                    allDashes,

                "closed" :
                    false
            }
        );


        setProperty(
            context,
            {
                "entities" :
                    qCreatedBy(
                        id + "composite",
                        EntityType.BODY
                    ),

                "propertyType" :
                    PropertyType.APPEARANCE,

                "value" :
                    arcColor
            }
        );
    }


    //////////////////////////////////////////////////////////////////
    // LABEL AT ARC MIDPOINT
    //////////////////////////////////////////////////////////////////

    const midAng =
        angle
        *
        0.5;


    const midDir =
        startDir
        *
        cos(
            midAng
        )
        +
        otherDir
        *
        sin(
            midAng
        );


    const midPt =
        center
        +
        midDir
        *
        radius;


    const eps =
        0.01
        *
        millimeter;


    const labelPlane =
        plane(
            midPt
            +
            axisDirection
            *
            eps,

            axisDirection
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
            midPt
        );


    const textSize =
        3 * millimeter;


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
                    textSize,

                    labelUv[1]
                    -
                    textSize
                ),

            "secondCorner" :
                vector(
                    labelUv[0]
                    +
                    textSize,

                    labelUv[1]
                    +
                    textSize
                )
        }
    );


    skSolve(
        labelSketch
    );
}


//////////////////////////////////////////////////////////////////////
//
// FUZZY ANGLE GESTURE
//
// Used while angleNeedsInput == true.
//
// IMPORTANT:
//
// This DOES NOT use definition.angle.
//
// The numerical angle at this point may only be a placeholder.
// Instead we draw an arbitrary nominal sweep that communicates:
//
//     "rotate around here, amount still unknown"
//
//////////////////////////////////////////////////////////////////////

function drawFuzzyAngleGesture(
    context is Context,
    id is Id,
    center is Vector,
    axisDirection is Vector,
    startDir is Vector,
    otherDir is Vector,
    radius is ValueWithUnits,
    labelText is string,
    gestureColor is map)
{
    //////////////////////////////////////////////////////////////////
    // Nominal visualization only.
    //////////////////////////////////////////////////////////////////

    const nominalAngle =
        55 * degree;


    //////////////////////////////////////////////////////////////////
    // Slightly fewer/larger dashes than the precise arc.
    //////////////////////////////////////////////////////////////////

    const dashCount =
        16;


    const dashRatio =
        0.62;


    var rnd =
        RandomNumberFunctionWithSalt(
            id,
            "gesture"
        );


    var allDashes =
        qNothing();


    //////////////////////////////////////////////////////////////////
    // FUZZY ARC
    //////////////////////////////////////////////////////////////////

    for (
        var d = 0;
        d < dashCount;
        d += 1
    )
    {
        const t0 =
            d
            /
            dashCount;


        const t1 =
            t0
            +
            dashRatio
            /
            dashCount;


        var pts =
            makeArray(
                5,
                undefined
            );


        //////////////////////////////////////////////////////////////////
        // Each dash gets slightly different radius.
        //////////////////////////////////////////////////////////////////

        const s1 =
            rnd();


        const radiusJitter =
            1.0
            +
            (
                (
                    (
                        s1
                        +
                        d * 23
                    )
                    %
                    100
                )
                /
                100.0
                -
                0.5
            )
            *
            0.16;


        const dashRadius =
            radius
            *
            radiusJitter;


        for (
            var j = 0;
            j < 5;
            j += 1
        )
        {
            const tt =
                t0
                +
                (
                    t1
                    -
                    t0
                )
                *
                (
                    j
                    /
                    4
                );


            const ang =
                nominalAngle
                *
                tt;


            const dir =
                startDir
                *
                cos(
                    ang
                )
                +
                otherDir
                *
                sin(
                    ang
                );


            //////////////////////////////////////////////////////////////////
            // Small axis-direction wobble removes the mechanically perfect
            // "CAD arc" appearance.
            //////////////////////////////////////////////////////////////////

            const noise =
                (
                    (
                        (
                            rnd()
                            +
                            d * 31
                            +
                            j * 17
                        )
                        %
                        100
                    )
                    /
                    100.0
                    -
                    0.5
                )
                *
                0.7
                *
                millimeter;


            pts[j] =
                center
                +
                dir
                *
                dashRadius
                +
                axisDirection
                *
                noise;
        }


        const dashId =
            id
            +
            "dash"
            +
            toString(
                d
            );


        opFitSpline(
            context,
            dashId,
            {
                "points" :
                    pts
            }
        );


        allDashes =
            qUnion(
                allDashes,

                qCreatedBy(
                    dashId,
                    EntityType.BODY
                )
            );
    }


    //////////////////////////////////////////////////////////////////
    // ADD A BIG HAND-DRAWN ARROWHEAD
    //
    // Makes the rotation direction immediately readable.
    //////////////////////////////////////////////////////////////////

    const tipDir =
        startDir
        *
        cos(
            nominalAngle
        )
        +
        otherDir
        *
        sin(
            nominalAngle
        );


    const tipPt =
        center
        +
        tipDir
        *
        radius;


    //////////////////////////////////////////////////////////////////
    // Tangent direction of the circular motion at the arrow tip.
    //////////////////////////////////////////////////////////////////

    const tangentAtTip =
        normalize(
            -startDir
            *
            sin(
                nominalAngle
            )
            +
            otherDir
            *
            cos(
                nominalAngle
            )
        );


    const headLength =
        min(
            radius * 0.18,
            12 * millimeter
        );


    const headWidth =
        min(
            radius * 0.12,
            8 * millimeter
        );


    const headBack =
        tipPt
        -
        tangentAtTip
        *
        headLength;


    const headLeft =
        headBack
        +
        tipDir
        *
        headWidth;


    const headRight =
        headBack
        -
        tipDir
        *
        headWidth;


    //////////////////////////////////////////////////////////////////
    // LEFT SIDE OF ARROWHEAD
    //////////////////////////////////////////////////////////////////

    var leftPts =
        [
            headLeft,
            headLeft
            +
            (
                tipPt
                -
                headLeft
            )
            *
            0.33
            +
            axisDirection
            *
            0.25
            *
            millimeter,

            headLeft
            +
            (
                tipPt
                -
                headLeft
            )
            *
            0.66
            -
            axisDirection
            *
            0.20
            *
            millimeter,

            tipPt
        ];


    opFitSpline(
        context,
        id + "arrowHeadLeft",
        {
            "points" :
                leftPts
        }
    );


    allDashes =
        qUnion(
            allDashes,

            qCreatedBy(
                id + "arrowHeadLeft",
                EntityType.BODY
            )
        );


    //////////////////////////////////////////////////////////////////
    // RIGHT SIDE OF ARROWHEAD
    //////////////////////////////////////////////////////////////////

    var rightPts =
        [
            headRight,
            headRight
            +
            (
                tipPt
                -
                headRight
            )
            *
            0.33
            -
            axisDirection
            *
            0.22
            *
            millimeter,

            headRight
            +
            (
                tipPt
                -
                headRight
            )
            *
            0.66
            +
            axisDirection
            *
            0.18
            *
            millimeter,

            tipPt
        ];


    opFitSpline(
        context,
        id + "arrowHeadRight",
        {
            "points" :
                rightPts
        }
    );


    allDashes =
        qUnion(
            allDashes,

            qCreatedBy(
                id + "arrowHeadRight",
                EntityType.BODY
            )
        );


    //////////////////////////////////////////////////////////////////
    // COMBINE AND STYLE GESTURE
    //////////////////////////////////////////////////////////////////

    if (
        !isQueryEmpty(
            context,
            allDashes
        )
    )
    {
        opCreateCompositePart(
            context,
            id + "composite",
            {
                "bodies" :
                    allDashes,

                "closed" :
                    false
            }
        );


        setProperty(
            context,
            {
                "entities" :
                    qCreatedBy(
                        id + "composite",
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
    // LARGE ?° LABEL
    //////////////////////////////////////////////////////////////////

    const labelAngle =
        nominalAngle
        *
        0.55;


    const labelDir =
        startDir
        *
        cos(
            labelAngle
        )
        +
        otherDir
        *
        sin(
            labelAngle
        );


    const labelPt =
        center
        +
        labelDir
        *
        (
            radius
            *
            1.08
        );


    const eps =
        0.01 * millimeter;


    const labelPlane =
        plane(
            labelPt
            +
            axisDirection
            *
            eps,

            axisDirection
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
            labelPt
        );


    const textSize =
        4.2 * millimeter;


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
                    textSize,

                    labelUv[1]
                    -
                    textSize
                ),

            "secondCorner" :
                vector(
                    labelUv[0]
                    +
                    textSize,

                    labelUv[1]
                    +
                    textSize
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
// This is intentionally applied to EVERY face of proposedBody.
//
// The goal is NOT:
//     highlight exact changed surface.
//
// The goal IS:
//     make the complete candidate geometry read as provisional.
//
// Exact proposed solid is deleted afterward.
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
            qEverything(
                EntityType.FACE
            ),

            body
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
        // PRIMARY FACE GUIDES
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


        //////////////////////////////////////////////////////////////////
        // IMPORTANT:
        //
        // Correct map-style opCreateCurvesOnFace call.
        //////////////////////////////////////////////////////////////////

        opCreateCurvesOnFace(
            context,
            primaryGuideId,
            {
                "curveDefinition" :
                    [
                        curveOnFaceDefinition(
                            faceQuery,

                            FaceCurveCreationType
                                .DIR1_AUTO_SPACED_ISO,

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
                // More variance near face boundaries weakens the hard B-rep
                // edge appearance.
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
        // SECONDARY FACE GUIDES
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

                            FaceCurveCreationType
                                .DIR2_AUTO_SPACED_ISO,

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
// SINGLE HAND-DRAWN FACE GUIDE
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
