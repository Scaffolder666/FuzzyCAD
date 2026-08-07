// FuzzyCAD "Proposed Chamfer" custom feature -- near-identical to
// proposedFillet.fs, swapping opFillet for opChamfer. Every OTHER piece
// (opPattern duplication, evEdgeTangentLine + qClosestTo edge matching,
// setProperty appearance styling, the known REST-override limitation) is
// already confirmed live for Fillet and reused verbatim here -- the only
// new, unconfirmed piece is opChamfer's own parameter shape.
//
// UNCONFIRMED: opChamfer(context, id, {"entities": ..., "width": ...}) --
// guessed by analogy with opFillet's confirmed {"entities": ...,
// "radius": ...} shape, using "width" (Onshape's own Chamfer feature UI
// calls its equal-distance parameter "Width") instead of "radius". If
// "width" isn't the real key, expect a similarly-shaped compiler error to
// what opFillet would give for a wrong key name -- paste it back and
// I'll adjust.
//
// "accepted" (hidden, same mechanism as proposedMove.fs/proposedFillet.fs):
// while false, this feature only ever previews -- the original body is
// untouched, a duplicate gets the chamfer instead. The right panel
// patches this to true on Accept, which makes this SAME feature
// instance chamfer the REAL edge on the REAL body instead of a
// throwaway copy.

FeatureScript 3029;
import(path : "onshape/std/common.fs", version : "3029.0");

annotation { "Feature Type Name" : "FuzzyCAD Proposed Chamfer" }
export const fuzzycadProposedChamfer = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Body to chamfer", "Filter" : EntityType.BODY }
        definition.body is Query;

        annotation { "Name" : "Edge to chamfer", "Filter" : EntityType.EDGE }
        definition.edge is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, LENGTH_BOUNDS);

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

        // ACCEPTED STATE: chamfer the real edge on the real body
        // directly, no duplicate/preview machinery at all, then stop.
        if (definition.accepted)
        {
            opChamfer(context, id + "acceptedChamfer", {
                    "entities" : definition.edge,
                    "width" : definition.width
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

        const midpoint = evEdgeTangentLine(context, {
                "edge" : definition.edge,
                "parameter" : 0.5
        }).origin;

        const copiedEdges = qCreatedBy(id + "duplicate", EntityType.EDGE);
        const matchedEdge = qClosestTo(copiedEdges, midpoint);

        opChamfer(context, id + "chamfer", {
                "entities" : matchedEdge,
                "width" : definition.width
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
