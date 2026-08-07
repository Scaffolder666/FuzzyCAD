// FuzzyCAD "Needs Input Rotate" custom feature -- sibling of
// proposedRotate.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// REWRITTEN to match proposedRotate.fs's hidden-"accepted"-param
// architecture plus the hand-drawn FACE SCRIBBLE FILL technique instead
// of the old whole-body amber color -- see needsInputMove.fs's header
// comment for the full rationale on the face-fill switch and the
// black-instead-of-blue color choice. The dashed angle arc + degree
// label is kept (drawAngleArc, copied from proposedRotate.fs, including
// its best-of-8-bbox-corner radius/plane selection) but now drawn in
// black to match.
//
// rotationAround()/line() are confirmed real (per proposedRotate.fs's
// header comment). dot() is used here (first introduced in
// proposedRotate.fs) but still not independently confirmed live like
// cross()/normalize().
//
// "Angle" starts at whatever placeholder value (e.g. 0) whoever inserts
// this leaves it at -- someone else fills in the real angle via the
// right panel's existing live-edit path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Rotate" }
export const fuzzycadNeedsInputRotate = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to rotate", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Rotation axis", "Filter" : EntityType.EDGE }
        definition.axis is Query;

        annotation { "Name" : "Angle" }
        isAngle(definition.angle, ANGLE_360_BOUNDS);

        // Per-parameter "still open" flag -- unlike Proposed* (the value
        // is already decided, reviewer just accepts/rejects), a Needs
        // Input instance may already have a known angle by the time
        // someone inserts it. Defaults to true (open) and is visible (NOT
        // ALWAYS_HIDDEN) so the inserter can mark it known instead. Purely
        // metadata for the right panel's candidate-value UI; does not
        // affect geometry, which always uses whatever "angle" holds.
        annotation { "Name" : "Angle needs input", "Default" : true }
        definition.angleNeedsInput is boolean;

        // Controlled internally by the FuzzyCAD right panel.
        // The normal Feature dialog will not show this parameter.
        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        const originalBody = definition.body;

        const axisStart = evEdgeTangentLine(context, {
                "edge" : definition.axis,
                "parameter" : 0.0
        }).origin;

        const axisEnd = evEdgeTangentLine(context, {
                "edge" : definition.axis,
                "parameter" : 1.0
        }).origin;

        const axisDirection = normalize(axisEnd - axisStart);
        const rotation = rotationAround(line(axisStart, axisDirection), definition.angle);

        // ACCEPTED STATE: rotate the real body directly, no
        // duplicate/preview machinery at all, then stop.
        if (definition.accepted)
        {
            opTransform(context, id + "acceptedRotate", {
                    "bodies" : originalBody,
                    "transform" : rotation
            });

            return;
        }

        // PENDING STATE below.

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [rotation],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        // Pick whichever of the bounding box's 8 corners sits FARTHEST
        // (perpendicular distance) from the rotation axis -- same
        // technique as proposedRotate.fs, so Needs Input's arc reads the
        // same way once a real angle is entered.
        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const corners = [
            vector(bbox.minCorner[0], bbox.minCorner[1], bbox.minCorner[2]),
            vector(bbox.minCorner[0], bbox.minCorner[1], bbox.maxCorner[2]),
            vector(bbox.minCorner[0], bbox.maxCorner[1], bbox.minCorner[2]),
            vector(bbox.minCorner[0], bbox.maxCorner[1], bbox.maxCorner[2]),
            vector(bbox.maxCorner[0], bbox.minCorner[1], bbox.minCorner[2]),
            vector(bbox.maxCorner[0], bbox.minCorner[1], bbox.maxCorner[2]),
            vector(bbox.maxCorner[0], bbox.maxCorner[1], bbox.minCorner[2]),
            vector(bbox.maxCorner[0], bbox.maxCorner[1], bbox.maxCorner[2])
        ];

        var arcRadius = 0 * meter;
        var bestPerpOffset = vector(0, 0, 0) * meter;
        var bestAlongAxis = vector(0, 0, 0) * meter;

        for (var c = 0; c < 8; c += 1)
        {
            const cornerOffset = corners[c] - axisStart;
            const alongAxisC = dot(cornerOffset, axisDirection) * axisDirection;
            const perpOffsetC = cornerOffset - alongAxisC;
            const radiusC = norm(perpOffsetC);

            if (radiusC > arcRadius)
            {
                arcRadius = radiusC;
                bestPerpOffset = perpOffsetC;
                bestAlongAxis = alongAxisC;
            }
        }

        if (arcRadius / millimeter > 0.001)
        {
            const perpVec = normalize(bestPerpOffset);
            const perpVec2 = cross(axisDirection, perpVec);
            const arcCenter = axisStart + bestAlongAxis;
            const dimensionColor = color(0, 0, 0, 0.85);

            // A precise dashed arc swept through the exact placeholder
            // angle would be fake precision -- see needsInputMove.fs's
            // drawFuzzyDirectionGesture for the rationale. Here that
            // means: sweep a fixed, arbitrary nominal angle (NOT
            // definition.angle) with a wobbly radius per dash, and label
            // it "?" instead of a degree number.
            if (definition.angleNeedsInput)
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
                        toString(round(definition.angle / degree, 1)) ~ "°",
                        dimensionColor
                );
            }
        }

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

