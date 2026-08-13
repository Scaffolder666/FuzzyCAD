FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Move" }
export const fuzzycadProposedMove = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to move", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Move X" }
        isLength(definition.moveX, LENGTH_BOUNDS);

        annotation { "Name" : "Move Y" }
        isLength(definition.moveY, LENGTH_BOUNDS);

        annotation { "Name" : "Move Z" }
        isLength(definition.moveZ, LENGTH_BOUNDS);

        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        if (isQueryEmpty(context, definition.body))
        {
            return;
        }

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
        const proposedEdges = evaluateQuery(context, qCreatedBy(id + "duplicate", EntityType.EDGE));

        const outlineColor = color(0.25, 0.55, 0.95, 1.0);
        const chordLength = 3 * millimeter;
        const variance = 0.45 * millimeter;
        var rnd = RandomNumberFunction(id);
        var allSketchyStrokes = qNothing();

        for (var e = 0; e < size(proposedEdges); e += 1)
        {
            const strokes = handDrawEdgeSketchy(
                    context,
                    id + ("sketchyEdge" ~ toString(e)),
                    chordLength,
                    variance,
                    rnd,
                    proposedEdges[e]
            );
            allSketchyStrokes = qUnion(allSketchyStrokes, strokes);
        }

        if (!isQueryEmpty(context, allSketchyStrokes))
        {
            opCreateCompositePart(context, id + "sketchyComposite", {
                    "bodies" : allSketchyStrokes,
                    "closed" : false
            });

            setProperty(context, {
                    "entities" : qCreatedBy(id + "sketchyComposite", EntityType.BODY),
                    "propertyType" : PropertyType.APPEARANCE,
                    "value" : outlineColor
            });
        }

        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const startPoint = vector(
            (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
            (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
            (bbox.minCorner[2] + bbox.maxCorner[2]) / 2
        );
        const endPoint = startPoint + offset;

        drawBigMoveArrow(context, id + "moveArrow", startPoint, endPoint, definition.moveX, definition.moveY, definition.moveZ);

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

function drawBigMoveArrow(
    context is Context,
    id is Id,
    startPoint is Vector,
    endPoint is Vector,
    moveX is ValueWithUnits,
    moveY is ValueWithUnits,
    moveZ is ValueWithUnits)
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
    const textSize = 5.0 * millimeter;
    skText(labelSketch, "label", {
            "text" : "MOVE  Δ = " ~ toString(round(distance / millimeter, 1)) ~ " mm",
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - 2.5 * textSize, labelUv[1] - textSize),
            "secondCorner" : vector(labelUv[0] + 2.5 * textSize, labelUv[1] + textSize)
    });
    skSolve(labelSketch);

    opExtractSurface(context, id + "labelSurface", {
            "faces" : qSketchRegion(id + "labelSketch"),
            "offset" : 0 * meter,
            "useFacesAroundToTrimOffset" : false
    });
    opDeleteBodies(context, id + "deleteLabelSketch", {
            "entities" : qCreatedBy(id + "labelSketch")
    });
    setProperty(context, {
            "entities" : qCreatedBy(id + "labelSurface", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : color(0, 0, 0, 1.0)
    });

    const detailPoint = midPoint - side2 * (7 * millimeter);
    const detailPlane = plane(detailPoint + side * (0.02 * millimeter), side);
    const detailUv = worldToPlane(detailPlane, detailPoint);
    const detailSketch = newSketchOnPlane(context, id + "detailSketch", { "sketchPlane" : detailPlane });
    const detailSize = 2.8 * millimeter;
    skText(detailSketch, "detail", {
            "text" : "ΔX " ~ toString(round(moveX / millimeter, 1)) ~ "   ΔY " ~ toString(round(moveY / millimeter, 1)) ~ "   ΔZ " ~ toString(round(moveZ / millimeter, 1)),
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(detailUv[0] - 3.0 * detailSize, detailUv[1] - detailSize),
            "secondCorner" : vector(detailUv[0] + 3.0 * detailSize, detailUv[1] + detailSize)
    });
    skSolve(detailSketch);

    opExtractSurface(context, id + "detailSurface", {
            "faces" : qSketchRegion(id + "detailSketch"),
            "offset" : 0 * meter,
            "useFacesAroundToTrimOffset" : false
    });
    opDeleteBodies(context, id + "deleteDetailSketch", {
            "entities" : qCreatedBy(id + "detailSketch")
    });
    setProperty(context, {
            "entities" : qCreatedBy(id + "detailSurface", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : color(0, 0, 0, 1.0)
    });
}

function handDrawEdgeSketchy(
    context is Context,
    id is Id,
    chordLength is ValueWithUnits,
    variance is ValueWithUnits,
    rnd is function,
    edgeQuery is Query)
{
    var edgeLength = evLength(context, { "entities" : edgeQuery });
    var pointCount = ceil(max(edgeLength / chordLength, 5));

    // Jitter capped to a fraction of the edge's OWN length -- a short
    // edge on a small/complex area otherwise gets the same absolute
    // wobble as a long edge on a flat face, which can push a stroke
    // past the actual silhouette of the geometry.
    var maxJitter = min(variance, edgeLength * 0.05);

    var tangents = @evEdgeTangentLines(context, {
            "edge" : edgeQuery,
            "parameters" : range(0.0, 1.0, pointCount)
    });

    var rawRandom = rnd() % 100;
    var numStrokes = 2 + floor(rawRandom / 33);
    var strokesQuery = qNothing();

    for (var strokeIndex = 0; strokeIndex < numStrokes; strokeIndex += 1)
    {
        var newPoints = makeArray(pointCount, undefined);
        for (var i = 0; i < pointCount; i += 1)
        {
            var basePt = tangents[i].origin as Vector;
            var tangentDir = normalize(tangents[i].direction as Vector);

            // Jitter only WITHIN the plane perpendicular to the edge's
            // own tangent, never along it -- along-tangent jitter can
            // push a point past its neighbor on a tightly curved edge,
            // making the fitted spline double back on itself.
            var ref = (abs(tangentDir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
            var perp1 = normalize(cross(tangentDir, ref));
            var perp2 = cross(tangentDir, perp1);

            var s1 = rnd();
            var s2 = rnd();
            var jitterFactor = 0.5 + ((s2 % 100) / 100.0) * 0.5;
            var amount = maxJitter * jitterFactor;
            var offset1 = 2 * ((((s1 + i * 17 + strokeIndex * 29) % 100) / 100.0) - 0.5) * amount;
            var offset2 = 2 * ((((s1 + i * 23 + strokeIndex * 37) % 100) / 100.0) - 0.5) * amount;
            var perturbed = basePt + perp1 * offset1 + perp2 * offset2;
            newPoints[i] = perturbed;
        }
        const strokeId = id + ("_stroke" ~ toString(strokeIndex));
        opFitSpline(context, strokeId, { "points" : newPoints });
        strokesQuery = qUnion(strokesQuery, qCreatedBy(strokeId, EntityType.BODY));
    }
    return strokesQuery;
}

function RandomNumberFunction(id) returns function
{
    return lcprng(idToNum(id[0]));
}

function idToNum(input is string) returns number
{
    const chrMap = {
            'A' : 0, 'B' : 1, 'C' : 2, 'D' : 3, 'E' : 4, 'F' : 5, 'G' : 6,
            'H' : 7, 'I' : 8, 'J' : 9, 'K' : 10, 'L' : 11, 'M' : 12, 'N' : 13,
            'O' : 14, 'P' : 15, 'Q' : 16, 'R' : 17, 'S' : 18, 'T' : 19, 'U' : 20,
            'V' : 21, 'W' : 22, 'X' : 23, 'Y' : 24, 'Z' : 25,
            'a' : 26, 'b' : 27, 'c' : 28, 'd' : 29, 'e' : 30, 'f' : 31, 'g' : 32,
            'h' : 33, 'i' : 34, 'j' : 35, 'k' : 36, 'l' : 37, 'm' : 38, 'n' : 39,
            'o' : 40, 'p' : 41, 'q' : 42, 'r' : 43, 's' : 44, 't' : 45, 'u' : 46,
            'v' : 47, 'w' : 48, 'x' : 49, 'y' : 50, 'z' : 51,
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

function lcprng(seed is number) returns function
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
