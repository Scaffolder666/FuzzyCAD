FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

// FuzzyCAD Note
//
// A pure annotation mark -- doesn't touch the model at all. Pick a
// vertex/edge/face to point at, type a note, and a callout (pin +
// leader line + text) appears directly on that geometry in the 3D
// view, like a sticky note attached to the part. Also shows on its
// own card in the right panel, where the same text is editable.
//
// Deliberately separate from the Needs Input / Proposed marks: those
// carry real preview geometry and an accept/reject decision about the
// MODEL. A note carries neither -- it is just a comment pinned to a
// location, so it gets its own minimal Cosmo Feature instead of being
// bolted onto every other type.

annotation { "Feature Type Name" : "FuzzyCAD Note" }
export const fuzzycadNote = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation {
            "Name" : "Attach note to",
            "Filter" : EntityType.VERTEX || EntityType.EDGE || EntityType.FACE,
            "MaxNumberOfPicks" : 1
        }
        definition.target is Query;

        // Editable directly in this native dialog on insert, and also from
        // the FuzzyCAD right panel afterward (both just patch the same
        // parameter through the normal Feature API).
        annotation { "Name" : "Note" }
        definition.noteText is string;
    }
    {
        // Draw as soon as a target is picked, independent of noteText --
        // requiring both meant picking a location gave no feedback at all
        // until text was also typed, leaving "did my pick register?"
        // unanswered in between. An empty note now still shows the pin +
        // leader with a placeholder, confirming the pick landed.
        if (isQueryEmpty(context, definition.target))
        {
            return;
        }

        const vertices = qEntityFilter(definition.target, EntityType.VERTEX);
        const edges = qEntityFilter(definition.target, EntityType.EDGE);
        const faces = qEntityFilter(definition.target, EntityType.FACE);

        var anchorPoint = vector(0, 0, 0) * meter;
        var anchorDir = vector(0, 0, 1);
        var resolved = false;

        if (!isQueryEmpty(context, vertices))
        {
            anchorPoint = evVertexPoint(context, { "vertex" : vertices });
            anchorDir = vector(0, 0, 1);
            resolved = true;
        }
        else if (!isQueryEmpty(context, edges))
        {
            const tangentLine = evEdgeTangentLine(context, {
                    "edge" : edges,
                    "parameter" : 0.5
            });
            anchorPoint = tangentLine.origin;
            const tangentDir = tangentLine.direction;
            const ref = (abs(tangentDir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
            anchorDir = normalize(cross(tangentDir, ref));
            resolved = true;
        }
        else if (!isQueryEmpty(context, faces))
        {
            const tangentPlane = evFaceTangentPlane(context, {
                    "face" : faces,
                    "parameter" : vector(0.5, 0.5)
            });
            anchorPoint = tangentPlane.origin;
            anchorDir = tangentPlane.normal;
            resolved = true;
        }

        if (!resolved)
        {
            return;
        }

        const displayText = (definition.noteText == "") ? "Add note..." : definition.noteText;

        drawNoteCallout(context, id + "noteCallout", anchorPoint, anchorDir, displayText);
    });


//////////////////////////////////////////////////////////////////////
//
// NOTE CALLOUT
//
// Pin marker at the anchor + a short leader line + the note text,
// same leader/arrowhead technique as the R=?/C=? callouts elsewhere
// in this codebase (drawEngineeringLeader), just with an informational
// blue instead of the uncertainty-action red, and using a fixed
// leader length since a note has no associated magnitude to scale
// against.
//
//////////////////////////////////////////////////////////////////////

function drawNoteCallout(
    context is Context,
    id is Id,
    anchorPoint is Vector,
    direction is Vector,
    noteText is string)
{
    const dir = normalize(direction);
    const ref = (abs(dir[2]) < 0.9) ? vector(0, 0, 1) : vector(0, 1, 0);
    const side = normalize(cross(dir, ref));
    const side2 = normalize(cross(dir, side));

    const leaderLength = 22 * millimeter;
    const labelPoint = anchorPoint + dir * leaderLength;
    const calloutColor = color(0.12, 0.40, 0.82, 1.0);

    var bodies = qNothing();

    opFitSpline(context, id + "leader", { "points" : [labelPoint, anchorPoint] });
    bodies = qUnion(bodies, qCreatedBy(id + "leader", EntityType.BODY));

    // Small pin cross at the anchor point.
    const pinSize = 1.8 * millimeter;
    opFitSpline(context, id + "pin1", {
            "points" : [anchorPoint - side * pinSize, anchorPoint + side * pinSize]
    });
    opFitSpline(context, id + "pin2", {
            "points" : [anchorPoint - side2 * pinSize, anchorPoint + side2 * pinSize]
    });
    bodies = qUnion(bodies, qCreatedBy(id + "pin1", EntityType.BODY));
    bodies = qUnion(bodies, qCreatedBy(id + "pin2", EntityType.BODY));

    // Small arrowhead pointing back at the anchor, same 4-wing technique
    // as drawEngineeringLeader.
    const headLength = 4 * millimeter;
    const headWidth = 2.5 * millimeter;
    const headBase = anchorPoint + dir * headLength;
    const wingDirs = [side, -side, side2, -side2];

    for (var i = 0; i < 4; i += 1)
    {
        const wingId = id + ("wing" ~ toString(i));
        opFitSpline(context, wingId, {
                "points" : [anchorPoint, headBase + wingDirs[i] * headWidth]
        });
        bodies = qUnion(bodies, qCreatedBy(wingId, EntityType.BODY));
    }

    opCreateCompositePart(context, id + "composite", {
            "bodies" : bodies,
            "closed" : false
    });

    setProperty(context, {
            "entities" : qCreatedBy(id + "composite", EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : calloutColor
    });

    // Text plane built from the leader's own tangent-perpendicular basis
    // (same technique drawEngineeringLeader/drawDimensionArrow already use
    // successfully elsewhere in this codebase) -- NOT a fixed world-axis
    // normal, which read sideways in practice on the warning icon.
    const textPoint = labelPoint + side2 * (4 * millimeter);
    const textPlane = plane(textPoint + side * (0.02 * millimeter), side, dir);
    const textUv = worldToPlane(textPlane, textPoint);
    const textSketch = newSketchOnPlane(context, id + "labelSketch", { "sketchPlane" : textPlane });
    const textSize = 6.0 * millimeter;

    skText(textSketch, "label", {
            "text" : noteText,
            "fontName" : "OpenSans-Regular.ttf",
            "firstCorner" : vector(textUv[0] - 2.2 * textSize, textUv[1] - textSize),
            "secondCorner" : vector(textUv[0] + 2.2 * textSize, textUv[1] + textSize)
    });

    skSolve(textSketch);

    // Solid, filled glyphs instead of bare sketch text -- thin outline
    // letters read as faint/unclear; extracting the letter regions to a
    // colored surface makes the note bold and legible. Guarded on a
    // non-empty region set because the note is arbitrary user text: a
    // whitespace-only note yields no fillable glyph regions, and extracting
    // an empty face set would raise a regen error.
    if (!isQueryEmpty(context, qSketchRegion(id + "labelSketch")))
    {
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
                "value" : calloutColor
        });
    }
}
