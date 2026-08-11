FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

// Needs Input Hole
// Sparse candidate + faint boundary + clean centerline and direction arrow.

annotation {
    "Feature Type Name" : "FuzzyCAD Needs Input Hole",
    "Manipulator Change Function" : "fuzzycadNeedsInputHoleManipulatorChange"
}
export const fuzzycadNeedsInputHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to modify", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Hole profile", "Filter" : EntityType.FACE }
        definition.entities is Query;

        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);

        annotation { "Name" : "Depth needs input", "Default" : true }
        definition.depthNeedsInput is boolean;

        annotation { "Name" : "Opposite direction", "Default" : false }
        definition.oppositeDirection is boolean;

        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        if (isQueryEmpty(context, definition.body) || isQueryEmpty(context, definition.entities))
        {
            return;
        }

        const originalBody = definition.body;
        const faces = evaluateQuery(context, definition.entities);

        const cutPlane =
            evFaceTangentPlane(
                context,
                {
                    "face" : faces[0],
                    "parameter" : vector(0.5, 0.5)
                }
            );

        var direction = cutPlane.normal;
        if (definition.oppositeDirection)
        {
            direction = -direction;
        }

        if (definition.accepted)
        {
            extrude(context, id + "acceptedHole", {
                    "bodyType" : ExtendedToolBodyType.SOLID,
                    "entities" : definition.entities,
                    "endBound" : BoundingType.BLIND,
                    "oppositeDirection" : definition.oppositeDirection,
                    "depth" : definition.depth,
                    "operationType" : NewBodyOperationType.REMOVE,
                    "defaultScope" : false,
                    "booleanScope" : originalBody
            });
            return;
        }

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody =
            qPatternInstances(id + "duplicate", "proposed", EntityType.BODY);

        extrude(context, id + "previewHole", {
                "bodyType" : ExtendedToolBodyType.SOLID,
                "entities" : definition.entities,
                "endBound" : BoundingType.BLIND,
                "oppositeDirection" : definition.oppositeDirection,
                "depth" : definition.depth,
                "operationType" : NewBodyOperationType.REMOVE,
                "defaultScope" : false,
                "booleanScope" : proposedBody
        });

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        drawNeedsInputSketch(context, id + "needsSketch", proposedBody);
        drawVeryLightGhostOutline(context, id + "ghostOutline", proposedBody);

        const shownLength =
            definition.depthNeedsInput
            ? max(definition.depth, 25 * millimeter)
            : definition.depth;

        drawDashedReferenceLine(
            context,
            id + "holeAxis",
            cutPlane.origin - direction * (8 * millimeter),
            cutPlane.origin + direction * (shownLength + 10 * millimeter)
        );

        const labelText =
            definition.depthNeedsInput
            ? "HOLE  DEPTH = ?"
            : "HOLE  DEPTH = " ~ toString(round(definition.depth / millimeter, 1)) ~ " mm";

        drawEngineeringLinearArrow(
            context,
            id + "holeArrow",
            cutPlane.origin,
            cutPlane.origin + direction * shownLength,
            labelText,
            true
        );

        addManipulators(context, id, {
                "depthManipulator" : linearManipulator({
                        "base" : cutPlane.origin,
                        "direction" : direction,
                        "offset" : definition.depth,
                        "primaryParameterId" : "depth"
                })
        });

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

export function fuzzycadNeedsInputHoleManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map)
returns map
{
    if (newManipulators["depthManipulator"] != undefined)
    {
        definition.depth =
            newManipulators["depthManipulator"].offset;
    }

    return definition;
}


//////////////////////////////////////////////////////////////////////
// SPARSE / INCOMPLETE NEEDS INPUT GEOMETRY
//////////////////////////////////////////////////////////////////////

