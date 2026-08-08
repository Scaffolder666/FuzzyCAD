// FuzzyCAD "Needs Input Fillet" custom feature -- sibling of
// proposedFillet.fs, a separate Cosmo Feature type -- see
// needsInputExtrude.fs's header comment for the full rationale on why
// these are separate types and how the lifecycle differs from Proposed*.
//
// REWRITTEN to match proposedFillet.fs's hidden-"accepted"-param
// architecture plus the hand-drawn FACE SCRIBBLE FILL technique instead
// of the old whole-body amber color -- see needsInputMove.fs's header
// comment for the full rationale on the face-fill switch and the
// black-instead-of-blue color choice. The radius dimension arrow is
// kept (drawDimensionArrow, copied from proposedFillet.fs) but now
// drawn in black to match.
//
// "radius" starts at whatever placeholder value whoever inserts this
// leaves it at -- someone else fills in the real number via the right
// panel's existing live-edit path.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

// "Manipulator Change Function" -- lets someone drag a handle directly
// on the geometry to set radius, same mechanism as needsInputMove.fs
// (see that file's header for the confirmed-live linearManipulator map
// syntax + the "newManipulators has exactly one entry" gotcha).
annotation {
    "Feature Type Name" : "FuzzyCAD Needs Input Fillet",
    "Manipulator Change Function" : "fuzzycadNeedsInputFilletManipulatorChange"
}
export const fuzzycadNeedsInputFillet = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to fillet", "Filter" : EntityType.BODY }
        definition.body is Query;

        // Accepts individual edges OR a whole face -- selecting a face
        // fillets its entire edge loop in one pass (matches native
        // Onshape Fillet's own face-selection behavior). "||" combining
        // entity types in a Filter is confirmed via an Onshape-employee-
        // answered forum thread, not independently compiled by us yet.
        annotation { "Name" : "Edges or face to round", "Filter" : EntityType.EDGE || EntityType.FACE }
        definition.edge is Query;

        annotation { "Name" : "Radius" }
        isLength(definition.radius, LENGTH_BOUNDS);

        // Per-parameter "still open" flag -- unlike Proposed* (the value
        // is already decided, reviewer just accepts/rejects), a Needs
        // Input instance may already have a known radius by the time
        // someone inserts it. Defaults to true (open) and is visible (NOT
        // ALWAYS_HIDDEN) so the inserter can mark it known instead. Purely
        // metadata for the right panel's candidate-value UI; does not
        // affect geometry, which always uses whatever "radius" holds.
        annotation { "Name" : "Radius needs input", "Default" : true }
        definition.radiusNeedsInput is boolean;

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

        // ACCEPTED STATE: fillet the real edges/face on the real body
        // directly, no duplicate/preview machinery at all, then stop.
        // opFillet's own "entities" parameter documents accepting BOTH
        // edges and faces directly (FsDoc's opFillet parameter table) --
        // no need to pre-expand a face into its boundary edges
        // ourselves. "tangentPropagation": true matches native Fillet's
        // own dialog, which shows "Tangent propagation" checked by
        // default -- LIVE-CONFIRMED this matters: the same face +
        // radius that filleted fine natively failed through us with
        // FILLET_FAILED before this was added, because opFillet's own
        // documented default for tangentPropagation is false, not true.
        if (definition.accepted)
        {
            opFillet(context, id + "acceptedFillet", {
                    "entities" : definition.edge,
                    "radius" : definition.radius,
                    "tangentPropagation" : true
            });

            return;
        }

        // PENDING STATE below.

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);
        const copiedEdges = qCreatedBy(id + "duplicate", EntityType.EDGE);
        const copiedFaces = qCreatedBy(id + "duplicate", EntityType.FACE);

        const selectedEdges = qEntityFilter(definition.edge, EntityType.EDGE);
        const selectedFaces = qEntityFilter(definition.edge, EntityType.FACE);

        // Match each ORIGINAL selected edge/face to its corresponding
        // duplicate entity by nearest point (opPattern's zero-offset
        // copy sits exactly on top of the original, so "closest" is
        // unambiguous per entity), and average all their representative
        // points into ONE anchor for the dimension label/manipulator --
        // there's still only one shared "radius" parameter, so a single
        // representative anchor/direction is used rather than a
        // dimension per entity.
        var matchedEntities = qNothing();
        var anchorSum = vector(0, 0, 0) * meter;
        var anchorTangent = vector(1, 0, 0);
        var entityCount = 0;

        for (var originalEdge in evaluateQuery(context, selectedEdges))
        {
            const tangentLine = evEdgeTangentLine(context, {
                    "edge" : originalEdge,
                    "parameter" : 0.5
            });
            const point = tangentLine.origin;

            matchedEntities = qUnion(matchedEntities, qClosestTo(copiedEdges, point));

            anchorSum = anchorSum + point;
            if (entityCount == 0)
            {
                anchorTangent = tangentLine.direction;
            }
            entityCount += 1;
        }

        for (var originalFace in evaluateQuery(context, selectedFaces))
        {
            const tangentPlane = evFaceTangentPlane(context, {
                    "face" : originalFace,
                    "parameter" : vector(0.5, 0.5)
            });
            const point = tangentPlane.origin;

            matchedEntities = qUnion(matchedEntities, qClosestTo(copiedFaces, point));

            anchorSum = anchorSum + point;
            if (entityCount == 0)
            {
                // A face has no single "tangent direction" the way an
                // edge does -- fall back to an arbitrary in-plane
                // direction so the dimension arrow/manipulator still has
                // SOME direction to point along.
                const reference = (abs(tangentPlane.normal[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
                anchorTangent = normalize(cross(tangentPlane.normal, reference));
            }
            entityCount += 1;
        }

        const midpoint = anchorSum / max(entityCount, 1);

        opFillet(context, id + "fillet", {
                "entities" : matchedEntities,
                "radius" : definition.radius,
                "tangentPropagation" : true
        });

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        const tangentDir = anchorTangent;
        const perpReference = (abs(tangentDir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
        const radiusDir = normalize(cross(tangentDir, perpReference));
        const dimensionColor = color(0, 0, 0, 0.85);

        // A precise filled arrow + exact mm label would be fake precision
        // while "radius" is still just a placeholder -- see
        // needsInputMove.fs's drawFuzzyDirectionGesture for the rationale.
        if (definition.radiusNeedsInput)
        {
            drawFuzzyDirectionGesture(
                    context,
                    id + "radiusGesture",
                    midpoint,
                    radiusDir,
                    8 * millimeter,
                    "R: ?",
                    dimensionColor
            );
        }
        else
        {
            drawDimensionArrow(
                    context,
                    id + "radiusArrow",
                    midpoint,
                    radiusDir * definition.radius,
                    "R: " ~ toString(round(definition.radius / millimeter, 1)) ~ " mm",
                    dimensionColor
            );
        }

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });

        // Drag handle for radius, anchored at the edge midpoint along
        // the same direction the dimension arrow/gesture already uses.
        addManipulators(context, id, {
                "radiusManipulator" : linearManipulator({
                        "base" : midpoint,
                        "direction" : radiusDir,
                        "offset" : definition.radius,
                        "primaryParameterId" : "radius"
                })
        });
    });

// Manipulator Change Function referenced by the annotation above.
export function fuzzycadNeedsInputFilletManipulatorChange(context is Context, definition is map, newManipulators is map) returns map
{
    if (newManipulators["radiusManipulator"] != undefined)
    {
        definition.radius = newManipulators["radiusManipulator"].offset;
    }

    return definition;
}

//////////////////////////////////////////////////////////////////////
//
// FILLED DIMENSION ARROW (copied verbatim from proposedFillet.fs)
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