//////////////////////////////////////////////////////////////////////
//
// DASHED ANGLE ARC + LABEL (copied verbatim from proposedRotate.fs)
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
    const dashCount = 24;
    const dashRatio = 0.6;
    var allDashes = qNothing();

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
            pts[j] = center + dir * radius;
        }

        const dashId = id + "dash" + toString(d);
        opFitSpline(context, dashId, { "points" : pts });
        allDashes = qUnion(allDashes, qCreatedBy(dashId, EntityType.BODY));
    }

    if (!isQueryEmpty(context, allDashes))
    {
        opCreateCompositePart(context, id + "composite", {
                "bodies" : allDashes,
                "closed" : false
        });

        setProperty(context, {
                "entities" : qCreatedBy(id + "composite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : arcColor
        });
    }

    const midAng = angle * 0.5;
    const midDir = startDir * cos(midAng) + otherDir * sin(midAng);
    const midPt = center + midDir * radius;
    const eps = 0.01 * millimeter;
    const labelPlane = plane(midPt + axisDirection * eps, axisDirection);
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : labelPlane });
    const labelUv = worldToPlane(labelPlane, midPt);
    const textSize = 3 * millimeter;

    skText(labelSketch, "labelText", {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - textSize, labelUv[1] - textSize),
            "secondCorner" : vector(labelUv[0] + textSize, labelUv[1] + textSize)
    });

    skSolve(labelSketch);
}

//////////////////////////////////////////////////////////////////////
//
// FUZZY ANGLE GESTURE
//
// Used instead of drawAngleArc when "angleNeedsInput" is still true: a
// precise dashed arc swept through the exact placeholder angle would be
// fake precision -- see needsInputMove.fs's drawFuzzyDirectionGesture
// for the full rationale. Sweeps a fixed, arbitrary NOMINAL angle
// (never definition.angle) with a wobbly radius per dash instead of a
// clean constant one, and labels it with plain text ("?°") instead of a
// degree number.
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
    const nominalAngle = 40 * degree;
    const dashCount = 14;
    const dashRatio = 0.55;

    var rnd = RandomNumberFunctionWithSalt(id, "gesture");
    var allDashes = qNothing();

    for (var d = 0; d < dashCount; d += 1)
    {
        const t0 = d / dashCount;
        const t1 = t0 + dashRatio / dashCount;
        var pts = makeArray(4, undefined);

        const s1 = rnd();
        const radiusJitter = 1.0 + (((s1 + d * 23) % 100) / 100.0 - 0.5) * 0.18;
        const dashRadius = radius * radiusJitter;

        for (var j = 0; j < 4; j += 1)
        {
            const tt = t0 + (t1 - t0) * (j / 3);
            const ang = nominalAngle * tt;
            const dir = startDir * cos(ang) + otherDir * sin(ang);
            pts[j] = center + dir * dashRadius;
        }

        const dashId = id + "dash" + toString(d);
        opFitSpline(context, dashId, { "points" : pts });
        allDashes = qUnion(allDashes, qCreatedBy(dashId, EntityType.BODY));
    }

    if (!isQueryEmpty(context, allDashes))
    {
        opCreateCompositePart(context, id + "composite", {
                "bodies" : allDashes,
                "closed" : false
        });

        setProperty(context, {
                "entities" : qCreatedBy(id + "composite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : gestureColor
        });
    }

    const midAng = nominalAngle * 0.5;
    const midDir = startDir * cos(midAng) + otherDir * sin(midAng);
    const midPt = center + midDir * radius;
    const eps = 0.01 * millimeter;
    const labelPlane = plane(midPt + axisDirection * eps, axisDirection);
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : labelPlane });
    const labelUv = worldToPlane(labelPlane, midPt);
    const textSize = 3 * millimeter;

    skText(labelSketch, "labelText", {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - textSize, labelUv[1] - textSize),
            "secondCorner" : vector(labelUv[0] + textSize, labelUv[1] + textSize)
    });

    skSolve(labelSketch);
}

