// FuzzyCAD "Needs Input" custom feature -- DRAFT, not yet compiled.
// A different kind of mark than every other Proposed* feature in this
// directory: it doesn't propose a geometry change at all, it just flags
// "someone needs to make a decision here" and carries a free-text
// question + answer. No opPattern duplicate, no opFillet/opExtrude/etc --
// the ENTIRE feature body is one setProperty call.
//
// Visual language (deliberately different from Proposed*'s "fade
// original, color duplicate" -- there's no duplicate here to color):
// colors the picked EDGES directly, at full opacity, in the SAME blue
// family as Proposed*'s duplicate color but a touch brighter/lighter --
// reads as an "outline highlight" on the real, unchanged geometry rather
// than Proposed*'s "filled volume" look, so the two are distinguishable
// at a glance without needing a second (different) hue.
//
// UNCONFIRMED pieces:
//   1. "definition.question is string;" / "definition.answer is string;"
//      -- guessed direct declaration syntax for a string-typed parameter,
//      by analogy with "definition.oppositeDirection is boolean;"
//      (confirmed working for Extrude) having no isXxx() wrapper, unlike
//      Quantity params which need isLength(...)/isAngle(...). Strings
//      presumably don't need a bounds check either, but this is the
//      single least-tested piece of syntax in this file.
//   2. Whether a plain "Filter"-only annotation without a "Default" is
//      fine for a string param the way it is for boolean's "Default":
//      false -- "question" and "answer" both start blank here rather
//      than defaulting to a String value, since whoever marks this in
//      Onshape's own dialog will type the question at insert time.
//
// "question" is meant to be set once, at insert time, by whoever creates
// the mark, and left alone after -- the right panel renders it read-only
// and only exposes "answer" as an editable field (parameter-mark-panel/
// page.tsx, QuestionPromptRow vs TextAnswerRow, keyed on parameterId).

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Needs Input" }
export const fuzzycadNeedsInput = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Area needing input", "Filter" : EntityType.EDGE }
        definition.entities is Query;

        annotation { "Name" : "Question" }
        definition.question is string;

        annotation { "Name" : "Answer" }
        definition.answer is string;
    }
    {
        setProperty(context, {
                "entities" : definition.entities,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : color(0.3, 0.7, 1.0, 1.0)
        });
    });
