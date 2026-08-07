// FuzzyCAD "Proposed Scale" custom feature -- DRAFT v2, not yet
// compiled. v1 guessed a dedicated opScale(context, id, definition) op,
// which the compiler rejected outright ("Function opScale with 3
// argument(s) not found") -- confirmed dead end.
//
// Web research (Onshape's own FsDoc + forum posts) turned up two
// corrections:
//   1. opPattern's "transforms" do NOT have to be rigid (quoting
//      Onshape's own docs) -- scaling can go through the SAME
//      opPattern-with-a-Transform trick Move/Rotate already use,
//      confirmed live for both. No separate scale op needed at all.
//   2. A scaling Transform is built as transform(matrix, point) --
//      found a real example: "transform(identityMatrix(3) * scale,
//      fixedPoint)" (uniform scale about a point). identityMatrix(3)
//      presumably returns a 3x3 identity Matrix; multiplying by a plain
//      number scales it uniformly.
//   3. REAL_BOUNDS isn't real either (confirmed live: "Variable
//      REAL_BOUNDS not found"). Found real examples of
//      POSITIVE_REAL_BOUNDS used for isReal(...) elsewhere (e.g. color
//      channel values) -- a natural fit for a scale factor too, since
//      scale should never be zero or negative.
//
// Still UNCONFIRMED, none of this web research is a substitute for the
// compiler actually accepting it:
//   1. identityMatrix(3) -- guessed function name for a 3x3 identity
//      matrix constructor, found referenced but not the exact call
//      shape confirmed.
//   2. transform(matrix, point) -- guessed 2-arg overload shape (matrix
//      first, point second) by analogy with the "transform(identityMatrix(3)
//      * scale, fixedPoint)" example found online, not from this
//      codebase's own confirmed usage.
//   3. evVertexPoint(context, {"vertex": ...}) -- same guess as v1,
//      unconfirmed.
//
// Same appearance-styling approach and same known REST-override
// limitation as proposedFillet.fs/proposedMove.fs/proposedRotate.fs.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Scale" }
export const fuzzycadProposedScale = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to scale", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Scale origin", "Filter" : EntityType.VERTEX }
        definition.originPoint is Query;

        annotation { "Name" : "Scale factor" }
        isReal(definition.scaleFactor, POSITIVE_REAL_BOUNDS);
    }
    {
        const originalBody = definition.body;

        const pivot = evVertexPoint(context, { "vertex" : definition.originPoint });

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(identityMatrix(3) * definition.scaleFactor, pivot)],
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
                "value" : color(0.25, 0.55, 0.95, 1.0)
        });
    });
