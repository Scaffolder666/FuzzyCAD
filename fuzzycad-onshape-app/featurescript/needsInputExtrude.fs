// FuzzyCAD "Needs Input Extrude" custom feature -- sibling of
// proposedExtrude.fs, a separate Cosmo Feature type, so it shows up as
// its own distinct entry in Onshape's own Insert toolbar, next to (not
// buried inside) "FuzzyCAD Proposed Extrude".
//
// Semantic difference from Proposed*: whoever inserts THIS one knows an
// extrude is needed here but does not know the depth yet -- "depth"
// starts at whatever placeholder value they leave it at, and someone
// else fills in the real number later via the right panel's existing
// live-edit mechanism. There's no "Accept becomes final" step the way
// Proposed* has -- once answered, this is just marked resolved directly.
//
// REWRITTEN to match proposedExtrude.fs's hidden-"accepted"-param
// architecture (the SAME feature instance switches between a pending
// preview and the real committed opExtrude) plus the hand-drawn FACE
// SCRIBBLE FILL technique instead of the old whole-body amber color --
// see needsInputMove.fs's header comment for the full rationale on the
// face-fill switch and the black-instead-of-blue color choice.
//
// opCreateCurvesOnFace / curveOnFaceDefinition / FaceCurveCreationType
// are NOT independently confirmed live by us -- flagged the same way in
// every needsInput*.fs file that now uses drawSketchyFaceFill.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Extrude" }
export const fuzzycadNeedsInputExtrude = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Entities to extrude", "Filter" : EntityType.FACE }
        definition.entities is Query;

        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);

        // Per-parameter "still open" flag -- unlike Proposed* (the value
        // is already decided, reviewer just accepts/rejects), a Needs
        // Input instance may already have a known depth by the time
        // someone inserts it. Defaults to true (open) and is visible (NOT
        // ALWAYS_HIDDEN) so the inserter can mark it known instead. Purely
        // metadata for the right panel's candidate-value UI; does not
        // affect geometry, which always uses whatever "depth" holds.
        annotation { "Name" : "Depth needs input", "Default" : true }
        definition.depthNeedsInput is boolean;

        annotation { "Name" : "Opposite direction", "Default" : false }
        definition.oppositeDirection is boolean;

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
        const facesToExtrude = evaluateQuery(context, definition.entities);
        var direction = evFaceTangentPlane(context, {
                "face" : facesToExtrude[0],
                "parameter" : vector(0.5, 0.5)
            }).normal;
        if (definition.oppositeDirection)
        {
            direction = -direction;
        }

        // ACCEPTED STATE: extrude the real solid body directly, then stop.
        if (definition.accepted)
        {
            opExtrude(context, id + "acceptedExtrude", {
                    "entities" : definition.entities,
                    "direction" : direction,
                    "endBound" : BoundingType.BLIND,
                    "endDepth" : definition.depth,
                    "operationType" : NewBodyOperationType.NEW
            });

            return;
        }

        // PENDING STATE: extrude into a throwaway body just to sample its
        // faces, build the hand-drawn face scribble fill from those, then
        // delete the throwaway solid.
        opExtrude(context, id + "duplicate", {
                "entities" : definition.entities,
                "direction" : direction,
                "endBound" : BoundingType.BLIND,
                "endDepth" : definition.depth,
                "operationType" : NewBodyOperationType.NEW
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

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
