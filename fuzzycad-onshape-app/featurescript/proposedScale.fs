// FuzzyCAD "Proposed Scale" custom feature -- v3.
// v1 guessed a dedicated opScale() op -- confirmed dead live ("Function
// opScale with 3 argument(s) not found"). v2 tried building a scaling
// Transform via identityMatrix(3) * scale -- never live-tested.
//
// v3 replaces that guess with scaleNonuniformly(sx, sy, sz, point),
// confirmed real and working in a real FeatureScript source the user
// found (used there as: "opTransform(context, id, { "bodies": ...,
// "transform": scaleNonuniformly(sx, sy, sz, evVertexPoint(...)) })").
// Much better grounded than the identityMatrix guess. Since opPattern's
// own transforms don't have to be rigid (Onshape's own docs, and
// confirmed working for the rotation case), passing
// scaleNonuniformly(...) directly as one of opPattern's "transforms"
// should work the same way -- untested, but this is the most
// well-supported version of this file yet.
//
// POSITIVE_REAL_BOUNDS (confirmed via real isReal() usage examples
// elsewhere) and evVertexPoint (now ALSO independently confirmed real
// in that same reference source) are unchanged from v2.
//
// "accepted" (hidden, same mechanism as proposedMove.fs): while false,
// this feature only ever previews -- the original body is untouched, a
// duplicate gets scaled instead. The right panel patches this to true
// on Accept, which makes this SAME feature instance apply the scale to
// the REAL body instead of a throwaway copy.

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

        const pivot = evVertexPoint(context, { "vertex" : definition.originPoint });
        const scaleTransform = scaleNonuniformly(
                definition.scaleFactor,
                definition.scaleFactor,
                definition.scaleFactor,
                pivot
        );

        // ACCEPTED STATE: scale the real body directly, no
        // duplicate/preview machinery at all, then stop.
        if (definition.accepted)
        {
            opTransform(context, id + "acceptedScale", {
                    "bodies" : originalBody,
                    "transform" : scaleTransform
            });

            return;
        }

        // PENDING STATE below (unchanged).

        opPattern(context, id + "duplicate", {
                "entities" : originalBody,
                "transforms" : [scaleTransform],
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
