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
//      RandomNumberFunction(id), used for this in the reference source,
//      turned out to come from a separate library document that source
//      imported -- confirmed live ("Function RandomNumberFunction with
//      1 argument(s) not found"), not part of the standard library, not
//      available here. Uses a deterministic pseudo-random substitute
//      instead (loop indices times arbitrary primes, modulo 100).
//
// v5 (per explicit request: "我要一摸一样" -- match the reference exactly):
// replaced v4's jitter, which applied ONE shared scalar offset to all
// three axes (vector(j0, j0, j0)), with jitterOffset() -- three
// SEPARATE offsets (x/y/z), each keyed off its own pair of primes
// (17/23/31 against the edge index, 29/37/41 against the stroke index),
// plus a jitterFactor multiplier -- mirroring the reference source's
// handDrawEdgeSketchy structure directly. The rnd()/RandomNumberFunction
// substitution itself is unchanged (still unavailable, see below).
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
        const jitterFactor = 1.0;

        // Hand-drawn-style dashed outline: each dash endpoint gets its
        // OWN x/y/z jitter, matching the reference source's
        // handDrawEdgeSketchy structure exactly -- three separate offset
        // formulas (offsetX/offsetY/offsetZ), each keyed off a distinct
        // pair of prime multipliers: 17/23/31 against the edge index,
        // 29/37/41 against the stroke (point-within-edge) index, scaled
        // by jitterFactor. The one deviation from the reference is
        // unavoidable: RandomNumberFunction (used there for this) turned
        // out to live in a separate library document that source
        // imported -- confirmed live ("Function RandomNumberFunction
        // with 1 argument(s) not found"), not part of the standard
        // library, not available here. jitterOffset() below substitutes
        // a deterministic pseudo-random value (modulo arithmetic on the
        // same indices) everywhere the reference called rnd(), keeping
        // the surrounding per-axis structure identical.
        const proposedEdges = evaluateQuery(context, qCreatedBy(id + "duplicate", EntityType.EDGE));
        const dashSteps = 10;
        var allDashes = qNothing();
        for (var e = 0; e < size(proposedEdges); e += 1)
        {
            for (var i = 0; i < dashSteps; i += 2)
            {
                const t0 = i / dashSteps;
                const t1 = (i + 1) / dashSteps;
                var p0 = evEdgeTangentLine(context, { "edge" : proposedEdges[e], "parameter" : t0 }).origin;
                var p1 = evEdgeTangentLine(context, { "edge" : proposedEdges[e], "parameter" : t1 }).origin;

                p0 = p0 + jitterOffset(e, i, jitter, jitterFactor);
                p1 = p1 + jitterOffset(e, i + 1, jitter, jitterFactor);

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

// Deterministic pseudo-random per-axis jitter offset for one dash
// endpoint, mirroring the reference source's handDrawEdgeSketchy offset
// formula structure: THREE separate offsets (x/y/z), each seeded off a
// distinct pair of primes -- 17/23/31 against `edgeIndex`, 29/37/41
// against `strokeIndex` -- instead of one shared scalar applied to all
// three axes. jitterFactor is kept as its own multiplier (as in the
// reference) so the effect can be dialed up/down without touching the
// prime constants. Substitutes modulo-100 arithmetic on the two indices
// for the reference's rnd()/RandomNumberFunction calls, which are not
// available here (confirmed live -- see header comment).
function jitterOffset(
    edgeIndex is number,
    strokeIndex is number,
    jitter is ValueWithUnits,
    jitterFactor is number
)
returns Vector
{
    const seedX = (edgeIndex * 17 + strokeIndex * 29) % 100;
    const seedY = (edgeIndex * 23 + strokeIndex * 37) % 100;
    const seedZ = (edgeIndex * 31 + strokeIndex * 41) % 100;

    const offsetX = (seedX / 100.0 - 0.5) * 2 * jitter * jitterFactor;
    const offsetY = (seedY / 100.0 - 0.5) * 2 * jitter * jitterFactor;
    const offsetZ = (seedZ / 100.0 - 0.5) * 2 * jitter * jitterFactor;

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
