FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

annotation {
    "Feature Type Name" : "FuzzyCAD Needs Input Move",
    "Manipulator Change Function" : "fuzzycadNeedsInputMoveManipulatorChange"
}
export const fuzzycadNeedsInputMove = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to move", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Move X" }
        isLength(definition.moveX, LENGTH_BOUNDS);
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

        if (definition.accepted)
        {
            opTransform(context, id + "acceptedMove", {
                    "bodies" : originalBody,
                    "transform" : transform(offset)
            });
            return;
        }

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(offset)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        // NEEDS INPUT visual language: the same coherent, full-coverage
        // hand-drawn outline Proposed uses, just recolored black -- the old
        // sparse/incomplete look is retired. Uncertainty is now signaled by
        // the grey-faded original + red callout + warning icon instead of
        // by the candidate geometry itself looking unfinished.
        drawSketchyFaceFill(context, id + "faceFill", proposedBody);

        // Makes the mark impossible to miss at a glance.
        drawWarningIcon(context, id + "warningIcon", proposedBody);

        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const startPoint = vector(
            (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
            (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
            (bbox.minCorner[2] + bbox.maxCorner[2]) / 2
        );
        const endPoint = startPoint + offset;

        // Annotation stays clean and engineering-like.
        // If any component is still open, the label is explicitly changed
        // to "?" below by drawNeedsInputMoveArrowLabel.
        if (norm(offset) / millimeter > 0.001)
        {
            drawBigMoveArrow(
                context,
                id + "moveArrow",
                startPoint,
                endPoint,
                definition.moveX,
                definition.moveY,
                definition.moveZ,
                definition.moveXNeedsInput || definition.moveYNeedsInput || definition.moveZNeedsInput
            );
        }
        else
        {
            // No displacement placeholder yet: show a clean three-axis
            // engineering direction triad instead of inventing a destination.
            drawOpenMoveTriad(
                context,
                id + "openMoveTriad",
                startPoint,
                min(max(norm(bbox.maxCorner - bbox.minCorner) * 0.25, 12 * millimeter), 35 * millimeter)
            );
        }

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });

        addManipulators(context, id, {
                "moveXManipulator" : linearManipulator({
                        "base" : startPoint,
                        "direction" : vector(1, 0, 0),
                        "offset" : definition.moveX,
                        "primaryParameterId" : "moveX"
                }),
                "moveYManipulator" : linearManipulator({
                        "base" : startPoint,
                        "direction" : vector(0, 1, 0),
                        "offset" : definition.moveY,
                        "primaryParameterId" : "moveY"
                }),
                "moveZManipulator" : linearManipulator({
                        "base" : startPoint,
                        "direction" : vector(0, 0, 1),
                        "offset" : definition.moveZ,
                        "primaryParameterId" : "moveZ"
                })
        });
    });

export function fuzzycadNeedsInputMoveManipulatorChange(
    context is Context,
    definition is map,
    newManipulators is map) returns map
{
    if (newManipulators["moveXManipulator"] != undefined)
        definition.moveX = newManipulators["moveXManipulator"].offset;

    if (newManipulators["moveYManipulator"] != undefined)
        definition.moveY = newManipulators["moveYManipulator"].offset;

    if (newManipulators["moveZManipulator"] != undefined)
        definition.moveZ = newManipulators["moveZManipulator"].offset;

    return definition;
}

