FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

annotation {
    "Feature Type Name" : "FuzzyCAD Needs Input Move",
    "Manipulator Change Function" : "fuzzycadNeedsInputMoveManipulatorChange"
}
export const fuzzycadNeedsInputMove = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to move", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Move X" }
        isLength(definition.moveX, LENGTH_BOUNDS);
        annotation { "Name" : "Move X needs input", "Default" : true }
        definition.moveXNeedsInput is boolean;

        annotation { "Name" : "Move Y" }
        isLength(definition.moveY, LENGTH_BOUNDS);
        annotation { "Name" : "Move Y needs input", "Default" : true }
        definition.moveYNeedsInput is boolean;

        annotation { "Name" : "Move Z" }
        isLength(definition.moveZ, LENGTH_BOUNDS);
        annotation { "Name" : "Move Z needs input", "Default" : true }
        definition.moveZNeedsInput is boolean;

        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        const originalBody = definition.body;
        const offset = vector(definition.moveX, definition.moveY, definition.moveZ);

        if (definition.accepted)
        {
            opTransform(context, id + "acceptedMove", {
                    "bodies" : originalBody,
                    "transform" : transform(offset)
            });
            return;
        }

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(offset)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        // NEEDS INPUT: sparse, incomplete, more random geometry.
        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        // Very faint boundary support: enough to read the candidate shape
        // from difficult camera angles without making it look precise.
        drawVeryLightGhostOutline(context, id + "ghostOutline", proposedBody);

        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const startPoint = vector(
            (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
            (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
            (bbox.minCorner[2] + bbox.maxCorner[2]) / 2
        );
        const endPoint = startPoint + offset;

        // Annotation stays clean and engineering-like.
        // If any component is still open, the label is explicitly changed
        // to "?" below by drawNeedsInputMoveArrowLabel.
        if (norm(offset) / millimeter > 0.001)
        {
            drawBigMoveArrow(
                context,
                id + "moveArrow",
                startPoint,
                endPoint,
                definition.moveX,
                definition.moveY,
                definition.moveZ,
                definition.moveXNeedsInput || definition.moveYNeedsInput || definition.moveZNeedsInput
            );
        }
        else
        {
            // No displacement placeholder yet: show a clean three-axis
            // engineering direction triad instead of inventing a destination.
            drawOpenMoveTriad(
                context,
                id + "openMoveTriad",
                startPoint,
                min(max(norm(bbox.maxCorner - bbox.minCorner) * 0.25, 12 * millimeter), 35 * millimeter)
            );
        }

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });

        addManipulators(context, id, {
                "moveXManipulator" : linearManipulator({
                        "base" : startPoint,
                        "direction" : vector(1, 0, 0),
                        "offset" : definition.moveX,
                        "primaryParameterId" : "moveX"
                }),
                "moveYManipulator" : linearManipulator({
                        "base" : startPoint,
                        "direction" : vector(0, 1, 0),
                        "offset" : definition.moveY,
                        "primaryParameterId" : "moveY"
                }),
                "moveZManipulator" : linearManipulator({
                        "base" : startPoint,
                        "direction" : vector(0, 0, 1),
                        "offset" : definition.moveZ,
                        "primaryParameterId" : "moveZ"
                })
        });
    });

export function fuzzycadNeedsInputMoveManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map) returns map
{
    if (newManipulators["moveXManipulator"] != undefined)
        definition.moveX = newManipulators["moveXManipulator"].offset;

    if (newManipulators["moveYManipulator"] != undefined)
        definition.moveY = newManipulators["moveYManipulator"].offset;

    if (newManipulators["moveZManipulator"] != undefined)
        definition.moveZ = newManipulators["moveZManipulator"].offset;

    return definition;
}

