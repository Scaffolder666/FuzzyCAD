// FuzzyCAD "Proposed Scale" custom feature -- DRAFT, not yet compiled.
// The riskiest of the three requested (Move/Rotate/Scale): scaling is
// NOT a rigid transform (it doesn't preserve distances), so it almost
// certainly can't reuse the opPattern-with-a-Transform trick that Move
// and Rotate both lean on (Transform values throughout this codebase's
// confirmed usage -- opPattern, opTransform -- have only ever carried
// translation/rotation). Scale most likely needs its own dedicated op,
// applied to a duplicate made the same way Fillet does it (zero-offset
// opPattern first, then operate on the copy).
//
// UNCONFIRMED pieces, most likely to need fixing, roughly in order of
// how likely each is to be wrong:
//   1. opScale(context, id, definition) -- guessed function name/shape,
//      by analogy with opFillet/opBoolean/opExtrude all taking
//      (context, id, {"entities": ..., ...op-specific keys}). Onshape's
//      native Scale feature must call SOMETHING like this, but the exact
//      name is not confirmed.
//   2. "scalePoint" / "scale" -- guessed key names for opScale's
//      definition map (the pivot point to scale about, and the scale
//      factor itself).
//   3. evVertexPoint(context, {"vertex": ...}) -- guessed function for
//      turning a picked VERTEX into a Point, by analogy with
//      evEdgeTangentLine's confirmed {"edge": ...} shape. Not confirmed
//      whether this is the real name, or whether it returns a Point
//      directly vs. a record with a nested field.
//   4. isReal(definition.scaleFactor, REAL_BOUNDS) -- guessed by analogy
//      with isLength(..., LENGTH_BOUNDS) (confirmed working elsewhere),
//      but a unitless scale factor may need a different function/bound
//      constant entirely -- this is a real risk, not just a naming
//      detail.
//
// Given how much here is unconfirmed, expect this one to need the most
// rounds of "paste the exact compiler error, get a fix" -- same loop as
// every other genuinely new FeatureScript call this session.
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
        isReal(definition.scaleFactor, REAL_BOUNDS);
    }
    {
        const originalBody = definition.body;

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [transform(vector(0, 0, 0) * meter)],
                "instanceNames" : ["proposed"]
        });

        const proposedBody = qCreatedBy(id + "duplicate", EntityType.BODY);

        const pivot = evVertexPoint(context, { "vertex" : definition.originPoint });

        opScale(context, id + "scale", {
                "entities" : proposedBody,
                "scalePoint" : pivot,
                "scale" : definition.scaleFactor
        });

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