function drawNeedsInputSketch(
    context is Context,
    id is Id,
    body is Query)
{
    const chordLength = 4.5 * millimeter;
    const variance = 0.10 * millimeter;

    var rnd = RandomNumberFunctionWithSalt(id, "sparseNeedsInputFill");
    var allStrokes = qNothing();

    const faces = qOwnedByBody(qEverything(EntityType.FACE), body);
    var faceIndex = 0;

    for (var faceQuery in evaluateQuery(context, faces))
    {
        const faceId = id + ("face" ~ toString(faceIndex));

        // Only 12–18 candidate guides, and many are discarded.
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

                const strokeVariance =
                    variance * (1.25 + ((rnd() % 175) / 100.0)) * boundaryDamping;

                const strokes = handDrawNeedsInputGuide(
                    context,
                    faceId + ("primaryStroke" ~ toString(primaryIndex)),
                    chordLength,
                    strokeVariance,
                    rnd,
                    guideEdge,
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

        // Sparse cross-hatching: only 3–5 candidates, most discarded.
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
                const strokeVariance2 =
                    variance * (1.6 + ((rnd() % 190) / 100.0)) * boundaryDamping2;

                const strokes2 = handDrawNeedsInputGuide(
                    context,
                    faceId + ("secondaryStroke" ~ toString(secondaryIndex)),
                    chordLength * 1.15,
                    strokeVariance2,
                    rnd,
                    guideEdge2,
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

function handDrawNeedsInputGuide(
    context is Context,
    id is Id,
    chordLength is ValueWithUnits,
    variance is ValueWithUnits,
    rnd is function,
    edgeQuery is Query,
    grey is number,
    alpha is number,
    singlePass is boolean,
    mistakeChance is number)
returns Query
{
    const edgeLength = evLength(context, { "entities" : edgeQuery });

    // Jitter capped to a fraction of the guide's OWN length -- a short
    // guide on a tight fillet/small area otherwise gets the same
    // absolute wobble as a long guide on a flat face.
    const maxJitter = min(variance, edgeLength * 0.05);

    const numStrokes = singlePass
        ? 1
        : (((rnd() % 100) < 78) ? 1 : 2);

    var result = qNothing();

    for (var strokeIndex = 0; strokeIndex < numStrokes; strokeIndex += 1)
    {
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

        var pts = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            const p0 = tangents[i].origin as Vector;
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

            const normalizedIndex =
                pointCount > 1
                ? i / (pointCount - 1)
                : 0.5;

            const endLooseness =
                1.0 + abs(normalizedIndex - 0.5) * 0.5;

            const amount =
                maxJitter * jitterFactor * mistakeFactor * endLooseness;

            const offset1 =
                2 * (((s1 + i * 17 + strokeIndex * 29) % 100) / 100.0 - 0.5) * amount;
            const offset2 =
                2 * (((s1 + i * 31 + strokeIndex * 43) % 100) / 100.0 - 0.5) * amount;

            pts[i] = p0 + perp1 * offset1 + perp2 * offset2;
        }

        const strokeId = id + ("stroke" ~ toString(strokeIndex));

        opFitSpline(context, strokeId, { "points" : pts });

        const strokeBody = qCreatedBy(strokeId, EntityType.BODY);
        const alphaJitter =
            (((rnd() % 100) / 100.0) - 0.5) * 0.18;

        const strokeAlpha =
            min(max(alpha + alphaJitter, 0.14), 0.72);

        setProperty(
            context,
            {
                "entities" : strokeBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(grey, grey, grey, strokeAlpha)
            }
        );

        result = qUnion(result, strokeBody);
    }

    return result;
}

//////////////////////////////////////////////////////////////////////
// VERY FAINT COMPLETE OUTLINE
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
        qOwnedByBody(qEverything(EntityType.EDGE), body)
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


//////////////////////////////////////////////////////////////////////
// CLEAN ENGINEERING ANNOTATIONS
//////////////////////////////////////////////////////////////////////

function drawEngineeringLinearArrow(
    context is Context,
    id is Id,
    startPoint is Vector,
    endPoint is Vector,
    labelText is string,
    showTargetMarker is boolean)
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
    const markerColor = color(0.16, 0.16, 0.16, 0.82);

    const shaftSpread =
        min(max(distance * 0.022, 0.65 * millimeter), 2.0 * millimeter);

    const headLength =
        min(max(distance * 0.20, 6 * millimeter), 16 * millimeter);

    const headWidth =
        min(max(distance * 0.10, 3.5 * millimeter), 8 * millimeter);

    const markerSize =
        min(max(distance * 0.06, 2.5 * millimeter), 6 * millimeter);

    var arrowBodies = qNothing();

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
        opFitSpline(
            context,
            shaftId,
            {
                "points" : [
                    startPoint + shaftOffsets[s],
                    endPoint + shaftOffsets[s]
                ]
            }
        );

        arrowBodies = qUnion(
            arrowBodies,
            qCreatedBy(shaftId, EntityType.BODY)
        );
    }

    const headBase = endPoint - direction * headLength;
    const diag1 = normalize(side + side2);
    const diag2 = normalize(side - side2);
    const headDirs = [
        side, -side,
        side2, -side2,
        diag1, -diag1,
        diag2, -diag2
    ];

    for (var h = 0; h < 8; h += 1)
    {
        const wingId = id + ("headWing" ~ toString(h));
        opFitSpline(
            context,
            wingId,
            {
                "points" : [
                    endPoint,
                    headBase + headDirs[h] * headWidth
                ]
            }
        );

        arrowBodies = qUnion(
            arrowBodies,
            qCreatedBy(wingId, EntityType.BODY)
        );
    }

    if (!isQueryEmpty(context, arrowBodies))
    {
        opCreateCompositePart(
            context,
            id + "arrowComposite",
            {
                "bodies" : arrowBodies,
                "closed" : false
            }
        );

        setProperty(
            context,
            {
                "entities" :
                    qCreatedBy(id + "arrowComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : arrowColor
            }
        );
    }

    // Start cross.
    var markerBodies = qNothing();

    opFitSpline(
        context,
        id + "startCross1",
        {
            "points" : [
                startPoint - side * markerSize,
                startPoint + side * markerSize
            ]
        }
    );

    opFitSpline(
        context,
        id + "startCross2",
        {
            "points" : [
                startPoint - side2 * markerSize,
                startPoint + side2 * markerSize
            ]
        }
    );

    markerBodies = qUnion(
        markerBodies,
        qCreatedBy(id + "startCross1", EntityType.BODY)
    );

    markerBodies = qUnion(
        markerBodies,
        qCreatedBy(id + "startCross2", EntityType.BODY)
    );

    if (showTargetMarker)
    {
        const d1 = endPoint + side * markerSize;
        const d2 = endPoint + side2 * markerSize;
        const d3 = endPoint - side * markerSize;
        const d4 = endPoint - side2 * markerSize;

        opFitSpline(context, id + "target1", { "points" : [d1, d2] });
        opFitSpline(context, id + "target2", { "points" : [d2, d3] });
        opFitSpline(context, id + "target3", { "points" : [d3, d4] });
        opFitSpline(context, id + "target4", { "points" : [d4, d1] });
        opFitSpline(context, id + "targetCross1", { "points" : [d1, d3] });
        opFitSpline(context, id + "targetCross2", { "points" : [d2, d4] });

        markerBodies = qUnion(markerBodies, qCreatedBy(id + "target1", EntityType.BODY));
        markerBodies = qUnion(markerBodies, qCreatedBy(id + "target2", EntityType.BODY));
        markerBodies = qUnion(markerBodies, qCreatedBy(id + "target3", EntityType.BODY));
        markerBodies = qUnion(markerBodies, qCreatedBy(id + "target4", EntityType.BODY));
        markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetCross1", EntityType.BODY));
        markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetCross2", EntityType.BODY));
    }

    if (!isQueryEmpty(context, markerBodies))
    {
        opCreateCompositePart(
            context,
            id + "markerComposite",
            {
                "bodies" : markerBodies,
                "closed" : false
            }
        );

        setProperty(
            context,
            {
                "entities" :
                    qCreatedBy(id + "markerComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : markerColor
            }
        );
    }

    // Label.
    const labelPoint =
        startPoint +
        offset * 0.52 +
        side2 * min(max(distance * 0.10, 5 * millimeter), 10 * millimeter);

    const labelPlane =
        plane(
            labelPoint + side * (0.02 * millimeter),
            side
        );

    const labelUv =
        worldToPlane(labelPlane, labelPoint);

    const labelSketch =
        newSketchOnPlane(
            context,
            id + "labelSketch",
            { "sketchPlane" : labelPlane }
        );

    const textSize = 4.0 * millimeter;

    skText(
        labelSketch,
        "label",
        {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" :
                vector(
                    labelUv[0] - 2.7 * textSize,
                    labelUv[1] - textSize
                ),
            "secondCorner" :
                vector(
                    labelUv[0] + 2.7 * textSize,
                    labelUv[1] + textSize
                )
        }
    );

    skSolve(labelSketch);
}
function drawDashedReferenceLine(
    context is Context,
    id is Id,
    startPoint is Vector,
    endPoint is Vector)
{
    const total = endPoint - startPoint;
    const length = norm(total);

    if (length / millimeter < 0.001)
    {
        return;
    }

    const dashCount = 10;
    const dashRatio = 0.55;
    var bodies = qNothing();

    for (var i = 0; i < dashCount; i += 1)
    {
        const t0 = i / dashCount;
        const t1 = t0 + dashRatio / dashCount;
        const segId = id + ("dash" ~ toString(i));

        opFitSpline(
            context,
            segId,
            {
                "points" : [
                    startPoint + total * t0,
                    startPoint + total * t1
                ]
            }
        );

        bodies = qUnion(
            bodies,
            qCreatedBy(segId, EntityType.BODY)
        );
    }

    if (!isQueryEmpty(context, bodies))
    {
        opCreateCompositePart(
            context,
            id + "composite",
            {
                "bodies" : bodies,
                "closed" : false
            }
        );

        setProperty(
            context,
            {
                "entities" :
                    qCreatedBy(id + "composite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.18, 0.18, 0.18, 0.55)
            }
        );
    }
}


function RandomNumberFunctionWithSalt(id, salt)
returns function
{
    const baseSeed = idToNum(id[0]);
    const saltSeed = idToNum(salt);
    return lcprng((baseSeed + saltSeed * 97) % 100000);
}
function idToNum(input is string)
returns number
{
    const chrMap =
    {
        'A' : 0, 'B' : 1, 'C' : 2, 'D' : 3, 'E' : 4, 'F' : 5, 'G' : 6, 'H' : 7,
        'I' : 8, 'J' : 9, 'K' : 10, 'L' : 11, 'M' : 12, 'N' : 13, 'O' : 14, 'P' : 15,
        'Q' : 16, 'R' : 17, 'S' : 18, 'T' : 19, 'U' : 20, 'V' : 21, 'W' : 22, 'X' : 23,
        'Y' : 24, 'Z' : 25,
        'a' : 26, 'b' : 27, 'c' : 28, 'd' : 29, 'e' : 30, 'f' : 31, 'g' : 32, 'h' : 33,
        'i' : 34, 'j' : 35, 'k' : 36, 'l' : 37, 'm' : 38, 'n' : 39, 'o' : 40, 'p' : 41,
        'q' : 42, 'r' : 43, 's' : 44, 't' : 45, 'u' : 46, 'v' : 47, 'w' : 48, 'x' : 49,
        'y' : 50, 'z' : 51,
        '_' : 99, '-' : 98
    };

    var out is string = "";

    for (var char in splitIntoCharacters(input))
    {
        var res = match(char, REGEX_NUMBER);

        if (res.hasMatch)
        {
            out = out ~ toString(res.captures[0]);
        }
        else
        {
            out = out ~ toString(chrMap[char]);
        }
    }

    return stringToNumber(out) % 100000;
}

function lcprng(seed is number)
returns function
{
    const a = 1103515245;
    const c = 12345;
    const m = 2^31;

    var state = new box(seed);

    return function()
    {
        state[] = (a * state[] + c) % m;
        return state[];
    };
}