function drawOpenMoveTriad(
    context is Context,
    id is Id,
    origin is Vector,
    length is ValueWithUnits)
{
    const arrowColor = color(0.88, 0.16, 0.12, 1.0);
    const dirs = [vector(1,0,0), vector(0,1,0), vector(0,0,1)];
    const names = ["X?", "Y?", "Z?"];
    var allBodies = qNothing();

    for (var i = 0; i < 3; i += 1)
    {
        const end = origin + dirs[i] * length;
        const ref = (i == 2) ? vector(0,1,0) : vector(0,0,1);
        const side = normalize(cross(dirs[i], ref));
        const headLength = min(length * 0.25, 8 * millimeter);
        const headWidth = min(length * 0.13, 5 * millimeter);
        const base = end - dirs[i] * headLength;

        const shaftId = id + ("shaft" ~ toString(i));
        const wingAId = id + ("wingA" ~ toString(i));
        const wingBId = id + ("wingB" ~ toString(i));

        opFitSpline(context, shaftId, { "points" : [origin, end] });
        opFitSpline(context, wingAId, { "points" : [end, base + side * headWidth] });
        opFitSpline(context, wingBId, { "points" : [end, base - side * headWidth] });

        allBodies = qUnion(allBodies, qCreatedBy(shaftId, EntityType.BODY));
        allBodies = qUnion(allBodies, qCreatedBy(wingAId, EntityType.BODY));
        allBodies = qUnion(allBodies, qCreatedBy(wingBId, EntityType.BODY));

        const labelPoint = end + dirs[i] * (3 * millimeter);
        const labelPlane = plane(labelPoint, dirs[i]);
        const uv = worldToPlane(labelPlane, labelPoint);
        const sketch = newSketchOnPlane(context, id + ("label" ~ toString(i)), { "sketchPlane" : labelPlane });
        const t = 3 * millimeter;
        skText(sketch, "txt", {
                "text" : names[i],
                "fontName" : "OpenSans-Regular.ttf",
                "firstCorner" : vector(uv[0] - t, uv[1] - t),
                "secondCorner" : vector(uv[0] + t, uv[1] + t)
        });
        skSolve(sketch);
    }

    if (!isQueryEmpty(context, allBodies))
    {
        opCreateCompositePart(context, id + "composite", {
                "bodies" : allBodies,
                "closed" : false
        });
        setProperty(context, {
                "entities" : qCreatedBy(id + "composite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : arrowColor
        });
    }
}

function drawBigMoveArrow(
    context is Context,
    id is Id,
    startPoint is Vector,
    endPoint is Vector,
    moveX is ValueWithUnits,
    moveY is ValueWithUnits,
    moveZ is ValueWithUnits,
    isOpen is boolean)
{
    const offset = endPoint - startPoint;
    const distance = norm(offset);
    if (distance / millimeter < 0.001)
    {
        return;
    }

    const direction = normalize(offset);
    const ref = (abs(direction[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
    const side = normalize(cross(direction, ref));
    const side2 = normalize(cross(direction, side));

    const arrowColor = color(0.88, 0.16, 0.12, 1.0);
    const markerColor = color(0.15, 0.15, 0.15, 0.82);

    // A small 3D shaft cage means the direction line still reads when
    // one of its planes turns edge-on to the camera.
    const shaftSpread = min(max(distance * 0.025, 0.8 * millimeter), 2.5 * millimeter);
    const headLength = min(max(distance * 0.22, 7 * millimeter), 18 * millimeter);
    const headWidth = min(max(distance * 0.11, 4 * millimeter), 9 * millimeter);
    const markerSize = min(max(distance * 0.07, 3 * millimeter), 7 * millimeter);

    var arrowBodies = qNothing();

    // Main shaft + four parallel shafts around it. These are engineering
    // lines, intentionally straight and deterministic, not sketchy.
    const shaftOffsets = [
        vector(0, 0, 0) * meter,
        side * shaftSpread,
        -side * shaftSpread,
        side2 * shaftSpread,
        -side2 * shaftSpread
    ];

    for (var s = 0; s < 5; s += 1)
    {
        const shaftId = id + ("shaft" ~ toString(s));
        opFitSpline(context, shaftId, {
                "points" : [startPoint + shaftOffsets[s], endPoint + shaftOffsets[s]]
        });
        arrowBodies = qUnion(arrowBodies, qCreatedBy(shaftId, EntityType.BODY));
    }

    // 8-wing wire-cone arrowhead. Because the head exists around the
    // full 3D cross-section, at least several wings remain readable from
    // almost any camera direction.
    const headBase = endPoint - direction * headLength;
    const diag1 = normalize(side + side2);
    const diag2 = normalize(side - side2);
    const headDirs = [side, -side, side2, -side2, diag1, -diag1, diag2, -diag2];

    for (var h = 0; h < 8; h += 1)
    {
        const wingId = id + ("headWing" ~ toString(h));
        const wingPt = headBase + headDirs[h] * headWidth;
        opFitSpline(context, wingId, { "points" : [endPoint, wingPt] });
        arrowBodies = qUnion(arrowBodies, qCreatedBy(wingId, EntityType.BODY));
    }

    if (!isQueryEmpty(context, arrowBodies))
    {
        opCreateCompositePart(context, id + "arrowComposite", {
                "bodies" : arrowBodies,
                "closed" : false
        });
        setProperty(context, {
                "entities" : qCreatedBy(id + "arrowComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : arrowColor
        });
    }

    // Engineering start marker: 3D cross at the original position.
    var startMarkerBodies = qNothing();
    const startMarkerEnds = [
        startPoint + side * markerSize, startPoint - side * markerSize,
        startPoint + side2 * markerSize, startPoint - side2 * markerSize,
        startPoint + direction * markerSize * 0.45, startPoint - direction * markerSize * 0.45
    ];
    opFitSpline(context, id + "startCross1", { "points" : [startMarkerEnds[0], startMarkerEnds[1]] });
    opFitSpline(context, id + "startCross2", { "points" : [startMarkerEnds[2], startMarkerEnds[3]] });
    opFitSpline(context, id + "startCross3", { "points" : [startMarkerEnds[4], startMarkerEnds[5]] });
    startMarkerBodies = qUnion(startMarkerBodies, qCreatedBy(id + "startCross1", EntityType.BODY));
    startMarkerBodies = qUnion(startMarkerBodies, qCreatedBy(id + "startCross2", EntityType.BODY));
    startMarkerBodies = qUnion(startMarkerBodies, qCreatedBy(id + "startCross3", EntityType.BODY));

    // Engineering target marker: a diamond in the plane normal to travel,
    // plus a cross through the target point.
    const d1 = endPoint + side * markerSize;
    const d2 = endPoint + side2 * markerSize;
    const d3 = endPoint - side * markerSize;
    const d4 = endPoint - side2 * markerSize;
    opFitSpline(context, id + "targetD1", { "points" : [d1, d2] });
    opFitSpline(context, id + "targetD2", { "points" : [d2, d3] });
    opFitSpline(context, id + "targetD3", { "points" : [d3, d4] });
    opFitSpline(context, id + "targetD4", { "points" : [d4, d1] });
    opFitSpline(context, id + "targetCross1", { "points" : [d1, d3] });
    opFitSpline(context, id + "targetCross2", { "points" : [d2, d4] });

    var markerBodies = startMarkerBodies;
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetD1", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetD2", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetD3", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetD4", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetCross1", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetCross2", EntityType.BODY));

    opCreateCompositePart(context, id + "markerComposite", {
            "bodies" : markerBodies,
            "closed" : false
    });
    setProperty(context, {
            "entities" : qCreatedBy(id + "markerComposite", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : markerColor
    });

    // Main motion label and component breakdown. The red arrow carries the
    // action; the black annotation carries measured engineering detail.
    const midPoint = startPoint + offset * 0.5 + side2 * min(distance * 0.11, 9 * millimeter);
    const labelPlane = plane(midPoint + side * (0.02 * millimeter), side);
    const labelUv = worldToPlane(labelPlane, midPoint);
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : labelPlane });
    const textSize = 4.2 * millimeter;
    skText(labelSketch, "label", {
            "text" : isOpen
                ? "MOVE  Δ = ?"
                : "MOVE  Δ = " ~ toString(round(distance / millimeter, 1)) ~ " mm",
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - 2.5 * textSize, labelUv[1] - textSize),
            "secondCorner" : vector(labelUv[0] + 2.5 * textSize, labelUv[1] + textSize)
    });
    skSolve(labelSketch);

    const detailPoint = midPoint - side2 * (7 * millimeter);
    const detailPlane = plane(detailPoint + side * (0.02 * millimeter), side);
    const detailUv = worldToPlane(detailPlane, detailPoint);
    const detailSketch = newSketchOnPlane(context, id + "detailSketch", { "sketchPlane" : detailPlane });
    const detailSize = 2.8 * millimeter;
    skText(detailSketch, "detail", {
            "text" : isOpen
                ? "ΔX/ΔY/ΔZ  OPEN"
                : "ΔX " ~ toString(round(moveX / millimeter, 1)) ~ "   ΔY " ~ toString(round(moveY / millimeter, 1)) ~ "   ΔZ " ~ toString(round(moveZ / millimeter, 1)),
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(detailUv[0] - 3.0 * detailSize, detailUv[1] - detailSize),
            "secondCorner" : vector(detailUv[0] + 3.0 * detailSize, detailUv[1] + detailSize)
    });
    skSolve(detailSketch);
}


function drawSketchyFaceFill(
    context is Context,
    id is Id,
    body is Query)
{
    // NEEDS INPUT visual language:
    // fewer guides, more irregular coverage, partial strokes.
    // The engineering annotations remain clean elsewhere in the feature.
    const chordLength = 4.5 * millimeter;
    const variance = 0.55 * millimeter;

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
                const grey = 0.05 + ((rnd() % 18) / 100.0);
                const alpha = 0.26 + ((rnd() % 30) / 100.0);

                // Each kept guide gets substantially different wobble.
                const strokeVariance =
                    variance *
                    (1.25 + ((rnd() % 175) / 100.0));

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
                const grey2 = 0.10 + ((rnd() % 18) / 100.0);
                const alpha2 = 0.22 + ((rnd() % 24) / 100.0);
                const secondaryVariance =
                    variance *
                    (1.6 + ((rnd() % 190) / 100.0));

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
            0.03 + ((rnd() % 28) / 100.0);

        const endParameter =
            0.67 + ((rnd() % 30) / 100.0);

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
            var basePt = tangents[i].origin as Vector;

            const s1 = rnd();
            const s2 = rnd();

            const jitterFactor =
                0.65 + ((s2 % 100) / 100.0) * 0.85;

            const isMistake =
                (((rnd() % 100) / 100.0) < mistakeChance);

            const mistakeFactor = isMistake
                ? 1.45 + ((rnd() % 100) / 100.0) * 1.55
                : 1.0;

            // Slightly more distortion toward the ends makes strokes feel
            // less like uniformly perturbed CAD isocurves.
            const normalizedIndex =
                pointCount > 1
                ? i / (pointCount - 1)
                : 0.5;

            const endLooseness =
                1.0 +
                abs(normalizedIndex - 0.5) * 0.9;

            const offsetX =
                2 *
                (((((s1 + i * 17 + strokeIndex * 29) % 100) / 100.0) - 0.5)) *
                variance * jitterFactor * mistakeFactor * endLooseness;

            const offsetY =
                2 *
                (((((s1 + i * 31 + strokeIndex * 43) % 100) / 100.0) - 0.5)) *
                variance * jitterFactor * mistakeFactor * endLooseness;

            const offsetZ =
                2 *
                (((((s1 + i * 47 + strokeIndex * 61) % 100) / 100.0) - 0.5)) *
                variance * jitterFactor * mistakeFactor * endLooseness;

            var perturbed = basePt;
            perturbed[0] += offsetX;
            perturbed[1] += offsetY;
            perturbed[2] += offsetZ;

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