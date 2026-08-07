// FuzzyCAD "Proposed Hole" custom feature -- DRAFT, not yet compiled.
// Reuses two already-confirmed pieces:
//   - opPattern() zero-offset duplication + setProperty appearance
//     styling, same as proposedFillet.fs/proposedChamfer.fs/etc.
//   - evFaceTangentPlane's direction-from-face logic + oppositeDirection
//     toggle, copied verbatim from proposedExtrude.fs (confirmed live).
//
// The genuinely NEW, UNCONFIRMED piece: cutting material OUT of a body
// instead of adding a new one. proposedExtrude.fs uses
// NewBodyOperationType.NEW (confirmed). This guesses
// NewBodyOperationType.REMOVE is the sibling enum value for a cut, which
// seems likely but is unconfirmed.
//
// The trickier problem: the duplicate is coincident with the original
// (zero offset, same as every other tool in this set) -- if the REMOVE
// extrude isn't scoped to a specific body, it could plausibly cut into
// BOTH the original and the duplicate (they occupy the same space),
// destroying the "never touch the original" guarantee. Guessing there's
// a "booleanScope" key (matching the native Extrude feature's own
// "Scope" selector, visible in its UI when Operation type = Remove) that
// restricts the cut to just the duplicate. This is the single biggest
// risk in this file -- if scoping doesn't work as guessed, the original
// body may get cut too, so test this one on a body you don't mind
// re-copying/undoing if it goes wrong, and check the ORIGINAL is still
// solid (no hole) after inserting.
//
// The hole's PROFILE ("entities", a sketch face) is picked on the
// ORIGINAL body's geometry (same reasoning as Fillet's "edge" param --
// query selection only works against geometry that already exists when
// the dialog is open). Since opPattern only duplicates definition.body
// (not the sketch), the profile face itself isn't duplicated -- but
// because the copy sits at the exact same location as the original
// (zero offset), the original profile's geometry still lines up
// correctly against the copy, so no separate profile-matching step
// (like Fillet's evEdgeTangentLine + qClosestTo) should be needed here.
//
// Same appearance-styling approach and same known REST-override
// limitation as the other Proposed* features in this directory.
//
// "accepted" (hidden, same mechanism as proposedMove.fs): while false,
// this feature only ever previews -- the original body is untouched, a
// duplicate gets cut instead. The right panel patches this to true on
// Accept, which makes this SAME feature instance cut the REAL body
// directly (no "booleanScope" needed there -- there's no duplicate
// coincident with it to accidentally also cut, unlike the pending path).
//
// Pending-state preview matches proposedMove.fs's hand-drawn
// sketchy-wireframe treatment: the duplicate gets cut first (so the new
// hole edges are captured via qOwnedByBody reading its CURRENT edges
// post-cut), a 2-4-stroke hand-drawn overlay is built from those, then
// the duplicate is deleted -- only the sketchy strokes remain.
// handDrawEdgeSketchy/RandomNumberFunction/idToNum/lcprng below are
// copied verbatim from proposedMove.fs's confirmed-working helpers.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Hole" }
export const fuzzycadProposedHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to modify", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Hole profile", "Filter" : EntityType.FACE }
        definition.entities is Query;

        annotation { "Name" : "Depth" }
        isLength(definition.depth, LENGTH_BOUNDS);

        annotation { "Name" : "Opposite direction", "Default" : false }
        definition.oppositeDirection is boolean;

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

        const facesToCut = evaluateQuery(context, definition.entities);
        var direction = evFaceTangentPlane(context, {
                "face" : facesToCut[0],
                "parameter" : vector(0.5, 0.5)
            }).normal;
        if (definition.oppositeDirection)
        {
            direction = -direction;
        }

        // ACCEPTED STATE: cut the real body directly, no
        // duplicate/preview machinery at all, then stop.
        if (definition.accepted)
        {
            opExtrude(context, id + "acceptedHole", {
                    "entities" : definition.entities,
                    "direction" : direction,
                    "endBound" : BoundingType.BLIND,
                    "endDepth" : definition.depth,
                    "operationType" : NewBodyOperationType.REMOVE
            });

            return;
        }

        // PENDING STATE below (unchanged).

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        opExtrude(context, id + "hole", {
                "entities" : definition.entities,
                "direction" : direction,
                "endBound" : BoundingType.BLIND,
                "endDepth" : definition.depth,
                "operationType" : NewBodyOperationType.REMOVE,
                "booleanScope" : proposedBody
        });

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

        opDeleteBodies(context, id + "deleteTemporaryProposal", {
                "entities" : proposedBody
        });
    });

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
