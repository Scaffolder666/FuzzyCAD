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

        // Controlled internally by the FuzzyCAD right panel: whether the
        // coherent hand-drawn line is currently revealed for this mark
        // (clicked in the 3D view or on its card) -- see
        // drawSketchyFaceFill below. Everything else (simple outline +
        // warning icon) is always visible regardless of this flag.
        annotation
        {
            "Name" :
                "Expanded",

            "Default" :
                false,

            "UIHint" :
                UIHint.ALWAYS_HIDDEN
        }
        definition.expanded is boolean;
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
        // Always-on: a simple faint frame + warning icon are enough to
        // spot a mark at a glance. The coherent hand-drawn line only
        // appears once "expanded" -- clicked in the 3D view or on its
        // card in the right panel -- and collapses again once something
        // else is clicked, so the viewport doesn't stay cluttered with
        // every mark's full line at once.
        //
        //////////////////////////////////////////////////////////////////

        drawVeryLightGhostOutline(
            context,
            id + "ghostOutline",
            proposedBody
        );

        // Makes the mark impossible to miss at a glance.
        drawWarningIcon(
            context,
            id + "warningIcon",
            proposedBody
        );

        if (definition.expanded)
        {
            drawSketchyFaceFill(
                context,
                id + "faceFill",
                proposedBody
            );
        }


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
// COHERENT BLACK OUTLINE (same structure as Proposed's own
// drawProposedSketch/handDrawProposedEdge -- full-coverage, low-jitter,
// 2 passes per edge -- just recolored black instead of blue. Needs
// Input no longer looks visually "unfinished"; the mark itself is
// signaled by the red angle callout + warning icon instead of by
// sparse/incomplete candidate geometry.
//
//////////////////////////////////////////////////////////////////////

function drawSketchyFaceFill(
    context is Context,
    id is Id,
    body is Query)
{
    const chordLength = 3.2 * millimeter;
    const variance = 0.38 * millimeter;
    const needsInputColor = color(0.08, 0.08, 0.08, 0.92);

    var rnd = RandomNumberFunctionWithSalt(id, "needsInputOutline");
    var allStrokes = qNothing();

    const edges = qOwnedByBody(qEverything(EntityType.EDGE), body);
    var edgeIndex = 0;

    for (var edgeQuery in evaluateQuery(context, edges))
    {
        const strokes = handDrawCoherentEdge(
            context,
            id + ("edge" ~ toString(edgeIndex)),
            chordLength,
            variance,
            rnd,
            edgeQuery
        );

        allStrokes = qUnion(allStrokes, strokes);
        edgeIndex += 1;
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

        setProperty(
            context,
            {
                "entities" : qCreatedBy(id + "faceFillComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : needsInputColor
            }
        );
    }
}

function handDrawCoherentEdge(
    context is Context,
    id is Id,
    chordLength is ValueWithUnits,
    variance is ValueWithUnits,
    rnd is function,
    edgeQuery is Query)
returns Query
{
    const edgeLength = evLength(context, { "entities" : edgeQuery });
    const pointCount = ceil(max(edgeLength / chordLength, 5));

    const tangents = @evEdgeTangentLines(
        context,
        {
            "edge" : edgeQuery,
            "parameters" : range(0.0, 0.995, pointCount)
        }
    );

    var result = qNothing();

    for (var strokeIndex = 0; strokeIndex < 2; strokeIndex += 1)
    {
        var pts = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            var p = tangents[i].origin as Vector;
            const s = rnd();
            const factor = 0.55 + ((rnd() % 100) / 100.0) * 0.35;

            p[0] += 2 * (((s + i * 17 + strokeIndex * 29) % 100) / 100.0 - 0.5) * variance * factor;
            p[1] += 2 * (((s + i * 23 + strokeIndex * 37) % 100) / 100.0 - 0.5) * variance * factor;
            p[2] += 2 * (((s + i * 31 + strokeIndex * 41) % 100) / 100.0 - 0.5) * variance * factor;

            pts[i] = p;
        }

        const strokeId = id + ("stroke" ~ toString(strokeIndex));
        opFitSpline(context, strokeId, { "points" : pts });
        result = qUnion(result, qCreatedBy(strokeId, EntityType.BODY));
    }

    return result;
}