function drawOpenMoveTriad(
    context is Context,
    id is Id,
    origin is Vector,
    length is ValueWithUnits)
{
    const arrowColor = color(0.88, 0.16, 0.12, 1.0);
    const dirs = [vector(1,0,0), vector(0,1,0), vector(0,0,1)];
    const names = ["X?", "Y?", "Z?"];
    var allBodies = qNothing();

    for (var i = 0; i < 3; i += 1)
    {
        const end = origin + dirs[i] * length;
        const ref = (i == 2) ? vector(0,1,0) : vector(0,0,1);
        const side = normalize(cross(dirs[i], ref));
        const headLength = min(length * 0.25, 8 * millimeter);
        const headWidth = min(length * 0.13, 5 * millimeter);
        const base = end - dirs[i] * headLength;

        const shaftId = id + ("shaft" ~ toString(i));
        const wingAId = id + ("wingA" ~ toString(i));
        const wingBId = id + ("wingB" ~ toString(i));

        opFitSpline(context, shaftId, { "points" : [origin, end] });
        opFitSpline(context, wingAId, { "points" : [end, base + side * headWidth] });
        opFitSpline(context, wingBId, { "points" : [end, base - side * headWidth] });

        allBodies = qUnion(allBodies, qCreatedBy(shaftId, EntityType.BODY));
        allBodies = qUnion(allBodies, qCreatedBy(wingAId, EntityType.BODY));
        allBodies = qUnion(allBodies, qCreatedBy(wingBId, EntityType.BODY));

        const labelPoint = end + dirs[i] * (3 * millimeter);
        const labelPlane = plane(labelPoint, dirs[i]);
        const uv = worldToPlane(labelPlane, labelPoint);
        const sketch = newSketchOnPlane(context, id + ("label" ~ toString(i)), { "sketchPlane" : labelPlane });
        const t = 3 * millimeter;
        skText(sketch, "txt", {
                "text" : names[i],
                "fontName" : "OpenSans-Regular.ttf",
                "firstCorner" : vector(uv[0] - t, uv[1] - t),
                "secondCorner" : vector(uv[0] + t, uv[1] + t)
        });
        skSolve(sketch);
    }

    if (!isQueryEmpty(context, allBodies))
    {
        opCreateCompositePart(context, id + "composite", {
                "bodies" : allBodies,
                "closed" : false
        });
        setProperty(context, {
                "entities" : qCreatedBy(id + "composite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : arrowColor
        });
    }
}

function drawBigMoveArrow(
    context is Context,
    id is Id,
    startPoint is Vector,
    endPoint is Vector,
    moveX is ValueWithUnits,
    moveY is ValueWithUnits,
    moveZ is ValueWithUnits,
    isOpen is boolean)
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
    const markerColor = color(0.15, 0.15, 0.15, 0.82);

    // A small 3D shaft cage means the direction line still reads when
    // one of its planes turns edge-on to the camera.
    const shaftSpread = min(max(distance * 0.025, 0.8 * millimeter), 2.5 * millimeter);
    const headLength = min(max(distance * 0.22, 7 * millimeter), 18 * millimeter);
    const headWidth = min(max(distance * 0.11, 4 * millimeter), 9 * millimeter);
    const markerSize = min(max(distance * 0.07, 3 * millimeter), 7 * millimeter);

    var arrowBodies = qNothing();

    // Main shaft + four parallel shafts around it. These are engineering
    // lines, intentionally straight and deterministic, not sketchy.
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
        opFitSpline(context, shaftId, {
                "points" : [startPoint + shaftOffsets[s], endPoint + shaftOffsets[s]]
        });
        arrowBodies = qUnion(arrowBodies, qCreatedBy(shaftId, EntityType.BODY));
    }

    // 8-wing wire-cone arrowhead. Because the head exists around the
    // full 3D cross-section, at least several wings remain readable from
    // almost any camera direction.
    const headBase = endPoint - direction * headLength;
    const diag1 = normalize(side + side2);
    const diag2 = normalize(side - side2);
    const headDirs = [side, -side, side2, -side2, diag1, -diag1, diag2, -diag2];

    for (var h = 0; h < 8; h += 1)
    {
        const wingId = id + ("headWing" ~ toString(h));
        const wingPt = headBase + headDirs[h] * headWidth;
        opFitSpline(context, wingId, { "points" : [endPoint, wingPt] });
        arrowBodies = qUnion(arrowBodies, qCreatedBy(wingId, EntityType.BODY));
    }

    if (!isQueryEmpty(context, arrowBodies))
    {
        opCreateCompositePart(context, id + "arrowComposite", {
                "bodies" : arrowBodies,
                "closed" : false
        });
        setProperty(context, {
                "entities" : qCreatedBy(id + "arrowComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : arrowColor
        });
    }

    // Engineering start marker: 3D cross at the original position.
    var startMarkerBodies = qNothing();
    const startMarkerEnds = [
        startPoint + side * markerSize, startPoint - side * markerSize,
        startPoint + side2 * markerSize, startPoint - side2 * markerSize,
        startPoint + direction * markerSize * 0.45, startPoint - direction * markerSize * 0.45
    ];
    opFitSpline(context, id + "startCross1", { "points" : [startMarkerEnds[0], startMarkerEnds[1]] });
    opFitSpline(context, id + "startCross2", { "points" : [startMarkerEnds[2], startMarkerEnds[3]] });
    opFitSpline(context, id + "startCross3", { "points" : [startMarkerEnds[4], startMarkerEnds[5]] });
    startMarkerBodies = qUnion(startMarkerBodies, qCreatedBy(id + "startCross1", EntityType.BODY));
    startMarkerBodies = qUnion(startMarkerBodies, qCreatedBy(id + "startCross2", EntityType.BODY));
    startMarkerBodies = qUnion(startMarkerBodies, qCreatedBy(id + "startCross3", EntityType.BODY));

    // Engineering target marker: a diamond in the plane normal to travel,
    // plus a cross through the target point.
    const d1 = endPoint + side * markerSize;
    const d2 = endPoint + side2 * markerSize;
    const d3 = endPoint - side * markerSize;
    const d4 = endPoint - side2 * markerSize;
    opFitSpline(context, id + "targetD1", { "points" : [d1, d2] });
    opFitSpline(context, id + "targetD2", { "points" : [d2, d3] });
    opFitSpline(context, id + "targetD3", { "points" : [d3, d4] });
    opFitSpline(context, id + "targetD4", { "points" : [d4, d1] });
    opFitSpline(context, id + "targetCross1", { "points" : [d1, d3] });
    opFitSpline(context, id + "targetCross2", { "points" : [d2, d4] });

    var markerBodies = startMarkerBodies;
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetD1", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetD2", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetD3", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetD4", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetCross1", EntityType.BODY));
    markerBodies = qUnion(markerBodies, qCreatedBy(id + "targetCross2", EntityType.BODY));

    opCreateCompositePart(context, id + "markerComposite", {
            "bodies" : markerBodies,
            "closed" : false
    });
    setProperty(context, {
            "entities" : qCreatedBy(id + "markerComposite", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : markerColor
    });

    // Main motion label and component breakdown. The red arrow carries the
    // action; the black annotation carries measured engineering detail.
    const midPoint = startPoint + offset * 0.5 + side2 * min(distance * 0.11, 9 * millimeter);
    const labelPlane = plane(midPoint + side * (0.02 * millimeter), side);
    const labelUv = worldToPlane(labelPlane, midPoint);
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : labelPlane });
    const textSize = 4.2 * millimeter;
    skText(labelSketch, "label", {
            "text" : isOpen
                ? "MOVE  Δ = ?"
                : "MOVE  Δ = " ~ toString(round(distance / millimeter, 1)) ~ " mm",
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - 2.5 * textSize, labelUv[1] - textSize),
            "secondCorner" : vector(labelUv[0] + 2.5 * textSize, labelUv[1] + textSize)
    });
    skSolve(labelSketch);

    const detailPoint = midPoint - side2 * (7 * millimeter);
    const detailPlane = plane(detailPoint + side * (0.02 * millimeter), side);
    const detailUv = worldToPlane(detailPlane, detailPoint);
    const detailSketch = newSketchOnPlane(context, id + "detailSketch", { "sketchPlane" : detailPlane });
    const detailSize = 2.8 * millimeter;
    skText(detailSketch, "detail", {
            "text" : isOpen
                ? "ΔX/ΔY/ΔZ  OPEN"
                : "ΔX " ~ toString(round(moveX / millimeter, 1)) ~ "   ΔY " ~ toString(round(moveY / millimeter, 1)) ~ "   ΔZ " ~ toString(round(moveZ / millimeter, 1)),
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(detailUv[0] - 3.0 * detailSize, detailUv[1] - detailSize),
            "secondCorner" : vector(detailUv[0] + 3.0 * detailSize, detailUv[1] + detailSize)
    });
    skSolve(detailSketch);
}


