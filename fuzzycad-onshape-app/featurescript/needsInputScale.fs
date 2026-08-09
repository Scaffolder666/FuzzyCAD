// FuzzyCAD "Needs Input Scale" custom feature -- sibling of
// proposedScale.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// REWRITTEN to match proposedScale.fs's hidden-"accepted"-param
// architecture plus the hand-drawn FACE SCRIBBLE FILL technique instead
// of the old whole-body amber color -- see needsInputMove.fs's header
// comment for the full rationale on the face-fill switch and the
// black-instead-of-blue color choice. The scale dimension arrow is kept
// (drawDimensionArrow, copied from proposedScale.fs) but now drawn in
// black to match.
//
// "Scale factor" starts at whatever placeholder value (e.g. 1, meaning
// no change yet) whoever inserts this leaves it at -- someone else
// fills in the real factor via the right panel's existing live-edit
// path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

// "Manipulator Change Function" -- lets someone drag a handle directly
// on the geometry to set the scale factor, same mechanism as
// needsInputMove.fs (see that file's header for the confirmed-live
// linearManipulator map syntax + the "newManipulators has exactly one
// entry" gotcha). Unlike Move/Fillet/Chamfer/Hole/Extrude, scaleFactor
// is dimensionless -- the manipulator's own "offset" is a length, so it
// stands in for the CURRENT SCALED distance from pivot to the body's
// far corner, and the change function divides that back by the
// UNSCALED distance to recover a factor.
annotation {
    "Feature Type Name" : "FuzzyCAD Needs Input Scale",
    "Manipulator Change Function" : "fuzzycadNeedsInputScaleManipulatorChange"
}
export const fuzzycadNeedsInputScale = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to scale", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Scale origin", "Filter" : EntityType.VERTEX }
        definition.originPoint is Query;

        annotation { "Name" : "Scale factor" }
        isReal(definition.scaleFactor, POSITIVE_REAL_BOUNDS);

        // Per-parameter "still open" flag -- unlike Proposed* (the value
        // is already decided, reviewer just accepts/rejects), a Needs
        // Input instance may already have a known scale factor by the
        // time someone inserts it. Defaults to true (open) and is visible
        // (NOT ALWAYS_HIDDEN) so the inserter can mark it known instead.
        // Purely metadata for the right panel's candidate-value UI; does
        // not affect geometry, which always uses whatever "scaleFactor"
        // holds.
        annotation { "Name" : "Scale factor needs input", "Default" : true }
        definition.scaleFactorNeedsInput is boolean;

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

        const pivot = evVertexPoint(context, { "vertex" : definition.originPoint });
        const scaleTransform = scaleNonuniformly(
                definition.scaleFactor,
                definition.scaleFactor,
                definition.scaleFactor,
                pivot
        );

        // ACCEPTED STATE: scale the real body directly, no
        // duplicate/preview machinery at all, then stop.
        if (definition.accepted)
        {
            opTransform(context, id + "acceptedScale", {
                    "bodies" : originalBody,
                    "transform" : scaleTransform
            });

            return;
        }

        // PENDING STATE below.

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [scaleTransform],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const farCorner = bbox.maxCorner;
        const scaledOffset = (farCorner - pivot) * definition.scaleFactor;
        const dimensionColor = color(0, 0, 0, 1.0);

        // A precise filled arrow + exact "×N" label would be fake
        // precision while "scaleFactor" is still just a placeholder --
        // see needsInputMove.fs's drawFuzzyDirectionGesture for the
        // rationale. Direction (pivot -> far corner, unscaled) is still
        // real and worth showing; the factor itself is not.
        if (definition.scaleFactorNeedsInput)
        {
            const pivotToCorner = farCorner - pivot;
            const gestureDir = (norm(pivotToCorner) > 0.001 * millimeter) ? normalize(pivotToCorner) : vector(1, 0, 0);

            drawFuzzyDirectionGesture(
                    context,
                    id + "scaleGesture",
                    pivot,
                    gestureDir,
                    min(max(norm(pivotToCorner) * 0.25, 8 * millimeter), 40 * millimeter),
                    "Scale: ?",
                    dimensionColor
            );
        }
        else
        {
            drawDimensionArrow(
                    context,
                    id + "scaleArrow",
                    pivot,
                    scaledOffset,
                    "Scale: ×" ~ toString(round(definition.scaleFactor, 2)),
                    dimensionColor
            );
        }

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });

        // Drag handle for scale factor. See the header comment above --
        // "offset" here is the CURRENT SCALED distance out to the far
        // corner, not the factor itself; the change function converts.
        const unscaledDistance = norm(farCorner - pivot);
        if (unscaledDistance > 0.001 * millimeter)
        {
            const manipulatorDir = normalize(farCorner - pivot);

            addManipulators(context, id, {
                    "scaleManipulator" : linearManipulator({
                            "base" : pivot,
                            "direction" : manipulatorDir,
                            "offset" : unscaledDistance * definition.scaleFactor,
                            "primaryParameterId" : "scaleFactor"
                    })
            });
        }
    });