//////////////////////////////////////////////////////////////////////
//
// WARNING ICON
//
// A filled red triangle with a "!" mark, floated above the candidate
// body's own bounding box -- makes a Needs Input mark impossible to
// miss at a glance, on top of (not instead of) the red engineering
// callout the feature already draws.
//
//////////////////////////////////////////////////////////////////////

function drawWarningIcon(
    context is Context,
    id is Id,
    body is Query)
{
    const bbox = evBox3d(context, { "topology" : body, "tight" : true });
    const size = min(max(norm(bbox.maxCorner - bbox.minCorner) * 0.20, 14 * millimeter), 32 * millimeter);
    const half = size / 2;

    const center =
        vector(
            (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
            (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
            bbox.maxCorner[2]
        ) + vector(0, 0, 1) * (size * 0.9);

    const iconColor = color(0.90, 0.10, 0.08, 1.0);
    const textColor = color(0, 0, 0, 1.0);

    // Explicit U/V basis instead of a bare plane(point, normal) -- letting
    // Onshape pick the in-plane axes on its own put the triangle and "!"
    // sideways in practice (live-confirmed). U is pinned to world X (the
    // reading direction), and the normal is derived FROM that so V works
    // out to world Z (upright) -- same "derive normal from the axis you
    // actually care about" technique drawDimensionArrow already uses
    // successfully elsewhere in this codebase.
    const uAxis = vector(1, 0, 0);
    const iconNormal = normalize(cross(uAxis, vector(0, 0, 1)));
    const iconPlane = plane(center, iconNormal, uAxis);
    const uv = worldToPlane(iconPlane, center);

    const triSketch = newSketchOnPlane(context, id + "triSketch", { "sketchPlane" : iconPlane });

    skLineSegment(triSketch, "side1", {
            "start" : vector(uv[0], uv[1] + half),
            "end" : vector(uv[0] - half * 0.95, uv[1] - half * 0.75)
    });
    skLineSegment(triSketch, "side2", {
            "start" : vector(uv[0] - half * 0.95, uv[1] - half * 0.75),
            "end" : vector(uv[0] + half * 0.95, uv[1] - half * 0.75)
    });
    skLineSegment(triSketch, "side3", {
            "start" : vector(uv[0] + half * 0.95, uv[1] - half * 0.75),
            "end" : vector(uv[0], uv[1] + half)
    });

    skSolve(triSketch);

    opExtractSurface(context, id + "triSurface", {
            "faces" : qSketchRegion(id + "triSketch"),
            "offset" : 0 * meter,
            "useFacesAroundToTrimOffset" : false
    });

    opDeleteBodies(context, id + "deleteTriSketch", {
            "entities" : qCreatedBy(id + "triSketch")
    });

    setProperty(context, {
            "entities" : qCreatedBy(id + "triSurface", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : iconColor
    });

    // "!" on its own plane, nudged a hair off the triangle's surface along
    // the shared normal -- extracting it flush with the triangle (offset 0
    // on the same plane) put two opaque coincident faces in the exact same
    // spot, which z-fights in the viewport.
    const textPlane = plane(center + iconNormal * (0.05 * millimeter), iconNormal, uAxis);
    const textSketch = newSketchOnPlane(context, id + "iconText", { "sketchPlane" : textPlane });
    const textSize = size * 0.34;

    skText(textSketch, "exclamation", {
            "text" : "!",
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(uv[0] - textSize * 0.28, uv[1] - half * 0.55),
            "secondCorner" : vector(uv[0] + textSize * 0.28, uv[1] - half * 0.55 + textSize * 1.5)
    });

    skSolve(textSketch);

    opExtractSurface(context, id + "textSurface", {
            "faces" : qSketchRegion(id + "iconText"),
            "offset" : 0 * meter,
            "useFacesAroundToTrimOffset" : false
    });

    opDeleteBodies(context, id + "deleteIconText", {
            "entities" : qCreatedBy(id + "iconText")
    });

    setProperty(context, {
            "entities" : qCreatedBy(id + "textSurface", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : textColor
    });
}


//////////////////////////////////////////////////////////////////////
//
// VERY LIGHT GHOST OUTLINE
//
// Always-on simple frame -- a single faint, clean line along every
// edge, no jitter. Read alongside the warning icon, this is enough to
// spot a mark at a glance without the full coherent hand-drawn line
// competing for attention until someone actually expands it.
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