//////////////////////////////////////////////////////////////////////
//
// COHERENT BLACK OUTLINE (same structure as Proposed's own
// drawProposedSketch/handDrawProposedEdge -- full-coverage, low-jitter,
// 2 passes per edge -- just recolored black instead of blue. Needs
// Input no longer looks visually "unfinished"; the mark itself is
// signaled by the grey-faded original + red engineering callout +
// warning icon instead of by sparse/incomplete candidate geometry.
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

    // Coherent: always 2 passes, low jitter, full coverage.
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
// miss at a glance, on top of (not instead of) the grey-fade + red
// engineering callout the feature already draws.
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

function RandomNumberFunctionWithSalt(
    id,
    salt)
returns function
{
    const baseSeed =
        idToNum(
            id[0]
        );


    const saltSeed =
        idToNum(
            salt
        );


    return lcprng(
        (
            baseSeed
            +
            saltSeed
            *
            97
        )
        %
        100000
    );
}


function idToNum(
    input is string)
returns number
{
    const chrMap =
    {
        'A' : 0,
        'B' : 1,
        'C' : 2,
        'D' : 3,
        'E' : 4,
        'F' : 5,
        'G' : 6,
        'H' : 7,
        'I' : 8,
        'J' : 9,
        'K' : 10,
        'L' : 11,
        'M' : 12,
        'N' : 13,
        'O' : 14,
        'P' : 15,
        'Q' : 16,
        'R' : 17,
        'S' : 18,
        'T' : 19,
        'U' : 20,
        'V' : 21,
        'W' : 22,
        'X' : 23,
        'Y' : 24,
        'Z' : 25,

        'a' : 26,
        'b' : 27,
        'c' : 28,
        'd' : 29,
        'e' : 30,
        'f' : 31,
        'g' : 32,
        'h' : 33,
        'i' : 34,
        'j' : 35,
        'k' : 36,
        'l' : 37,
        'm' : 38,
        'n' : 39,
        'o' : 40,
        'p' : 41,
        'q' : 42,
        'r' : 43,
        's' : 44,
        't' : 45,
        'u' : 46,
        'v' : 47,
        'w' : 48,
        'x' : 49,
        'y' : 50,
        'z' : 51,

        '_' : 99,
        '-' : 98
    };


    var out is string =
        "";


    for (
        var char
        in splitIntoCharacters(
            input
        )
    )
    {
        var res =
            match(
                char,
                REGEX_NUMBER
            );


        if (
            res.hasMatch
        )
        {
            out =
                out
                ~
                toString(
                    res.captures[0]
                );
        }
        else
        {
            out =
                out
                ~
                toString(
                    chrMap[
                        char
                    ]
                );
        }
    }


    return stringToNumber(
        out
    )
    %
    100000;
}


function lcprng(
    seed is number)
returns function
{
    const a =
        1103515245;


    const c =
        12345;


    const m =
        2^31;


    var state =
        new box(
            seed
        );


    return function()
    {
        state[] =
            (
                a
                *
                state[]
                +
                c
            )
            %
            m;


        return state[];
    };
}