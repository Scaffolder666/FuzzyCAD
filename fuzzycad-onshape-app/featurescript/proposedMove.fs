// FuzzyCAD "Proposed Move" custom feature -- v5.
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
        const jitter = 0.15 * millimeter;

        // Hand-drawn-style dashed outline: each dash endpoint gets its
        // OWN x/y/z jitter, matching the reference source's
        // handDrawEdgeSketchy exactly -- real rnd() (RandomNumberFunction
        // (id), a deterministic linear-congruential generator seeded off
        // the feature's own id, copied verbatim below), sampled twice per
        // point (s1 for the three offsets, s2 for jitterFactor), then
        // three separate offset formulas keyed off distinct prime pairs:
        // 17/23/31 against the edge index, 29/37/41 against the stroke
        // (point-within-edge) index.
        const proposedEdges = evaluateQuery(context, qCreatedBy(id + "duplicate", EntityType.EDGE));
        const dashSteps = 10;
        var allDashes = qNothing();
        var rnd = RandomNumberFunction(id);
        for (var e = 0; e < size(proposedEdges); e += 1)
        {
            for (var i = 0; i < dashSteps; i += 2)
            {
                const t0 = i / dashSteps;
                const t1 = (i + 1) / dashSteps;
                var p0 = evEdgeTangentLine(context, { "edge" : proposedEdges[e], "parameter" : t0 }).origin;
                var p1 = evEdgeTangentLine(context, { "edge" : proposedEdges[e], "parameter" : t1 }).origin;

                p0 = p0 + jitterOffset(rnd, e, i, jitter);
                p1 = p1 + jitterOffset(rnd, e, i + 1, jitter);

                const dashId = id + "dash" + toString(e) + "_" + toString(i);
                opFitSpline(context, dashId, { "points" : [p0, p1] });
                allDashes = qUnion(allDashes, qCreatedBy(dashId, EntityType.BODY));
            }
        }

        opCreateCompositePart(context, id + "dashComposite", {
                "bodies" : allDashes,
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

// Per-axis jitter offset for one dash endpoint, matching the reference
// source's handDrawEdgeSketchy offset formula exactly: THREE separate
// offsets (x/y/z), each keyed off a distinct pair of primes -- 17/23/31
// against `edgeIndex`, 29/37/41 against `strokeIndex` -- scaled by a
// jitterFactor derived from a second rnd() sample, same as the
// reference. `rnd` is the stateful generator returned by
// RandomNumberFunction(id) below -- calling it advances its internal
// state, so s1/s2 here really are two different pseudo-random draws,
// not the same value reused.
function jitterOffset(
    rnd is function,
    edgeIndex is number,
    strokeIndex is number,
    jitter is ValueWithUnits
)
returns Vector
{
    const s1 = rnd();
    const s2 = rnd();

    const jitterFactor = 0.5 + ((s2 % 100) / 100.0) * 0.5;

    const offsetX = 2 * ((((s1 + edgeIndex * 17 + strokeIndex * 29) % 100) / 100.0) - 0.5) * jitter * jitterFactor;
    const offsetY = 2 * ((((s1 + edgeIndex * 23 + strokeIndex * 37) % 100) / 100.0) - 0.5) * jitter * jitterFactor;
    const offsetZ = 2 * ((((s1 + edgeIndex * 31 + strokeIndex * 41) % 100) / 100.0) - 0.5) * jitter * jitterFactor;

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
