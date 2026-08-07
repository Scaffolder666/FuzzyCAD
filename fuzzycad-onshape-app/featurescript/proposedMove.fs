// FuzzyCAD "Proposed Move" custom feature -- v7.
//
// v4 adds three things requested after seeing v3 render correctly:
//   1. Per-axis arrows (X/Y/Z each get their own arrow + label) instead
//      of one combined diagonal arrow -- skipped entirely for any axis
//      that didn't move.
//   2. Real arrowheads: two short "wing" segments angled back from each
//      arrow's tip, built from a perpendicular direction via cross().
//      This part is MY OWN construction, not from the reference source
//      -- higher risk than the rest of this file.
//   3. Hand-drawn jitter on the dashed outline's segment endpoints.
//      v4 first tried RandomNumberFunction(id) directly, got "Function
//      RandomNumberFunction with 1 argument(s) not found", and (wrongly)
//      concluded it needed an external library import -- see the v6 note
//      below for the actual fix.
//
// v5 (per explicit request: "我要一摸一样" -- match the reference exactly):
// replaced v4's jitter, which applied ONE shared scalar offset to all
// three axes (vector(j0, j0, j0)), with jitterOffset() -- three
// SEPARATE offsets (x/y/z), each keyed off its own pair of primes
// (17/23/31 against the edge index, 29/37/41 against the stroke index),
// plus a jitterFactor multiplier -- mirroring the reference source's
// handDrawEdgeSketchy structure directly.
//
// v6 corrects a wrong diagnosis from v4: RandomNumberFunction is NOT in
// an external library import -- the two follow-up reference source
// dumps confirm it's three ordinary helper functions
// (RandomNumberFunction/idToNum/lcprng) defined directly at the bottom
// of that same Feature Studio file. The earlier "not found" compile
// error just meant we'd copied the CALL without copying those three
// function bodies. They're copied verbatim below now, and
// jitterOffset() calls the real rnd() (via RandomNumberFunction(id)),
// not a loop-index pseudo-random substitute.
//
// v7 fixes the actual reported symptom: v4-v6's "dashes" were a single
// 2-point straight-line spline per half-edge chunk -- structurally
// nothing like the reference's dense scribble (confirmed against the
// reference's own screenshot). Replaced with a direct port of
// handDrawEdgeSketchy/drawSketchyWireframe: 2-4 FULL-length strokes per
// edge, each a spline through many points sampled the whole way along
// the edge (point count driven by chordLength, jitter driven by
// variance -- same names/defaults as the reference), every point
// independently jittered via jitterOffset(). See that function's own
// comment for the one deliberate deviation (evEdgeTangentLine singular
// in a loop, instead of the reference's evEdgeTangentLines batch call,
// whose unit convention is unconfirmed).
//
// Everything else (opCreateCompositePart merging many wire bodies into
// one before a single setProperty call, skText/newSketchOnPlane/
// worldToPlane/skSolve for labels, qUnion accumulating body queries)
// mirrors the confirmed-real patterns from that reference source
// directly. String concatenation uses ~ throughout (confirmed: + only
// works for Id + string, not string + string -- "Can not add string
// and string" live).
//
// Still true from v2/v3: Onshape draws every body's own edges as
// default black lines regardless of face opacity -- there is no way
// found to suppress a body's own edge rendering, so the proposed body's
// complete outline stays visible alongside the dashed skeleton.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

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
    }
    {
        const originalBody = definition.body;
        const offset = vector(definition.moveX, definition.moveY, definition.moveZ);

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(offset)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        setProperty(context, {
                "entities" : originalBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.75, 0.75, 0.75, 0.08)
        });

        setProperty(context, {
                "entities" : proposedBody,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.25, 0.55, 0.95, 0.0)
        });

        const dashColor = color(0.25, 0.55, 0.95, 1.0);
        const variance = 0.5 * millimeter;
        const chordLength = 1 * millimeter;

        // v7 replaces v4-v6's short 2-point "dash" segments (which only
        // jittered the two endpoints of alternating half-edge chunks --
        // confirmed live to be visually indistinguishable from a plain
        // edge at these magnitudes) with a direct port of the reference
        // source's actual handDrawEdgeSketchy/drawSketchyWireframe
        // structure: for EACH edge, 2-4 FULL-LENGTH strokes, each one a
        // spline through many points sampled the whole way along the
        // edge (density set by chordLength), with EVERY point
        // independently jittered. This is what produces the dense,
        // overlapping scribble look (confirmed from the reference's own
        // screenshot) -- a single straight 2-point dash never could.
        //
        // One deliberate deviation from the reference: it samples all
        // points in one batch via evEdgeTangentLines (plural). That
        // function's exact return-unit convention is unconfirmed here
        // (the reference's own copies disagree on whether to multiply
        // the result by `meter`), so this loops evEdgeTangentLine
        // (singular, already confirmed live and unit-correct elsewhere
        // in this file) once per sample point instead -- same point
        // positions, no unverified API surface.
        const proposedEdges = evaluateQuery(context, qCreatedBy(id + "duplicate", EntityType.EDGE));
        var allStrokes = qNothing();
        var rnd = RandomNumberFunction(id);
        for (var e = 0; e < size(proposedEdges); e += 1)
        {
            const edgeQuery = proposedEdges[e];
            const edgeLength = evLength(context, { "entities" : edgeQuery });
            const pointCount = ceil(max(edgeLength / chordLength, 5));

            var basePoints = makeArray(pointCount, undefined);
            const params = range(0.0, 1.0, pointCount);
            for (var p = 0; p < pointCount; p += 1)
            {
                basePoints[p] = evEdgeTangentLine(context, { "edge" : edgeQuery, "parameter" : params[p] }).origin;
            }

            const rawRandom = rnd() % 100;
            const numStrokes = 2 + floor(rawRandom / 33);

            for (var strokeIndex = 0; strokeIndex < numStrokes; strokeIndex += 1)
            {
                var newPoints = makeArray(pointCount, undefined);
                for (var i = 0; i < pointCount; i += 1)
                {
                    newPoints[i] = basePoints[i] + jitterOffset(rnd, i, strokeIndex, variance);
                }

                const strokeId = id + "stroke" + toString(e) + "_" + toString(strokeIndex);
                opFitSpline(context, strokeId, { "points" : newPoints });
                allStrokes = qUnion(allStrokes, qCreatedBy(strokeId, EntityType.BODY));
            }
        }

        opCreateCompositePart(context, id + "dashComposite", {
                "bodies" : allStrokes,
                "closed" : false
        });

        setProperty(context, {
                "entities" : qCreatedBy(id + "dashComposite", EntityType.BODY),
                "propertyType" : PropertyType.APPEARANCE,
                "value" : dashColor
        });

        // Per-axis labeled arrows -- each skipped entirely if that axis
        // didn't move.
        const bbox = evBox3d(context, { "topology" : originalBody, "tight" : true });
        const bboxCenter = vector(
                (bbox.minCorner[0] + bbox.maxCorner[0]) / 2,
                (bbox.minCorner[1] + bbox.maxCorner[1]) / 2,
                (bbox.minCorner[2] + bbox.maxCorner[2]) / 2
        );

        drawAxisArrow(context, id + "arrowX", bboxCenter, vector(definition.moveX, 0 * meter, 0 * meter), "X", dashColor);
        drawAxisArrow(context, id + "arrowY", bboxCenter, vector(0 * meter, definition.moveY, 0 * meter), "Y", dashColor);
        drawAxisArrow(context, id + "arrowZ", bboxCenter, vector(0 * meter, 0 * meter, definition.moveZ), "Z", dashColor);
    });

