// FuzzyCAD "Proposed Rotate" custom feature -- DRAFT, not yet compiled.
// Reuses the confirmed opPattern-duplicate + setProperty-style pieces
// from proposedFillet.fs/proposedMove.fs, but needs genuinely NEW,
// UNCONFIRMED FeatureScript to build a rotation Transform:
//
//   1. The rotation axis is picked as an EDGE (definition.axis). Its
//      origin point at two different parameters (0.0 and 1.0) is read
//      via evEdgeTangentLine -- reusing ONLY the ".origin" field, which
//      IS confirmed working (used throughout proposedFillet.fs). The
//      axis direction is then computed as the difference between those
//      two points, normalized -- ordinary vector math, not a new guess.
//   2. line(origin, direction) -- guessed constructor for a Line value.
//      Not confirmed.
//   3. rotationAround(axis is Line, angle is ValueWithUnits) returns
//      Transform -- guessed function name/signature for building a
//      rotation Transform. Not confirmed. This is the single biggest
//      risk in this file; if it doesn't compile, paste the exact error
//      and I'll adjust from there rather than guessing again blind.
//   4. isAngle(definition.angle, ANGLE_360_BOUNDS) -- ANGLE_BOUNDS
//      (v1's guess) was confirmed dead live ("Variable ANGLE_BOUNDS not
//      found"). Web research (Onshape forum examples, e.g. a simple
//      rotation feature using "isAngle(definition.angle,
//      ANGLE_360_BOUNDS);") turned up the real constant name.
//
// Same appearance-styling approach and same known REST-override
// limitation as proposedFillet.fs/proposedMove.fs.
//
// "accepted" (hidden, same mechanism as proposedMove.fs): while false,
// this feature only ever previews -- the original body is untouched, a
// duplicate gets rotated instead. The right panel patches this to true
// on Accept, which makes this SAME feature instance apply the rotation
// to the REAL body instead of a throwaway copy.
//
// Pending-state preview matches proposedMove.fs's hand-drawn
// sketchy-wireframe treatment: the rotated duplicate's edges (captured
// via qOwnedByBody, same topology as the original since a rotation
// doesn't add/remove edges) get a 2-4-stroke hand-drawn overlay, then
// the duplicate is deleted -- only the sketchy strokes remain.
// handDrawEdgeSketchy/RandomNumberFunction/idToNum/lcprng below are
// copied verbatim from proposedMove.fs's confirmed-working helpers.
//
// Angle dimension: a dashed arc + degree label, not a filled arrow --
// matches the arc/dash technique the reference source itself used for
// its own X/Y/Z rotation callouts (rather than reusing Move's straight
// arrow, which wouldn't make sense for a rotation). Adapted to our
// arbitrary user-picked axis (the reference always used world X/Y/Z):
// the arc's radius/plane are built from the body's own bounding-box
// farthest corner, projected perpendicular to the axis, so there's
// always SOME meaningful in-plane direction to sweep through even
// though our axis isn't fixed to a world direction. dot() is used here
// for the first time in this codebase -- a standard vector op, but not
// independently confirmed live like cross()/normalize() have been.
// Skips drawing entirely if that corner sits too close to the axis line
// to give a sane radius (e.g. axis through the body's center).

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Rotate" }
export const fuzzycadProposedRotate = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to rotate", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Rotation axis", "Filter" : EntityType.EDGE }
        definition.axis is Query;

        annotation { "Name" : "Angle" }
        isAngle(definition.angle, ANGLE_360_BOUNDS);

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

        // PENDING STATE below (unchanged).

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

        const chordLength = 3 * millimeter;
        const variance = 0.5 * millimeter;

        var rnd = RandomNumberFunction(id);
        var allSketchyStrokes = qNothing();
        var edgeIndex = 0;

        for (var edgeQuery in evaluateQuery(context, qOwnedByBody(qEverything(EntityType.EDGE), proposedBody)))
        {
            const strokes = handDrawEdgeSketchy(
                    context,
                    id + ("sketchyEdge" ~ toString(edgeIndex)),
                    chordLength,
                    variance,
                    rnd,
                    edgeQuery
            );
            allSketchyStrokes = qUnion(allSketchyStrokes, strokes);
            edgeIndex += 1;
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
                    "value" : color(0.25, 0.55, 0.95, 1.0)
            });
        }

        // Pick whichever of the bounding box's 8 corners sits FARTHEST
        // (perpendicular distance) from the rotation axis, instead of
        // always using one fixed corner (maxCorner) that might happen to
        // sit close to the axis and give a barely-visible arc. Since
        // linear displacement under a rotation is radius * angle, the
        // corner with the largest perpendicular radius is also the point
        // that physically moves the most -- drawing the arc there both
        // reads clearer and matches "where the change is biggest."
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
            const dimensionColor = color(0.25, 0.55, 0.95, 1.0);

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

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

//////////////////////////////////////////////////////////////////////
//
// DASHED ANGLE ARC + LABEL
//
// Sweeps from `startDir` toward `otherDir` (both unit vectors
// perpendicular to `axisDirection` and to each other) by `angle`,
// drawn as short dashed segments (same dash/gap ratio as the
// reference source's own rotation-arc callouts) rather than a solid
// arc, then a text label at the arc's midpoint angle.
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
// HAND-DRAWN EDGE (copied verbatim from proposedMove.fs)
//
//////////////////////////////////////////////////////////////////////

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
            // .origin already carries length units -- do NOT multiply by meter.
            var basePt = tangents[i].origin as Vector;

            var s1 = rnd();
            var s2 = rnd();

            var jitterFactor = 0.5 + ((s2 % 100) / 100.0) * 0.5;

            var offsetX = 2 * ((((s1 + i * 17 + strokeIndex * 29) % 100) / 100.0) - 0.5) * variance * jitterFactor;
            var offsetY = 2 * ((((s1 + i * 23 + strokeIndex * 37) % 100) / 100.0) - 0.5) * variance * jitterFactor;
            var offsetZ = 2 * ((((s1 + i * 31 + strokeIndex * 41) % 100) / 100.0) - 0.5) * variance * jitterFactor;

            var perturbed = basePt;
            perturbed[0] += offsetX;
            perturbed[1] += offsetY;
            perturbed[2] += offsetZ;

            newPoints[i] = perturbed;
        }

        const strokeId = id + ("_stroke" ~ toString(strokeIndex));
        opFitSpline(context, strokeId, { "points" : newPoints });
        strokesQuery = qUnion(strokesQuery, qCreatedBy(strokeId, EntityType.BODY));
    }

    return strokesQuery;
}

//////////////////////////////////////////////////////////////////////
//
// RANDOM NUMBER GENERATOR (copied verbatim from proposedMove.fs)
//
//////////////////////////////////////////////////////////////////////

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
