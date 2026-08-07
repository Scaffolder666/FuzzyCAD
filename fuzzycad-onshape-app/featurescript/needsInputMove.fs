// FuzzyCAD "Needs Input Move" custom feature -- sibling of
// proposedMove.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale.
//
// REWRITTEN to match proposedMove.fs's v8 architecture: a hidden
// "accepted" boolean (UIHint.ALWAYS_HIDDEN) lets the SAME feature
// instance switch between a pending-state preview and a real committed
// opTransform, instead of the old separate amber-whole-body styling
// with no accept path of its own.
//
// Visualization technique CHANGED again, per explicit request: instead
// of proposedMove.fs's hand-drawn EDGE wireframe (handDrawEdgeSketchy),
// this uses a hand-drawn FACE FILL scribble (drawSketchyFaceFill below)
// -- dense pencil-hatch strokes sampled from opCreateCurvesOnFace guide
// curves across every face of the proposed body, rather than just its
// silhouette edges. Colors were also explicitly changed from Proposed*'s
// blue to black, since "Needs Input" is meant to read as a rougher,
// less-final placeholder sketch than "Proposed".
//
// opCreateCurvesOnFace / curveOnFaceDefinition / FaceCurveCreationType
// are NOT independently confirmed live by us in this file -- they were
// supplied already-working in the pasted reference this was adapted
// from. Flagging here per this session's practice of not silently
// treating borrowed-but-unverified calls as confirmed.
//
// "Move X/Y/Z" start at whatever placeholder values (e.g. 0) whoever
// inserts this leaves them at -- someone else fills in the real numbers
// via the right panel's existing live-edit path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input Move" }
export const fuzzycadNeedsInputMove = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to move", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Move X" }
        isLength(definition.moveX, LENGTH_BOUNDS);

        // Per-parameter "still open" flags -- unlike Proposed* (every
        // value is already decided, reviewer just accepts/rejects), a
        // Needs Input instance can be a MIX of known and unknown values:
        // whoever inserts it may already know Move X but not Y/Z, for
        // example. Each flag defaults to true (open) and is visible (NOT
        // ALWAYS_HIDDEN) so the inserter -- or anyone editing later --
        // consciously marks which fields are still real open questions.
        // Purely metadata for the right panel to key its candidate-value
        // UI off of; does not affect geometry, which always uses
        // whatever moveX/Y/Z currently holds regardless of these flags.
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

        const offset = vector(definition.moveX, definition.moveY, definition.moveZ);

        //////////////////////////////////////////////////////////////////
        // ACCEPTED STATE -- real geometry, no preview.
        //////////////////////////////////////////////////////////////////

        if (definition.accepted)
        {
            opTransform(context, id + "acceptedMove", {
                    "bodies" : originalBody,
                    "transform" : transform(offset)
            });

            return;
        }

        //////////////////////////////////////////////////////////////////
        // PENDING STATE
        //////////////////////////////////////////////////////////////////

        // 1. Fade the original body.
        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        // 2. Temporary moved copy, just to get the proposed faces.
        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(offset)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        // 3. Hand-drawn face scribble fill across the proposed body.
        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        // 4. Movement arrows, black instead of Proposed*'s blue.
        const arrowColor = color(0, 0, 0, 0.85);

        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const bboxCenter = vector(
                (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
                (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
                (bbox.minCorner[2] + bbox.maxCorner[2]) / 2
        );

        drawAxisArrow(context, id + "arrowX", bboxCenter, vector(definition.moveX, 0 * meter, 0 * meter), "X", arrowColor);
        drawAxisArrow(context, id + "arrowY", bboxCenter, vector(0 * meter, definition.moveY, 0 * meter), "Y", arrowColor);
        drawAxisArrow(context, id + "arrowZ", bboxCenter, vector(0 * meter, 0 * meter, definition.moveZ), "Z", arrowColor);

        // 5. Delete the temporary exact proposed solid -- only the
        // scribble strokes and arrows (independent wire/surface bodies)
        // remain.
        opDeleteBodies(context, id + "deleteTemporaryProposal", { "entities" : proposedBody });
    });



//////////////////////////////////////////////////////////////////////
//
// HAND-DRAWN FACE SCRIBBLE FILL
//
// For every face of `body`: a dense "primary" field of DIR1
// auto-spaced guide curves (kept with rising probability toward the
// face center, so the fill reads denser in the middle like real pencil
// shading), each kept guide redrawn as 1-3 jittered pencil strokes;
// then a sparser "secondary" DIR2 field, single-pass strokes with a
// higher "bad pencil moment" chance, for a cross-hatched look. All
// strokes across all faces are combined into one composite part.
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

        //////////////////////////////////////////////////////////////
        // Primary field
        //////////////////////////////////////////////////////////////

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

        //////////////////////////////////////////////////////////////
        // Secondary field
        //////////////////////////////////////////////////////////////

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



//////////////////////////////////////////////////////////////////////
//
// HAND-DRAWN SCRIBBLE ALONG ONE GUIDE CURVE
//
// Same jitter principle as proposedMove.fs's handDrawEdgeSketchy, but
// with a different prime set (so the face-fill jitter stream looks
// distinct from any edge-wireframe stream in the same instance) and an
// added "mistake" chance that occasionally exaggerates one point's
// offset, like a stray pencil slip.
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
            // .origin already carries length units -- do not multiply
            // by meter (matches proposedMove.fs's confirmed-live note).
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
// FILLED AXIS ARROW -- copied verbatim (including the enlarged sizing
// constants) from proposedMove.fs's current version, so Move's needs-
// input arrows read the same size as its proposed-value counterparts.
//
//////////////////////////////////////////////////////////////////////

function drawAxisArrow(
    context is Context,
    id is Id,
    start is Vector,
    axisOffset is Vector,
    axisName is string,
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

    const shaftWidth = min(max(distanceMm * 0.09, 1.0), 3.5) * millimeter;
    const headLength = min(distanceMm * 0.45, 12) * millimeter;
    const headWidth = shaftWidth * 4;

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
            "text" : axisName ~ ": " ~ toString(round(distanceMm, 1)) ~ " mm",
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - textHeight * 1.5, labelUv[1] + labelOffset),
            "secondCorner" : vector(labelUv[0] + textHeight * 1.5, labelUv[1] + labelOffset + textHeight)
    });

    skSolve(labelSketch);
}



//////////////////////////////////////////////////////////////////////
//
// RANDOM NUMBER GENERATOR (salted variant -- lets two different
// pseudo-random streams exist within the same feature instance without
// colliding, e.g. face-fill vs. some future edge scribble).
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