// Per-axis jitter offset for one sample point on one hand-drawn stroke,
// matching the reference source's handDrawEdgeSketchy offset formula
// exactly: THREE separate offsets (x/y/z), each keyed off a distinct
// pair of primes -- 17/23/31 against `pointIndex` (this point's
// position along the edge, NOT which edge), 29/37/41 against
// `strokeIndex` (which of the 2-4 overlapping strokes this is) --
// scaled by a jitterFactor derived from a second rnd() sample. Edge-to-
// edge variation comes purely from `rnd` being a stateful generator
// whose position keeps advancing across the whole edge loop, exactly as
// in the reference -- there's no edge-index term in the formula itself.
function jitterOffset(
    rnd is function,
    pointIndex is number,
    strokeIndex is number,
    variance is ValueWithUnits
)
returns Vector
{
    const s1 = rnd();
    const s2 = rnd();

    const jitterFactor = 0.5 + ((s2 % 100) / 100.0) * 0.5;

    const offsetX = 2 * ((((s1 + pointIndex * 17 + strokeIndex * 29) % 100) / 100.0) - 0.5) * variance * jitterFactor;
    const offsetY = 2 * ((((s1 + pointIndex * 23 + strokeIndex * 37) % 100) / 100.0) - 0.5) * variance * jitterFactor;
    const offsetZ = 2 * ((((s1 + pointIndex * 31 + strokeIndex * 41) % 100) / 100.0) - 0.5) * variance * jitterFactor;

    return vector(offsetX, offsetY, offsetZ);
}

