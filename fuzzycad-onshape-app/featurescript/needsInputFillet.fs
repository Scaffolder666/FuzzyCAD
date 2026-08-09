FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

// FuzzyCAD Needs Input Fillet
//
// Geometry path intentionally matches the current working Proposed Fillet:
//   selected edge/face -> qOwnerBody -> startTracking -> zero-offset opPattern
//   -> qPatternInstances -> tracked copied selection -> opFillet.
//
// There is NO separate Body selector and NO qClosestTo remapping.
// This keeps the fillet logic aligned with the version that was already working.
//
// Visual distinction:
//   Proposed   = coherent blue sketch + exact R callout
//   NeedsInput = sparse/partial/random black sketch + clean R=? callout

annotation {
    "Feature Type Name" : "FuzzyCAD Needs Input Fillet",
    "Manipulator Change Function" : "fuzzycadNeedsInputFilletManipulatorChange"
}
export const fuzzycadNeedsInputFillet = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation {
            "Name" : "Edges or faces to fillet",
            "Filter" : (EntityType.EDGE || EntityType.FACE) && BodyType.SOLID
        }
        definition.edge is Query;

        annotation { "Name" : "Radius" }
        isLength(definition.radius, BLEND_BOUNDS);

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
        if (isQueryEmpty(context, definition.edge))
        {
            return;
        }

        // Automatically derive the owning body/bodies -- no separate
        // body selector needed.
        const originalBodies = qOwnerBody(definition.edge);

        // ACCEPTED STATE: fillet the real edges/face on the real body
        // directly, no duplicate/preview machinery at all, then stop.
        if (definition.accepted)
        {
            opFillet(context, id + "acceptedFillet", {
                    "entities" : definition.edge,
                    "radius" : definition.radius,
                    "tangentPropagation" : true,
                    "crossSection" : FilletCrossSection.CIRCULAR
            });

            return;
        }

        // PENDING STATE below.

        // Track the selected topology BEFORE duplication, instead of
        // the old midpoint + qClosestTo correspondence trick.
        const trackedSelection = startTracking(context, definition.edge);

        opPattern(context, id + "duplicate", {
                "entities" : originalBodies,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qPatternInstances(id + "duplicate", "proposed", EntityType.BODY);
        const copiedSelection = qOwnedByBody(trackedSelection, proposedBody);

        // If topology tracking gives us nothing, report the actual
        // problematic selection instead of letting opFillet fail later
        // with an opaque FILLET_FAILED.
        if (isQueryEmpty(context, copiedSelection))
        {
            throw regenError(
                    "Could not track the selected fillet geometry onto the proposal copy.",
                    definition.edge
            );
        }

        opFillet(context, id + "previewFillet", {
                "entities" : copiedSelection,
                "radius" : definition.radius,
                "tangentPropagation" : true,
                "crossSection" : FilletCrossSection.CIRCULAR
        });

        // Fade the original -- no-ops silently if "originalBodies"
        // already carries a manual appearance override from the right
        // panel's REST mechanism.
        setProperty(context, {
                "entities" : originalBodies,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        // Whole-body hand-drawn fill -- the entire candidate object
        // reads as provisional, not just the fillet surface.
        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        // Keep a very faint complete boundary underneath the sparse random
        // Needs Input strokes. The outline is intentionally much lighter
        // than both the sketch strokes and the red radius callout.
        drawVeryLightGhostOutline(context, id + "ghostOutline", proposedBody);

        // Find one representative original edge, only used to position
        // the radius dimension arrow -- has nothing to do with which
        // geometry is filleted.
        const selectedEdges = qEntityFilter(definition.edge, EntityType.EDGE);
        const selectedFaces = qEntityFilter(definition.edge, EntityType.FACE);

        var anchorEdge = qNothing();

        if (!isQueryEmpty(context, selectedEdges))
        {
            anchorEdge = qNthElement(selectedEdges, 0);
        }
        else if (!isQueryEmpty(context, selectedFaces))
        {
            const faceBoundaryEdges = qLoopEdges(selectedFaces);

            if (!isQueryEmpty(context, faceBoundaryEdges))
            {
                anchorEdge = qNthElement(faceBoundaryEdges, 0);
            }
        }

        if (!isQueryEmpty(context, anchorEdge))
        {
            const tangentLine = evEdgeTangentLine(context, {
                    "edge" : anchorEdge,
                    "parameter" : 0.5
            });
            const midpoint = tangentLine.origin;
            const tangentDir = tangentLine.direction;

            const perpReference = (abs(tangentDir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
            const radiusDir = normalize(cross(tangentDir, perpReference));
            const dimensionColor = color(0.88, 0.16, 0.12, 1.0);

            // Clean engineering annotation in BOTH Proposed and Needs Input.
            // Needs Input differs in geometry completeness, not by making the arrow random.
            if (definition.radiusNeedsInput)
            {
                const calloutLength = max(definition.radius, 18 * millimeter);

                drawDimensionArrow(
                        context,
                        id + "radiusArrow",
                        midpoint,
                        radiusDir * calloutLength,
                        "R = ?",
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
                        "R = " ~ toString(round(definition.radius / millimeter, 1)) ~ " mm",
                        dimensionColor
                );
            }

            addManipulators(context, id, {
                    "radiusManipulator" : linearManipulator({
                            "base" : midpoint,
                            "direction" : radiusDir,
                            "offset" : definition.radius,
                            "primaryParameterId" : "radius"
                    })
            });
        }

        // Remove the temporary filleted duplicate now that its faces
        // have been sampled into the sketchy fill -- this is what
        // removes the solid black CAD edges that setProperty alone can
        // never hide.
        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

//////////////////////////////////////////////////////////////////////
//
// FILLED DIMENSION ARROW (copied verbatim from needsInputFillet.fs's
// precise-radius arrow)
//
//////////////////////////////////////////////////////////////////////


export function fuzzycadNeedsInputFilletManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map)
returns map
{
    if (newManipulators["radiusManipulator"] != undefined)
    {
        definition.radius = newManipulators["radiusManipulator"].offset;
    }

    return definition;
}

//////////////////////////////////////////////////////////////////////
// ENGINEERING RADIUS ANNOTATION
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
// WHOLE-BODY HAND-DRAWN FACE FILL (same structure as
// needsInputFillet.fs's drawSketchyFaceFill, same reduced line density
// -- 31-35 primary / 5-7 secondary -- but using FuzzyCAD's blue
// Proposed palette instead of Needs Input's black, so the two states
// stay visually distinct)
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