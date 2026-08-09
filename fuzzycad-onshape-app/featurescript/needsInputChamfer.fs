FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

// Needs Input Chamfer
// Sparse/incomplete geometry + very faint boundary.
// Engineering leader remains clean; uncertainty is expressed by C = ?.

annotation {
    "Feature Type Name" : "FuzzyCAD Needs Input Chamfer",
    "Manipulator Change Function" : "fuzzycadNeedsInputChamferManipulatorChange"
}
export const fuzzycadNeedsInputChamfer = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to chamfer", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Edge to chamfer", "Filter" : EntityType.EDGE }
        definition.edge is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, BLEND_BOUNDS);

        annotation { "Name" : "Width needs input", "Default" : true }
        definition.widthNeedsInput is boolean;

        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        if (isQueryEmpty(context, definition.body) || isQueryEmpty(context, definition.edge))
        {
            return;
        }

        const originalBody = definition.body;
        const edgeLine = evEdgeTangentLine(context, {
                "edge" : definition.edge,
                "parameter" : 0.5
        });
        const midpoint = edgeLine.origin;
        const tangentDir = edgeLine.direction;

        if (definition.accepted)
        {
            opChamfer(context, id + "acceptedChamfer", {
                    "entities" : definition.edge,
                    "chamferType" : ChamferType.EQUAL_OFFSETS,
                    "width" : definition.width,
                    "tangentPropagation" : true
            });
            return;
        }

        const trackedSelection = startTracking(context, definition.edge);

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody =
            qPatternInstances(id + "duplicate", "proposed", EntityType.BODY);

        const copiedSelection =
            qOwnedByBody(trackedSelection, proposedBody);

        if (isQueryEmpty(context, copiedSelection))
        {
            throw regenError(
                "Could not track the selected chamfer edge onto the proposal copy.",
                definition.edge
            );
        }

        opChamfer(context, id + "previewChamfer", {
                "entities" : copiedSelection,
                "chamferType" : ChamferType.EQUAL_OFFSETS,
                "width" : definition.width,
                "tangentPropagation" : true
        });

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        drawNeedsInputSketch(context, id + "needsSketch", proposedBody);
        drawVeryLightGhostOutline(context, id + "ghostOutline", proposedBody);

        const ref =
            (abs(tangentDir[2]) < 0.9)
            ? vector(0, 0, 1)
            : vector(0, 1, 0);

        const calloutDir =
            normalize(cross(tangentDir, ref));

        const leaderLength =
            max(definition.width * 5, 22 * millimeter);

        const labelText =
            definition.widthNeedsInput
            ? "C = ?"
            : "C = " ~ toString(round(definition.width / millimeter, 1)) ~ " mm";

        drawEngineeringLeader(
            context,
            id + "chamferLeader",
            midpoint,
            calloutDir,
            leaderLength,
            labelText
        );

        addManipulators(context, id, {
                "widthManipulator" : linearManipulator({
                        "base" : midpoint,
                        "direction" : calloutDir,
                        "offset" : definition.width,
                        "primaryParameterId" : "width"
                })
        });

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

export function fuzzycadNeedsInputChamferManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map)
returns map
{
    if (newManipulators["widthManipulator"] != undefined)
    {
        definition.width =
            newManipulators["widthManipulator"].offset;
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
    const variance = 0.55 * millimeter;

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
                const grey = 0.05 + ((rnd() % 18) / 100.0);
                const alpha = 0.26 + ((rnd() % 30) / 100.0);
                const strokeVariance =
                    variance * (1.25 + ((rnd() % 175) / 100.0));

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
                const grey2 = 0.10 + ((rnd() % 18) / 100.0);
                const alpha2 = 0.22 + ((rnd() % 24) / 100.0);
                const strokeVariance2 =
                    variance * (1.6 + ((rnd() % 190) / 100.0));

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

    const numStrokes = singlePass
        ? 1
        : (((rnd() % 100) < 78) ? 1 : 2);

    var result = qNothing();

    for (var strokeIndex = 0; strokeIndex < numStrokes; strokeIndex += 1)
    {
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

        var pts = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            var p = tangents[i].origin as Vector;
            const s1 = rnd();
            const s2 = rnd();

            const jitterFactor =
                0.65 + ((s2 % 100) / 100.0) * 0.85;

            const isMistake =
                (((rnd() % 100) / 100.0) < mistakeChance);

            const mistakeFactor = isMistake
                ? 1.45 + ((rnd() % 100) / 100.0) * 1.55
                : 1.0;

            const normalizedIndex =
                pointCount > 1
                ? i / (pointCount - 1)
                : 0.5;

            const endLooseness =
                1.0 + abs(normalizedIndex - 0.5) * 0.9;

            p[0] += 2 * (((s1 + i * 17 + strokeIndex * 29) % 100) / 100.0 - 0.5) * variance * jitterFactor * mistakeFactor * endLooseness;
            p[1] += 2 * (((s1 + i * 31 + strokeIndex * 43) % 100) / 100.0 - 0.5) * variance * jitterFactor * mistakeFactor * endLooseness;
            p[2] += 2 * (((s1 + i * 47 + strokeIndex * 61) % 100) / 100.0 - 0.5) * variance * jitterFactor * mistakeFactor * endLooseness;

            pts[i] = p;
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
function drawEngineeringLeader(
    context is Context,
    id is Id,
    anchorPoint is Vector,
    direction is Vector,
    leaderLength is ValueWithUnits,
    labelText is string)
{
    if (leaderLength / millimeter < 0.001)
    {
        return;
    }

    const dir = normalize(direction);
    const ref = (abs(dir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
    const side = normalize(cross(dir, ref));
    const side2 = normalize(cross(dir, side));

    // Arrow points TO the edited edge/feature.
    const labelPoint = anchorPoint + dir * leaderLength;
    const arrowColor = color(0.88, 0.16, 0.12, 1.0);
    const headLength = min(max(leaderLength * 0.20, 4 * millimeter), 10 * millimeter);
    const headWidth = min(max(leaderLength * 0.09, 2.5 * millimeter), 6 * millimeter);

    var bodies = qNothing();

    opFitSpline(
        context,
        id + "leader",
        { "points" : [labelPoint, anchorPoint] }
    );

    bodies = qUnion(
        bodies,
        qCreatedBy(id + "leader", EntityType.BODY)
    );

    const headBase = anchorPoint + dir * headLength;
    const dirs = [side, -side, side2, -side2];

    for (var i = 0; i < 4; i += 1)
    {
        const wingId = id + ("wing" ~ toString(i));
        opFitSpline(
            context,
            wingId,
            {
                "points" : [
                    anchorPoint,
                    headBase + dirs[i] * headWidth
                ]
            }
        );
        bodies = qUnion(
            bodies,
            qCreatedBy(wingId, EntityType.BODY)
        );
    }

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
            "entities" : qCreatedBy(id + "composite", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : arrowColor
        }
    );

    const textPoint = labelPoint + side2 * (4 * millimeter);
    const textPlane =
        plane(
            textPoint + side * (0.02 * millimeter),
            side
        );

    const textUv = worldToPlane(textPlane, textPoint);
    const textSketch =
        newSketchOnPlane(
            context,
            id + "labelSketch",
            { "sketchPlane" : textPlane }
        );

    const textSize = 3.6 * millimeter;

    skText(
        textSketch,
        "label",
        {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" :
                vector(
                    textUv[0] - 2.2 * textSize,
                    textUv[1] - textSize
                ),
            "secondCorner" :
                vector(
                    textUv[0] + 2.2 * textSize,
                    textUv[1] + textSize
                )
        }
    );

    skSolve(textSketch);
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