// Draws one straight arrow (shaft + two-wing arrowhead) from `start`
// along `axisOffset`, plus a text label ("X: 12.5 mm") at its midpoint.
// Skipped entirely if axisOffset's length is ~zero, since there's
// nothing meaningful to show for an axis that didn't move.
function drawAxisArrow(
    context is Context,
    id is Id,
    start is Vector,
    axisOffset is Vector,
    axisName is string,
    arrowColor is map
)
{
    const distanceMm = norm(axisOffset) / millimeter;
    if (distanceMm < 0.001)
    {
        return;
    }

    const end = start + axisOffset;
    const direction = normalize(axisOffset);

    opFitSpline(context, id + "shaft", { "points" : [start, end] });

    // Arrowhead: two short "wings" angled back from the tip, built from
    // a direction perpendicular to the shaft (cross() against whichever
    // world axis is least parallel to the shaft, to avoid a degenerate
    // cross product).
    const reference = (abs(direction[0]) < 0.9) ? vector(1, 0, 0) : vector(0, 1, 0);
    const wingDir = normalize(cross(direction, reference));
    const headLength = min(distanceMm * 0.15, 3) * millimeter;
    const wing1 = end - direction * headLength + wingDir * headLength * 0.5;
    const wing2 = end - direction * headLength - wingDir * headLength * 0.5;

    opFitSpline(context, id + "wing1", { "points" : [end, wing1] });
    opFitSpline(context, id + "wing2", { "points" : [end, wing2] });

    const arrowBodies = qUnion(
            qCreatedBy(id + "shaft", EntityType.BODY),
            qCreatedBy(id + "wing1", EntityType.BODY),
            qCreatedBy(id + "wing2", EntityType.BODY)
    );

    opCreateCompositePart(context, id + "composite", {
            "bodies" : arrowBodies,
            "closed" : false
    });

    setProperty(context, {
            "entities" : qCreatedBy(id + "composite", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : arrowColor
    });

    const midPoint = (start + end) / 2;
    const labelPlane = plane(midPoint, direction);
    const labelSketch = newSketchOnPlane(context, id + "labelSketch", {
            "sketchPlane" : labelPlane
    });
    const labelUv = worldToPlane(labelPlane, midPoint);
    const textSize = 3 * millimeter;
    skText(labelSketch, "labelText", {
            "text" : axisName ~ ": " ~ toString(round(distanceMm, 1)) ~ " mm",
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(labelUv[0] - textSize, labelUv[1] - textSize),
            "secondCorner" : vector(labelUv[0] + textSize, labelUv[1] + textSize)
    });
    skSolve(labelSketch);
}

// The three helpers below are copied verbatim from the reference
// source's own bottom-of-file definitions -- NOT a standard-library
// import (that was last version's wrong guess). RandomNumberFunction(id)
// returns a stateful generator function seeded from the feature's own
// Id; each call to it advances an internal linear-congruential PRNG
// state and returns the new state as a large number (callers reduce it
// mod whatever range they need, e.g. jitterOffset()'s `% 100` above).
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