// Manipulator Change Function referenced by the annotation above --
// recomputes the same pivot/far-corner distance the main body used (a
// Manipulator Change Function only gets context/definition/
// newManipulators, not the main body's own locals) to convert the
// dragged distance back into a dimensionless factor.
export function fuzzycadNeedsInputScaleManipulatorChange(context is Context, definition is map, newManipulators is map) returns map
{
    if (newManipulators["scaleManipulator"] == undefined)
    {
        return definition;
    }

    const pivot = evVertexPoint(context, { "vertex" : definition.originPoint });
    const bbox = evBox3d(context, { "topology" : definition.body, "tight" : true });
    const unscaledDistance = norm(bbox.maxCorner - pivot);

    if (unscaledDistance > 0.001 * millimeter)
    {
        const newFactor = newManipulators["scaleManipulator"].offset / unscaledDistance;
        // scaleFactor's own precondition requires POSITIVE_REAL_BOUNDS --
        // clamp so a drag past the pivot can't hand back zero/negative.
        definition.scaleFactor = max(newFactor, 0.01);
    }

    return definition;
}

//////////////////////////////////////////////////////////////////////
//
// FILLED DIMENSION ARROW (copied verbatim from proposedScale.fs)
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
    const distance = norm(axisOffset);
    const distanceMm = distance / millimeter;

    if (distanceMm < 0.001)
    {
        return;
    }

    const direction = normalize(axisOffset);

    const reference = (abs(direction[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
    const planeNormal = normalize(cross(direction, reference));
    const arrowPlane = plane(start, planeNormal, direction);

    const shaftWidth = min(max(distanceMm * 0.12, 2.5), 7) * millimeter;
    const headLength = min(distanceMm * 0.5, 24) * millimeter;
    const headWidth = shaftWidth * 4.5;

    const arrowSketch = newSketchOnPlane(context, id + "arrowSketch", { "sketchPlane" : arrowPlane });

    skLineSegment(arrowSketch, "headUpper", {
            "start" : vector(distance, 0 * meter),
            "end" : vector(distance - headLength, headWidth / 2)
    });
    skLineSegment(arrowSketch, "headLower", {
            "start" : vector(distance, 0 * meter),
            "end" : vector(distance - headLength, -headWidth / 2)
    });
    skLineSegment(arrowSketch, "headUpperTransition", {
            "start" : vector(distance - headLength, headWidth / 2),
            "end" : vector(distance - headLength, shaftWidth / 2)
    });
    skLineSegment(arrowSketch, "headLowerTransition", {
            "start" : vector(distance - headLength, -headWidth / 2),
            "end" : vector(distance - headLength, -shaftWidth / 2)
    });
    skLineSegment(arrowSketch, "shaftUpper", {
            "start" : vector(distance - headLength, shaftWidth / 2),
            "end" : vector(0 * meter, shaftWidth / 2)
    });
    skLineSegment(arrowSketch, "shaftLower", {
            "start" : vector(distance - headLength, -shaftWidth / 2),
            "end" : vector(0 * meter, -shaftWidth / 2)
    });
    skLineSegment(arrowSketch, "shaftBack", {
            "start" : vector(0 * meter, shaftWidth / 2),
            "end" : vector(0 * meter, -shaftWidth / 2)
    });

    skSolve(arrowSketch);

    opExtractSurface(context, id + "arrowSurface", {
            "faces" : qSketchRegion(id + "arrowSketch"),
            "offset" : 0 * meter,
            "useFacesAroundToTrimOffset" : false
    });

    opDeleteBodies(context, id + "deleteArrowSketch", {
            "entities" : qCreatedBy(id + "arrowSketch")
    });

    setProperty(context, {
            "entities" : qCreatedBy(id + "arrowSurface", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : arrowColor
    });

    const midPoint = start + axisOffset / 2;
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : arrowPlane });
    const labelUv = worldToPlane(arrowPlane, midPoint);
    const labelOffset = headWidth / 2 + 1.5 * millimeter;
    const textHeight = 2.5 * millimeter;

    skText(labelSketch, "labelText", {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - textHeight * 1.5, labelUv[1] + labelOffset),
            "secondCorner" : vector(labelUv[0] + textHeight * 1.5, labelUv[1] + labelOffset + textHeight)
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
        opCreateCurvesOnFace(context, primaryGuideId, {
                "curveDefinition" : [
                    curveOnFaceDefinition(faceQuery, FaceCurveCreationType.DIR1_AUTO_SPACED_ISO, primaryNames, primaryCount)
                ],
                "showCurves" : false,
                "skipTrim" : false
        });

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

                // Boundary-adjacent guides (isEndpoint) sit almost
                // exactly on the face's own real edge, so with normal
                // jitter they read as one crisp, ruler-straight line
                // framing the looser interior scribble -- extra
                // variance softens that "hard edge" look, per live
                // feedback on the first successful compile.
                const strokeVariance = isEndpoint ? variance * 2.5 : variance;

                const strokes = handDrawScribbleGuide(
                    context,
                    faceId + ("primaryStroke" ~ toString(primaryIndex)),
                    chordLength, strokeVariance, rnd, guideEdge,
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
        opCreateCurvesOnFace(context, secondaryGuideId, {
                "curveDefinition" : [
                    curveOnFaceDefinition(faceQuery, FaceCurveCreationType.DIR2_AUTO_SPACED_ISO, secondaryNames, secondaryCount)
                ],
                "showCurves" : false,
                "skipTrim" : false
        });

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
// FUZZY DIRECTION GESTURE (copied verbatim from needsInputMove.fs --
// see that file for the full rationale)
//
//////////////////////////////////////////////////////////////////////

function drawFuzzyDirectionGesture(
    context is Context,
    id is Id,
    start is Vector,
    direction is Vector,
    nominalLength is ValueWithUnits,
    labelText is string,
    gestureColor is map)
{
    if (norm(direction) < 0.0001)
    {
        return;
    }

    const dir = normalize(direction);

    const reference = (abs(dir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
    const perp1 = normalize(cross(dir, reference));
    const perp2 = cross(dir, perp1);

    var rnd = RandomNumberFunctionWithSalt(id, "gesture");

    const strokeCount = 3;
    const pointCount = 6;

    var allStrokes = qNothing();

    for (var s = 0; s < strokeCount; s += 1)
    {
        var pts = makeArray(pointCount, undefined);

        for (var i = 0; i < pointCount; i += 1)
        {
            const t = i / (pointCount - 1);
            const basePt = start + dir * (nominalLength * t);

            // Reduced from 0.04-0.14 -- at the old amplitude the
            // point-to-point sideways jitter was comparable in size to
            // the along-axis spacing between sample points, so the
            // stroke zigzagged almost as much sideways as it advanced,
            // reading as a tangled scribble instead of a recognizable
            // direction. Live feedback: "the three axes aren't straight
            // lines." This keeps a hand-drawn wobble without losing the
            // line's own directionality.
            const spread = nominalLength * (0.015 + 0.025 * t);

            const s1 = rnd();
            const jitter1 = ((s1 + i * 19 + s * 53) % 100) / 100.0 - 0.5;
            const jitter2 = ((s1 + i * 41 + s * 67) % 100) / 100.0 - 0.5;

            pts[i] = basePt + perp1 * (spread * jitter1) + perp2 * (spread * jitter2 * 0.6);
        }

        const strokeId = id + ("_gesture" ~ toString(s));
        opFitSpline(context, strokeId, { "points" : pts });
        allStrokes = qUnion(allStrokes, qCreatedBy(strokeId, EntityType.BODY));
    }

    if (!isQueryEmpty(context, allStrokes))
    {
        opCreateCompositePart(context, id + "gestureComposite", {
                "bodies" : allStrokes,
                "closed" : false
        });

        setProperty(context, {
                "entities" : qCreatedBy(id + "gestureComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : gestureColor
        });
    }

    const tipPt = start + dir * nominalLength;
    const labelPlane = plane(tipPt, perp1, dir);
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : labelPlane });
    const labelUv = worldToPlane(labelPlane, tipPt);
    const textHeight = 2.5 * millimeter;

    skText(labelSketch, "labelText", {
            "text" : labelText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - textHeight * 1.5, labelUv[1] + 1.5 * millimeter),
            "secondCorner" : vector(labelUv[0] + textHeight * 1.5, labelUv[1] + 1.5 * millimeter + textHeight)
    });

    skSolve(labelSketch);
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
