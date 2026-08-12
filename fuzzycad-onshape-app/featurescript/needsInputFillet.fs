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

        // The new rounded surface opFillet just created -- its boundary
        // edges get a bold orange outline below instead of blending
        // into the rest of the body's faint grey ghost outline.
        const filletFaces = qCreatedBy(id + "previewFillet", EntityType.FACE);
        const filletBoundaryEdges = qLoopEdges(filletFaces);

        // NEEDS INPUT visual language: the same coherent, full-coverage
        // hand-drawn outline Proposed uses, just recolored black -- the old
        // sparse/incomplete look is retired. Uncertainty is now signaled by
        // the grey-faded original + red radius callout + warning icon
        // instead of by the candidate geometry itself looking unfinished.
        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        // Makes the mark impossible to miss at a glance.
        drawWarningIcon(context, id + "warningIcon", proposedBody);

        // Keep a very faint complete boundary underneath the sparse random
        // Needs Input strokes. The outline is intentionally much lighter
        // than both the sketch strokes and the red radius callout.
        drawVeryLightGhostOutline(context, id + "ghostOutline", proposedBody);

        // Recolor just the fillet's own edges within that same base
        // outline, laid directly over the faint grey line at those
        // edges so the ghost outline itself reads orange there too, not
        // just the separate bold highlight below.
        drawThinEdgeOutline(
                context,
                id + "ghostOutlineFilletTint",
                filletBoundaryEdges,
                color(0.90, 0.45, 0.05, 0.6)
        );

        // Bold orange outline specifically on the fillet's own edges --
        // reads clearly as "this is what's being filleted" without
        // relying on jittery colored fill.
        drawBoldEdgeOutline(
                context,
                id + "filletEdgeHighlight",
                filletBoundaryEdges,
                color(0.90, 0.45, 0.05, 1.0)
        );

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
// DOTTED EDGE REFERENCE LINE
//
// Clean (no jitter, no randomness) bold outline traced directly over
// the given edges -- a single opFitSpline body reads as a thin hairline
// regardless of color, so "bold" is faked the same way
// drawDimensionArrow fakes a thick shaft: several parallel strands
// offset a tiny amount from the true edge, in the two directions
// perpendicular to it.
//
//////////////////////////////////////////////////////////////////////

function drawBoldEdgeOutline(
    context is Context,
    id is Id,
    edgeQuery is Query,
    outlineColor is map)
{
    const sampleSpacing = 2 * millimeter;
    const strandSpread = 0.35 * millimeter;

    // Refresh the perpendicular offset basis every this many sample
    // points instead of once per whole edge or once per point --
    // enough segments to loosely track a curved edge's overall
    // direction trend, without recomputing (and risking a twist) at
    // every single point on a nearly-straight edge.
    const basisRefreshPoints = 8;

    const edges = evaluateQuery(context, edgeQuery);
    var outlineBodies = qNothing();

    for (var edgeIndex = 0; edgeIndex < size(edges); edgeIndex += 1)
    {
        const edgeQ = edges[edgeIndex];
        const edgeLength = evLength(context, { "entities" : edgeQ });
        const pointCount = ceil(max(edgeLength / sampleSpacing, 5));

        const tangents = @evEdgeTangentLines(
            context,
            {
                "edge" : edgeQ,
                "parameters" : range(0.0, 0.995, pointCount)
            }
        );

        const segmentCount = ceil(pointCount / basisRefreshPoints);

        for (var seg = 0; seg < segmentCount; seg += 1)
        {
            const segStart = seg * basisRefreshPoints;

            // One point of overlap with the next segment so consecutive
            // segments share an endpoint and the strands don't visibly
            // gap where the basis refreshes.
            const segEnd = min(segStart + basisRefreshPoints + 1, pointCount);
            const segPointCount = segEnd - segStart;

            if (segPointCount >= 2)
            {
                // Perpendicular basis from this segment's own first
                // tangent -- reused for every point in the segment, then
                // refreshed at the next segment, so the offset direction
                // follows the edge's overall curvature in a few steps
                // rather than either staying fixed for the whole edge or
                // recomputing (and risking a twist) at every point.
                const segTangentDir = normalize(tangents[segStart].direction as Vector);
                const ref = (abs(segTangentDir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
                const side = normalize(cross(segTangentDir, ref));
                const side2 = normalize(cross(segTangentDir, side));

                const strandOffsets = [
                    vector(0, 0, 0) * meter,
                    side * strandSpread,
                    -side * strandSpread,
                    side2 * strandSpread,
                    -side2 * strandSpread
                ];

                for (var s = 0; s < 5; s += 1)
                {
                    var points = makeArray(segPointCount, undefined);

                    for (var p = 0; p < segPointCount; p += 1)
                    {
                        points[p] = (tangents[segStart + p].origin as Vector) + strandOffsets[s];
                    }

                    const strandId = id + ("edge" ~ toString(edgeIndex) ~ "seg" ~ toString(seg) ~ "strand" ~ toString(s));
                    opFitSpline(context, strandId, { "points" : points });

                    outlineBodies = qUnion(outlineBodies, qCreatedBy(strandId, EntityType.BODY));
                }
            }
        }
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

        setProperty(
            context,
            {
                "entities" : qCreatedBy(id + "outlineComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : outlineColor
            }
        );
    }
}

//////////////////////////////////////////////////////////////////////
//
// COHERENT BLACK OUTLINE (same structure as Proposed's own
// drawProposedSketch/handDrawProposedEdge -- full-coverage, low-jitter,
// 2 passes per edge -- just recolored black instead of blue. Needs
// Input no longer looks visually "unfinished"; the mark itself is
// signaled by the grey-faded original + red radius callout + warning
// icon instead of by sparse/incomplete candidate geometry. The
// fillet's own new surface still gets its separate bold/thin orange
// outline treatment below, on top of this.
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

//////////////////////////////////////////////////////////////////////
//
// THIN EDGE OUTLINE (same single-strand, no-jitter sampling as
// drawVeryLightGhostOutline above, but takes an edge Query directly
// instead of deriving edges from a body -- lets a specific subset of
// edges, e.g. the fillet's own boundary, get their own color laid
// directly over the whole-body ghost outline instead of every edge
// sharing one color)
//
//////////////////////////////////////////////////////////////////////

function drawThinEdgeOutline(
    context is Context,
    id is Id,
    edgeQuery is Query,
    outlineColor is map)
{
    const sampleSpacing = 5 * millimeter;

    const edges = evaluateQuery(context, edgeQuery);
    var outlineBodies = qNothing();

    for (var edgeIndex = 0; edgeIndex < size(edges); edgeIndex += 1)
    {
        const edgeQ = edges[edgeIndex];
        const edgeLength = evLength(context, { "entities" : edgeQ });
        const pointCount = ceil(max(edgeLength / sampleSpacing, 5));

        const tangents = @evEdgeTangentLines(
            context,
            {
                "edge" : edgeQ,
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

        outlineBodies = qUnion(outlineBodies, qCreatedBy(outlineId, EntityType.BODY));
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

        setProperty(
            context,
            {
                "entities" : qCreatedBy(id + "outlineComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : outlineColor
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