//////////////////////////////////////////////////////////////////////
//
// HAND-DRAWN FACE SCRIBBLE FILL (copied verbatim from needsInputMove.fs)
//
//////////////////////////////////////////////////////////////////////

function drawSketchyFaceFill(context is Context, id is Id, body is Query)
{
    const chordLength = 3 * millimeter;
    const variance = 0.4 * millimeter;

    var rnd = RandomNumberFunctionWithSalt(id, "faceFill");

    var allStrokes = qNothing();

    const faces = qOwnedByBody(qEverything(EntityType.FACE), body);
    var faceIndex = 0;

    for (var faceQuery in evaluateQuery(context, faces))
    {
        const faceId = id + ("face" ~ toString(faceIndex));

        const primaryCount = 46 + (rnd() % 7); // 46-52

        var primaryNames = makeArray(primaryCount, "");
        for (var n = 0; n < primaryCount; n += 1)
        {
            primaryNames[n] = "primary" ~ toString(n);
        }

        const primaryGuideId = faceId + "primaryGuides";
        opCreateCurvesOnFace(context, primaryGuideId,
            curveOnFaceDefinition(faceQuery, FaceCurveCreationType.DIR1_AUTO_SPACED_ISO, primaryNames, primaryCount));

        const primaryGuides = qCreatedBy(primaryGuideId, EntityType.EDGE);
        var primaryIndex = 0;

        for (var guideEdge in evaluateQuery(context, primaryGuides))
        {
            const isEndpoint = (primaryIndex == 0) || (primaryIndex == primaryCount - 1);

            const distFromEdge = min(primaryIndex, primaryCount - 1 - primaryIndex);
            const centerProximity = min(distFromEdge / (primaryCount / 2.0), 1.0);
            const keepProbability = isEndpoint ? 1.0 : (0.18 + 0.82 * centerProximity);

            if (isEndpoint || (((rnd() % 100) / 100.0) < keepProbability))
            {
                const r = min(0.03 + ((rnd() % 24) / 100.0) * 0.25, 1);
                const g = min(0.03 + ((rnd() % 29) / 100.0) * 0.25, 1);
                const b = min(0.03 + ((rnd() % 25) / 100.0) * 0.25, 1);

                const strokes = handDrawScribbleGuide(
                    context,
                    faceId + ("primaryStroke" ~ toString(primaryIndex)),
                    chordLength, variance, rnd, guideEdge,
                    r, g, b, 0.55, false, 0.06);

                allStrokes = qUnion(allStrokes, strokes);
            }

            primaryIndex += 1;
        }

        opDeleteBodies(context, faceId + "deletePrimaryGuides", {
                "entities" : qCreatedBy(primaryGuideId, EntityType.BODY)
        });

        const secondaryCount = 7 + (rnd() % 4); // 7-10

        var secondaryNames = makeArray(secondaryCount, "");
        for (var m = 0; m < secondaryCount; m += 1)
        {
            secondaryNames[m] = "secondary" ~ toString(m);
        }

        const secondaryGuideId = faceId + "secondaryGuides";
        opCreateCurvesOnFace(context, secondaryGuideId,
            curveOnFaceDefinition(faceQuery, FaceCurveCreationType.DIR2_AUTO_SPACED_ISO, secondaryNames, secondaryCount));

        const secondaryGuides = qCreatedBy(secondaryGuideId, EntityType.EDGE);
        var secondaryIndex = 0;

        for (var guideEdge2 in evaluateQuery(context, secondaryGuides))
        {
            if (((rnd() % 100) / 100.0) < 0.45)
            {
                const r2 = min(0.10 + ((rnd() % 20) / 100.0) * 0.3, 1);
                const g2 = min(0.10 + ((rnd() % 22) / 100.0) * 0.3, 1);
                const b2 = min(0.10 + ((rnd() % 22) / 100.0) * 0.3, 1);

                const strokes2 = handDrawScribbleGuide(
                    context,
                    faceId + ("secondaryStroke" ~ toString(secondaryIndex)),
                    chordLength, variance, rnd, guideEdge2,
                    r2, g2, b2, 0.4, true, 0.10);

                allStrokes = qUnion(allStrokes, strokes2);
            }

            secondaryIndex += 1;
        }

        opDeleteBodies(context, faceId + "deleteSecondaryGuides", {
                "entities" : qCreatedBy(secondaryGuideId, EntityType.BODY)
        });

        faceIndex += 1;
    }

    if (!isQueryEmpty(context, allStrokes))
    {
        opCreateCompositePart(context, id + "faceFillComposite", {
                "bodies" : allStrokes,
                "closed" : false
        });
    }
}

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
    var edgeLength = evLength(context, { "entities" : edgeQuery });
    var pointCount = ceil(max(edgeLength / chordLength, 5));

    var tangents = @evEdgeTangentLines(context, {
            "edge" : edgeQuery,
            "parameters" : range(0.0, 1.0, pointCount)
    });

    var rawRandom = rnd() % 100;
    var numStrokes = singlePass ? 1 : (1 + floor(rawRandom / 34)); // 1-3

    var strokesQuery = qNothing();

    for (var strokeIndex = 0; strokeIndex < numStrokes; strokeIndex += 1)
    {
        var newPoints = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            var basePt = tangents[i].origin as Vector;

            var s1 = rnd();
            var s2 = rnd();

            var jitterFactor = 0.5 + ((s2 % 100) / 100.0) * 0.5;

            var isMistake = (((rnd() % 100) / 100.0) < mistakeChance);
            var mistakeFactor = isMistake ? (1.30 + ((rnd() % 100) / 100.0) * 1.11) : 1.0;

            var offsetX = 2 * (((s1 + i * 17 + strokeIndex * 29) % 100) / 100.0 - 0.5) * variance * jitterFactor * mistakeFactor;
            var offsetY = 2 * (((s1 + i * 31 + strokeIndex * 43) % 100) / 100.0 - 0.5) * variance * jitterFactor * mistakeFactor;
            var offsetZ = 2 * (((s1 + i * 47 + strokeIndex * 61) % 100) / 100.0 - 0.5) * variance * jitterFactor * mistakeFactor;

            var perturbed = basePt;
            perturbed[0] += offsetX;
            perturbed[1] += offsetY;
            perturbed[2] += offsetZ;

            newPoints[i] = perturbed;
        }

        const strokeId = id + ("_stroke" ~ toString(strokeIndex));

        opFitSpline(context, strokeId, { "points" : newPoints });

        const strokeBody = qCreatedBy(strokeId, EntityType.BODY);

        const colorJitter = (rnd() % 100) / 100.0;
        const strokeAlpha = min(max(alpha + (colorJitter - 0.5) * 0.2, 0.1), 1.0);

        setProperty(context, {
                "entities" : strokeBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(red, green, blue, strokeAlpha)
        });

        strokesQuery = qUnion(strokesQuery, strokeBody);
    }

    return strokesQuery;
}

//////////////////////////////////////////////////////////////////////
//
// RANDOM NUMBER GENERATOR (salted variant, copied verbatim from
// needsInputMove.fs)
//
//////////////////////////////////////////////////////////////////////

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
