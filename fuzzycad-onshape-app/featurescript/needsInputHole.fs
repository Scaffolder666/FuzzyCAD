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

        // NEEDS INPUT visual language: the same coherent, full-coverage
        // hand-drawn outline Proposed uses, just recolored black -- the old
        // sparse/incomplete look is retired. Uncertainty is now signaled by
        // the grey-faded original + red depth callout + warning icon
        // instead of by the candidate geometry itself looking unfinished.
        drawNeedsInputSketch(context, id + "needsSketch", proposedBody);

        // Makes the mark impossible to miss at a glance.
        drawWarningIcon(context, id + "warningIcon", proposedBody);

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
//
// COHERENT BLACK OUTLINE (same structure as Proposed's own
// drawProposedSketch/handDrawProposedEdge -- full-coverage, low-jitter,
// 2 passes per edge -- just recolored black instead of blue. Needs
// Input no longer looks visually "unfinished"; the mark itself is
// signaled by the red depth callout + warning icon instead of by
// sparse/incomplete candidate geometry.
//
//////////////////////////////////////////////////////////////////////

function drawNeedsInputSketch(
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

