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
        "FuzzyCAD Needs Input Rotate",

    "Manipulator Change Function" :
        "fuzzycadNeedsInputRotateManipulatorChange"
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
        // VERY FAINT GHOST OUTLINE
        //
        // Keeps the sparse Needs Input body legible while preserving the
        // visual difference from the more coherent Proposed geometry.
        //////////////////////////////////////////////////////////////////

        drawVeryLightGhostOutline(
            context,
            id + "ghostOutline",
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
                    0.88,
                    0.16,
                    0.12,
                    1.0
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
                drawEngineeringCurvedArrow(
                    context,

                    id + "angleGesture",

                    arcCenter,

                    axisDirection,

                    perpVec,

                    perpVec2,

                    arcRadius,

                    55 * degree,

                    "θ = ?",

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
                drawEngineeringCurvedArrow(
                    context,

                    id + "angleArc",

                    arcCenter,

                    axisDirection,

                    perpVec,

                    perpVec2,

                    arcRadius,

                    definition.angle,

                    "θ = " ~ toString(
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


            //////////////////////////////////////////////////////////////////
            //
            // ANGLE MANIPULATOR
            //
            // angularManipulator's constructor fields (axisOrigin,
            // axisDirection, rotationOrigin) are forum-confirmed; the
            // readback field name on newManipulators (used in
            // fuzzycadNeedsInputRotateManipulatorChange below) is
            // "angle" per Onshape's own uispec.html doc, the same
            // source that confirmed "offset" for the linear
            // manipulators used elsewhere in this codebase -- not yet
            // independently live-verified.
            //
            //////////////////////////////////////////////////////////////////

            addManipulators(
                context,
                id,
                {
                    "angleManipulator" :
                        angularManipulator(
                            {
                                // Point on the actual rotation axis.
                                "axisOrigin" :
                                    arcCenter,

                                // Direction extracted from the selected
                                // line / circle / arc / cylinder / mate connector.
                                "axisDirection" :
                                    axisDirection,

                                // IMPORTANT:
                                // This must NOT be on the axis.
                                // It is the point at the tip/start radius of
                                // the angular manipulator.
                                "rotationOrigin" :
                                    arcCenter
                                    +
                                    perpVec
                                    *
                                    arcRadius,

                                // IMPORTANT:
                                // angularManipulator requires its current angle.
                                "angle" :
                                    definition.angle,

                                // Keep native dialog focus synchronized with
                                // the Angle parameter when dragging.
                                "primaryParameterId" :
                                    "angle"
                            }
                        )
                }
            );
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
// MANIPULATOR CHANGE
//
//////////////////////////////////////////////////////////////////////

export function fuzzycadNeedsInputRotateManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map)
returns map
{
    if (
        newManipulators[
            "angleManipulator"
        ]
        !=
        undefined
    )
    {
        definition.angle =
            newManipulators[
                "angleManipulator"
            ].angle;
    }


    return definition;
}


//////////////////////////////////////////////////////////////////////
//
// PRECISE DASHED ANGLE ARC
//
// Used only once the angle has been supplied.
//
//////////////////////////////////////////////////////////////////////

function drawEngineeringCurvedArrow(
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
    const dashCount = 24;
    const dashRatio = 0.68;
    const bandOffset = min(max(radius * 0.025, 0.8 * millimeter), 2.3 * millimeter);
    const trackOffsets = [-bandOffset, 0 * meter, bandOffset];

    var allArcBodies = qNothing();

    // Three parallel arc tracks make a thin 3D annotation band rather
    // than a single planar curve, so rotation direction stays readable
    // when the arc plane approaches edge-on to the camera.
    for (var band = 0; band < 3; band += 1)
    {
        for (var d = 0; d < dashCount; d += 1)
        {
            const t0 = d / dashCount;
            const t1 = t0 + dashRatio / dashCount;
            var pts = makeArray(4, undefined);

            for (var j = 0; j < 4; j += 1)
            {
                const tt = t0 + (t1 - t0) * (j / 3);
                const ang = angle * tt;
                const dir = startDir * cos(ang) + otherDir * sin(ang);
                pts[j] = center + dir * radius + axisDirection * trackOffsets[band];
            }

            const dashId = id + ("band" ~ toString(band) ~ "dash" ~ toString(d));
            opFitSpline(context, dashId, { "points" : pts });
            allArcBodies = qUnion(allArcBodies, qCreatedBy(dashId, EntityType.BODY));
        }
    }

    if (!isQueryEmpty(context, allArcBodies))
    {
        opCreateCompositePart(context, id + "arcComposite", {
                "bodies" : allArcBodies,
                "closed" : false
        });
        setProperty(context, {
                "entities" : qCreatedBy(id + "arcComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : arcColor
        });
    }

    const tipDir = normalize(startDir * cos(angle) + otherDir * sin(angle));
    const tipPt = center + tipDir * radius;
    const tangentAtTip = normalize(-startDir * sin(angle) + otherDir * cos(angle));
    const headLength = min(max(radius * 0.18, 7 * millimeter), 16 * millimeter);
    const headWidth = min(max(radius * 0.11, 4 * millimeter), 9 * millimeter);
    const headBase = tipPt - tangentAtTip * headLength;

    // The tangent is the arrow direction; tipDir and axisDirection span
    // its perpendicular cross-section. Eight wings form a 3D wire cone.
    const diag1 = normalize(tipDir + axisDirection);
    const diag2 = normalize(tipDir - axisDirection);
    const headDirs = [tipDir, -tipDir, axisDirection, -axisDirection, diag1, -diag1, diag2, -diag2];
    var headBodies = qNothing();

    for (var h = 0; h < 8; h += 1)
    {
        const headId = id + ("arrowHead" ~ toString(h));
        opFitSpline(context, headId, { "points" : [tipPt, headBase + headDirs[h] * headWidth] });
        headBodies = qUnion(headBodies, qCreatedBy(headId, EntityType.BODY));
    }

    opCreateCompositePart(context, id + "headComposite", {
            "bodies" : headBodies,
            "closed" : false
    });
    setProperty(context, {
            "entities" : qCreatedBy(id + "headComposite", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : arcColor
    });

    // Engineering witness lines from the pivot to the start/end angular
    // positions. They make the angle read like an MBD/drawing callout.
    const startPt = center + startDir * radius;
    const endPt = center + tipDir * radius;
    opFitSpline(context, id + "witnessStart", { "points" : [center, startPt] });
    opFitSpline(context, id + "witnessEnd", { "points" : [center, endPt] });

    // Center/pivot marker and axis centerline.
    const markerSize = min(max(radius * 0.06, 3 * millimeter), 7 * millimeter);
    opFitSpline(context, id + "pivot1", { "points" : [center - startDir * markerSize, center + startDir * markerSize] });
    opFitSpline(context, id + "pivot2", { "points" : [center - otherDir * markerSize, center + otherDir * markerSize] });

    const axisHalfLength = min(max(radius * 0.32, 12 * millimeter), 35 * millimeter);
    drawDashedEngineeringLine(
        context,
        id + "axisCenterline",
        center - axisDirection * axisHalfLength,
        center + axisDirection * axisHalfLength,
        color(0.18, 0.18, 0.18, 0.78)
    );

    var witnessBodies = qNothing();
    witnessBodies = qUnion(witnessBodies, qCreatedBy(id + "witnessStart", EntityType.BODY));
    witnessBodies = qUnion(witnessBodies, qCreatedBy(id + "witnessEnd", EntityType.BODY));
    witnessBodies = qUnion(witnessBodies, qCreatedBy(id + "pivot1", EntityType.BODY));
    witnessBodies = qUnion(witnessBodies, qCreatedBy(id + "pivot2", EntityType.BODY));

    opCreateCompositePart(context, id + "witnessComposite", {
            "bodies" : witnessBodies,
            "closed" : false
    });
    setProperty(context, {
            "entities" : qCreatedBy(id + "witnessComposite", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : color(0.18, 0.18, 0.18, 0.82)
    });

    // Angle label placed outside the arc, in the rotation plane.
    const midAng = angle * 0.5;
    const midDir = normalize(startDir * cos(midAng) + otherDir * sin(midAng));
    const midPt = center + midDir * (radius * 1.08);
    const eps = 0.02 * millimeter;
    const labelPlane = plane(midPt + axisDirection * eps, axisDirection);
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : labelPlane });
    const labelUv = worldToPlane(labelPlane, midPt);
    const textSize = 4.2 * millimeter;

    skText(labelSketch, "labelText", {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - 1.8 * textSize, labelUv[1] - textSize),
            "secondCorner" : vector(labelUv[0] + 1.8 * textSize, labelUv[1] + textSize)
    });
    skSolve(labelSketch);
}

function drawDashedEngineeringLine(
    context is Context,
    id is Id,
    startPoint is Vector,
    endPoint is Vector,
    lineColor is map)
{
    const total = endPoint - startPoint;
    const dashCount = 9;
    const dashRatio = 0.58;
    var bodies = qNothing();

    for (var i = 0; i < dashCount; i += 1)
    {
        const t0 = i / dashCount;
        const t1 = t0 + dashRatio / dashCount;
        const segId = id + ("dash" ~ toString(i));
        opFitSpline(context, segId, {
                "points" : [startPoint + total * t0, startPoint + total * t1]
        });
        bodies = qUnion(bodies, qCreatedBy(segId, EntityType.BODY));
    }

    if (!isQueryEmpty(context, bodies))
    {
        opCreateCompositePart(context, id + "composite", {
                "bodies" : bodies,
                "closed" : false
        });
        setProperty(context, {
                "entities" : qCreatedBy(id + "composite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : lineColor
        });
    }
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

// Old random angle gesture removed. Engineering curved arrow handles both known and unknown angles.




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
    // NEEDS INPUT visual language:
    // fewer guides, more irregular coverage, partial strokes.
    // The engineering annotations remain clean elsewhere in the feature.
    const chordLength = 4.5 * millimeter;
    const variance = 0.10 * millimeter;

    var rnd = RandomNumberFunctionWithSalt(id, "sparseNeedsInputFill");
    var allStrokes = qNothing();

    const faces = qOwnedByBody(
        qEverything(EntityType.FACE),
        body
    );

    var faceIndex = 0;

    for (var faceQuery in evaluateQuery(context, faces))
    {
        const faceId = id + ("face" ~ toString(faceIndex));

        //////////////////////////////////////////////////////////////
        // PRIMARY FIELD
        //
        // Previous Needs Input versions used ~30-50 curves per face.
        // This intentionally drops to 12-18, then discards many of them.
        //////////////////////////////////////////////////////////////

        const primaryCount = 12 + (rnd() % 7);
        var primaryNames = makeArray(primaryCount, "");

        for (var n = 0; n < primaryCount; n += 1)
        {
            primaryNames[n] = "primary" ~ toString(n);
        }

        const primaryGuideId = faceId + "primaryGuides";

        opCreateCurvesOnFace(
            context,
            primaryGuideId,
            {
                "curveDefinition" : [
                    curveOnFaceDefinition(
                        faceQuery,
                        FaceCurveCreationType.DIR1_AUTO_SPACED_ISO,
                        primaryNames,
                        primaryCount
                    )
                ],
                "showCurves" : false,
                "skipTrim" : false
            }
        );

        const primaryGuides = qCreatedBy(primaryGuideId, EntityType.EDGE);
        var primaryIndex = 0;

        for (var guideEdge in evaluateQuery(context, primaryGuides))
        {
            const isBoundaryGuide =
                (primaryIndex == 0) ||
                (primaryIndex == primaryCount - 1);

            // Boundary guides are deliberately less likely to survive.
            // This prevents Needs Input from reading like a crisp CAD shell.
            const keepProbability = isBoundaryGuide
                ? 0.18
                : 0.46 + ((rnd() % 20) / 100.0);

            if (((rnd() % 100) / 100.0) < keepProbability)
            {
                const grey = 0.01 + ((rnd() % 18) / 100.0);
                const alpha = 0.50 + ((rnd() % 30) / 100.0);

                // Boundary guides sit right next to the face's real
                // edge, so they get much less jitter budget than
                // interior guides.
                const boundaryDamping = isBoundaryGuide ? 0.35 : 1.0;

                // Each kept guide gets substantially different wobble.
                const strokeVariance =
                    variance *
                    (1.25 + ((rnd() % 175) / 100.0)) *
                    boundaryDamping;

                const strokes = handDrawScribbleGuide(
                    context,
                    faceId + ("primaryStroke" ~ toString(primaryIndex)),
                    chordLength,
                    strokeVariance,
                    rnd,
                    guideEdge,
                    grey,
                    grey,
                    grey,
                    alpha,
                    false,
                    0.14
                );

                allStrokes = qUnion(allStrokes, strokes);
            }

            primaryIndex += 1;
        }

        const primaryGuideBodies = qCreatedBy(primaryGuideId, EntityType.BODY);
        if (!isQueryEmpty(context, primaryGuideBodies))
        {
            opDeleteBodies(
                context,
                faceId + "deletePrimaryGuides",
                { "entities" : primaryGuideBodies }
            );
        }

        //////////////////////////////////////////////////////////////
        // SECONDARY FIELD
        //
        // Only 3-5 candidates, and most are dropped.
        //////////////////////////////////////////////////////////////

        const secondaryCount = 3 + (rnd() % 3);
        var secondaryNames = makeArray(secondaryCount, "");

        for (var m = 0; m < secondaryCount; m += 1)
        {
            secondaryNames[m] = "secondary" ~ toString(m);
        }

        const secondaryGuideId = faceId + "secondaryGuides";

        opCreateCurvesOnFace(
            context,
            secondaryGuideId,
            {
                "curveDefinition" : [
                    curveOnFaceDefinition(
                        faceQuery,
                        FaceCurveCreationType.DIR2_AUTO_SPACED_ISO,
                        secondaryNames,
                        secondaryCount
                    )
                ],
                "showCurves" : false,
                "skipTrim" : false
            }
        );

        const secondaryGuides = qCreatedBy(secondaryGuideId, EntityType.EDGE);
        var secondaryIndex = 0;

        for (var guideEdge2 in evaluateQuery(context, secondaryGuides))
        {
            if ((rnd() % 100) < 34)
            {
                const isBoundaryGuide2 =
                    (secondaryIndex == 0) ||
                    (secondaryIndex == secondaryCount - 1);
                const boundaryDamping2 = isBoundaryGuide2 ? 0.35 : 1.0;

                const grey2 = 0.10 + ((rnd() % 18) / 100.0);
                const alpha2 = 0.22 + ((rnd() % 24) / 100.0);
                const secondaryVariance =
                    variance *
                    (1.6 + ((rnd() % 190) / 100.0)) *
                    boundaryDamping2;

                const strokes2 = handDrawScribbleGuide(
                    context,
                    faceId + ("secondaryStroke" ~ toString(secondaryIndex)),
                    chordLength * 1.15,
                    secondaryVariance,
                    rnd,
                    guideEdge2,
                    grey2,
                    grey2,
                    grey2,
                    alpha2,
                    true,
                    0.18
                );

                allStrokes = qUnion(allStrokes, strokes2);
            }

            secondaryIndex += 1;
        }

        const secondaryGuideBodies = qCreatedBy(secondaryGuideId, EntityType.BODY);
        if (!isQueryEmpty(context, secondaryGuideBodies))
        {
            opDeleteBodies(
                context,
                faceId + "deleteSecondaryGuides",
                { "entities" : secondaryGuideBodies }
            );
        }

        faceIndex += 1;
    }

    if (!isQueryEmpty(context, allStrokes))
    {
        opCreateCompositePart(
            context,
            id + "faceFillComposite",
            {
                "bodies" : allStrokes,
                "closed" : false
            }
        );
    }
}


//////////////////////////////////////////////////////////////////////
//
// PARTIAL / IRREGULAR SCRIBBLE GUIDE
//
// Key difference from Proposed:
// each Needs Input stroke intentionally covers only PART of its guide.
// That creates visual incompleteness without adding more ink.
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
    const edgeLength = evLength(
        context,
        { "entities" : edgeQuery }
    );

    // Jitter capped to a fraction of the guide's OWN length -- a short
    // guide on a tight fillet/small area otherwise gets the same
    // absolute wobble as a long guide on a flat face.
    const maxJitter = min(variance, edgeLength * 0.05);

    // Needs Input is intentionally sparse:
    // normally one stroke, occasionally a second pass.
    const numStrokes = singlePass
        ? 1
        : (((rnd() % 100) < 78) ? 1 : 2);

    var strokesQuery = qNothing();

    for (var strokeIndex = 0; strokeIndex < numStrokes; strokeIndex += 1)
    {
        //////////////////////////////////////////////////////////////
        // RANDOM PARTIAL COVERAGE
        //
        // Instead of always drawing parameter 0 -> 1, each stroke begins
        // and ends at different locations on the guide.
        //////////////////////////////////////////////////////////////

        const startParameter =
            0.01 + ((rnd() % 28) / 100.0);

        const endParameter =
            0.78 + ((rnd() % 30) / 100.0);

        const coverage = endParameter - startParameter;

        const pointCount = ceil(
            max(
                (edgeLength * coverage) / chordLength,
                4
            )
        );

        const tangents = @evEdgeTangentLines(
            context,
            {
                "edge" : edgeQuery,
                "parameters" : range(
                    startParameter,
                    endParameter,
                    pointCount
                )
            }
        );

        var newPoints = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            const basePt = tangents[i].origin as Vector;
            const tangentDir = normalize(tangents[i].direction as Vector);

            // Jitter only WITHIN the plane perpendicular to the guide's
            // own tangent, never along it -- along-tangent jitter can
            // push a point past its neighbor on a tightly curved guide,
            // which made the fitted spline double back on itself.
            const ref =
                (abs(tangentDir[2]) < 0.9)
                ? vector(0, 0, 1)
                : vector(0, 1, 0);

            const perp1 = normalize(cross(tangentDir, ref));
            const perp2 = cross(tangentDir, perp1);

            const s1 = rnd();
            const s2 = rnd();

            const jitterFactor =
                0.65 + ((s2 % 100) / 100.0) * 0.85;

            const isMistake =
                (((rnd() % 100) / 100.0) < mistakeChance);

            const mistakeFactor = isMistake
                ? 1.2 + ((rnd() % 100) / 100.0) * 0.6
                : 1.0;

            // Slightly more distortion toward the ends makes strokes feel
            // less like uniformly perturbed CAD isocurves.
            const normalizedIndex =
                pointCount > 1
                ? i / (pointCount - 1)
                : 0.5;

            const endLooseness =
                1.0 +
                abs(normalizedIndex - 0.5) * 0.5;

            const amount =
                maxJitter * jitterFactor * mistakeFactor * endLooseness;

            const offset1 =
                2 * (((s1 + i * 17 + strokeIndex * 29) % 100) / 100.0 - 0.5) * amount;
            const offset2 =
                2 * (((s1 + i * 31 + strokeIndex * 43) % 100) / 100.0 - 0.5) * amount;

            const perturbed = basePt + perp1 * offset1 + perp2 * offset2;

            newPoints[i] = perturbed;
        }

        const strokeId = id + ("_stroke" ~ toString(strokeIndex));

        opFitSpline(
            context,
            strokeId,
            { "points" : newPoints }
        );

        const strokeBody = qCreatedBy(strokeId, EntityType.BODY);

        // Per-stroke opacity remains intentionally uneven.
        const alphaJitter =
            (((rnd() % 100) / 100.0) - 0.5) * 0.18;

        const strokeAlpha =
            min(max(alpha + alphaJitter, 0.14), 0.72);

        setProperty(
            context,
            {
                "entities" : strokeBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(
                    red,
                    green,
                    blue,
                    strokeAlpha
                )
            }
        );

        strokesQuery = qUnion(strokesQuery, strokeBody);
    }

    return strokesQuery;
}


//////////////////////////////////////////////////////////////////////
//
// VERY LIGHT GHOST OUTLINE
//
// Needs Input uses sparse / incomplete / random interior strokes, but a
// completely missing boundary can make the candidate geometry hard to
// read from some camera angles. This adds ONE very faint, clean outline
// over the temporary proposed body before that exact body is deleted.
//
// Important visual hierarchy:
//   sparse random strokes = uncertainty / incompleteness
//   faint outline         = only enough structure to read the shape
//   red annotation        = action / engineering direction
//
// The outline is deliberately low opacity and has no random jitter.
// We stop edge sampling just before parameter 1.0 to avoid feeding an
// identical first/last point into opFitSpline on closed circular edges.
//
//////////////////////////////////////////////////////////////////////

function drawVeryLightGhostOutline(
    context is Context,
    id is Id,
    body is Query)
{
    const outlineColor = color(0.38, 0.38, 0.38, 0.14);
    const sampleSpacing = 5 * millimeter;

    const bodyEdges = evaluateQuery(
        context,
        qOwnedByBody(
            qEverything(EntityType.EDGE),
            body
        )
    );

    var outlineBodies = qNothing();

    for (var edgeIndex = 0; edgeIndex < size(bodyEdges); edgeIndex += 1)
    {
        const edgeQuery = bodyEdges[edgeIndex];
        const edgeLength = evLength(context, { "entities" : edgeQuery });
        const pointCount = ceil(max(edgeLength / sampleSpacing, 5));

        const tangents = @evEdgeTangentLines(
            context,
            {
                "edge" : edgeQuery,
                "parameters" : range(0.0, 0.995, pointCount)
            }
        );

        var points = makeArray(pointCount, undefined);

        for (var p = 0; p < pointCount; p += 1)
        {
            points[p] = tangents[p].origin as Vector;
        }

        const outlineId = id + ("edge" ~ toString(edgeIndex));
        opFitSpline(context, outlineId, { "points" : points });

        const outlineBody = qCreatedBy(outlineId, EntityType.BODY);

        setProperty(
            context,
            {
                "entities" : outlineBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : outlineColor
            }
        );

        outlineBodies = qUnion(outlineBodies, outlineBody);
    }

    if (!isQueryEmpty(context, outlineBodies))
    {
        opCreateCompositePart(
            context,
            id + "outlineComposite",
            {
                "bodies" : outlineBodies,
                "closed" : false
            }
        );
    }
}

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