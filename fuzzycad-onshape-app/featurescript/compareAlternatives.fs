FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");

// FuzzyCAD Compare Alternatives
//
// Represents a THIRD collaboration situation, distinct from every other
// FuzzyCAD custom feature in this directory:
//
//   Proposed*    -- someone knows the exact solution, proposes it.
//   Needs Input* -- someone knows an operation is needed, not the value.
//   Compare Alternatives (this file) -- multiple concrete, already-exact
//     solutions exist for the SAME slot (e.g. two different commercial
//     casters). Nobody is "proposing" over anybody else -- the point is
//     to keep every candidate available, compare them side by side in
//     the viewport one at a time, discuss trade-offs, then commit.
//
// Because every candidate is already a real commercial part (not a
// sketchy/uncertain shape), this feature does NOT use the hand-drawn
// sketchy-fill visualization every Proposed*/Needs Input* feature uses.
// Whichever option is active is shown as exact, untouched geometry --
// the uncertainty here is BETWEEN options, not inside any one of them.
//
// ARCHITECTURE, reusing what's already proven in this codebase:
//   - Same hidden "accepted" boolean (UIHint.ALWAYS_HIDDEN) as every
//     other Proposed*/Needs Input* feature -- the right panel patches it
//     via the existing partstudio-update-feature parameterUpdates path
//     (confirmed live, generic value merge -- see that route).
//   - Same setProperty(PropertyType.APPEARANCE, alpha near 0) fade
//     technique every other feature uses to hide a body it isn't
//     currently showing, instead of trying to delete/suppress bodies
//     that belong to OTHER features in the tree (not something this
//     feature owns and shouldn't reach into).
//   - "activeOption" is a plain string parameter (not a FeatureScript
//     `enum` type -- avoids needing a second Feature Studio just to
//     declare one, and the right panel already has a confirmed-generic
//     way to PATCH a BTMParameterEnum-shaped value; a plain
//     BTMParameterString is even simpler to round-trip and was chosen
//     here for exactly that reason). Values used: "CURRENT",
//     "ALTERNATIVE_A", "ALTERNATIVE_B".
//
// TWO THINGS IN THIS FILE ARE GENUINELY UNCONFIRMED -- READ BEFORE
// TESTING, and see the fallback notes inline at each site:
//
// (1) CROSS-TAB QUERY SELECTION.
//     "Current component" / "Alternative A" / "Alternative B" are all
//     declared as ordinary `is Query` parameters with an EntityType.BODY
//     filter -- the exact same declaration shape every other custom
//     feature in this directory already uses successfully. The
//     assumption is that Onshape's own Query-parameter selection dialog
//     lets someone click over to a DIFFERENT Part Studio tab in the same
//     document and select a body there while "Alternative A"'s selection
//     is active, the same way native features let you do this. This is
//     ordinary Onshape UI behavior, not something FeatureScript code
//     requests -- but it has not been verified against a genuinely
//     different Part Studio tab from inside a CUSTOM feature's dialog
//     specifically. FIRST THING TO CHECK when testing this feature: open
//     its dialog, click "Alternative A", and try selecting a body on a
//     different tab. If Onshape restricts the selection to the current
//     tab only, that is the concrete signal this feature genuinely needs
//     a PartStudioData-style cross-document reference parameter instead
//     (BTMParameterReferencePartStudio -- the wire format for that is
//     already live-captured in this repo's
//     app/api/onshape/partstudio-add-derive-debug/route.ts, including
//     the confirmed `namespace: "{documentId}::m{microversionId}"`
//     convention and an `includeMateConnectors: true` flag -- that
//     capture is of Onshape's native "Derive" feature, not a custom one,
//     but proves the underlying REST wire format works; a custom
//     feature would need the equivalent FeatureScript-level construct,
//     which is the part genuinely unconfirmed here).
//
// (2) MATE-CONNECTOR-BASED ALIGNMENT.
//     alignAlternativeToCurrent() below reads ONE owned Mate Connector
//     off "Current component" and ONE off whichever alternative is
//     active, then builds a Transform that maps the alternative's
//     connector frame onto the current one's -- so switching candidates
//     never relies on bounding-box centers or any other silently-wrong-
//     if-the-part-changes-shape heuristic, per the explicit requirement
//     this feature was scoped against. qMateConnectorsOfParts() and
//     evMateConnector() are real, documented FeatureScript standard-
//     library calls, but the exact transform-composition helper used
//     here (mapping one CoordSystem onto another via toWorld/inverse) is
//     assembled from general FeatureScript knowledge, not copied from
//     anywhere already confirmed live in this codebase -- unlike, say,
//     opFillet's tangentPropagation flag (proposedFillet.fs), which
//     really was fixed after a live FILLET_FAILED. If this specific
//     composition doesn't compile or doesn't align correctly, the
//     required convention is: give "Current component" and every
//     alternative ONE mate connector each, named/placed consistently
//     (e.g. "Mount"), before testing again -- do not fall back to a
//     bounding-box heuristic, per the original scoping decision.

annotation {
    "Feature Type Name" : "FuzzyCAD Compare Alternatives"
}
export const fuzzycadCompareAlternatives = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation {
            "Name" : "Current component",
            "Filter" : EntityType.BODY,
            "MaxNumberOfPicks" : 1
        }
        definition.currentComponent is Query;

        annotation {
            "Name" : "Alternative A",
            "Filter" : EntityType.BODY,
            "MaxNumberOfPicks" : 1
        }
        definition.alternativeA is Query;

        annotation {
            "Name" : "Include a second alternative",
            "Default" : false
        }
        definition.hasAlternativeB is boolean;

        if (definition.hasAlternativeB)
        {
            annotation {
                "Name" : "Alternative B",
                "Filter" : EntityType.BODY,
                "MaxNumberOfPicks" : 1
            }
            definition.alternativeB is Query;
        }

        // Which candidate is currently shown. Not user-editable in
        // Onshape's own dialog -- the FuzzyCAD right panel is the only
        // intended way to change this, via the existing generic
        // parameterUpdates PATCH path (same mechanism every other
        // hidden-parameter field in this directory already uses).
        annotation {
            "Name" : "Active option",
            "Default" : "CURRENT",
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.activeOption is string;

        // Same hidden-accepted architecture as every other Proposed*/
        // Needs Input* feature: while false, this feature only ever
        // shows a candidate for comparison. Once true, it commits
        // whichever option was active and discards the rest.
        annotation {
            "Name" : "Accepted",
            "Default" : false,
            "UIHint" : UIHint.ALWAYS_HIDDEN
        }
        definition.accepted is boolean;
    }
    {
        if (isQueryEmpty(context, definition.currentComponent) || isQueryEmpty(context, definition.alternativeA))
        {
            return;
        }

        const hasB = definition.hasAlternativeB && !isQueryEmpty(context, definition.alternativeB);

        // -----------------------------------------------------------
        // ACCEPTED STATE
        //
        // Whichever option was active when Accept happened becomes the
        // final, committed geometry. The other candidates are removed
        // from this feature's own output entirely -- there is nothing
        // left to switch between once accepted.
        // -----------------------------------------------------------
        if (definition.accepted)
        {
            if (definition.activeOption == "CURRENT")
            {
                // Current component already exists upstream of this
                // feature (created by whatever feature made it originally)
                // -- nothing to add, nothing to remove, just leave it as
                // is. No opDeleteBodies call here: this feature does not
                // own "Current component" and should never delete
                // another feature's output.
                return;
            }

            const chosenAlternative =
                definition.activeOption == "ALTERNATIVE_B" && hasB
                ? definition.alternativeB
                : definition.alternativeA;

            // Hide the original -- same fade-to-near-zero technique every
            // other Proposed*/Needs Input* feature uses instead of trying
            // to delete a body this feature did not create.
            setProperty(context, {
                    "entities" : definition.currentComponent,
                    "propertyType" : PropertyType.APPEARANCE,
                    "value" : color(0.75, 0.75, 0.75, 0.02)
            });

            placeAlignedCopy(context, id + "acceptedAlternative", definition.currentComponent, chosenAlternative);
            return;
        }

        // -----------------------------------------------------------
        // PENDING STATE: show exactly one candidate, faded/hidden
        // originals for the rest, so only one body reads as "here" at
        // a time even though every candidate technically still exists
        // in the tree for as long as the comparison stays open.
        // -----------------------------------------------------------

        const showingCurrent = definition.activeOption == "CURRENT";
        const showingB = definition.activeOption == "ALTERNATIVE_B" && hasB;
        const showingA = !showingCurrent && !showingB;

        setProperty(context, {
                "entities" : definition.currentComponent,
                "propertyType" : PropertyType.APPEARANCE,
                "value" : showingCurrent ? color(1, 1, 1, 1) : color(0.75, 0.75, 0.75, 0.02)
        });

        if (showingA)
        {
            placeAlignedCopy(context, id + "previewAlternativeA", definition.currentComponent, definition.alternativeA);
        }

        if (hasB && showingB)
        {
            placeAlignedCopy(context, id + "previewAlternativeB", definition.currentComponent, definition.alternativeB);
        }
    });

//////////////////////////////////////////////////////////////////////
//
// MATE-CONNECTOR-ALIGNED PLACEMENT
//
// Duplicates `alternativeBody` (opPattern, zero-offset first) then
// applies a Transform mapping ITS owned mate connector onto
// `currentComponent`'s owned mate connector, so the alternative lands
// exactly where Current sits, at Current's orientation -- not at
// whatever raw position the alternative's own Part Studio happened to
// place it at, and never approximated via a bounding-box center.
//
// Requires exactly one owned Mate Connector on each of the two bodies
// (see the file header's item (2) for the exact convention this
// assumes). Throws a clear regenError instead of silently placing the
// alternative at the wrong spot if either body has zero or more than
// one -- ambiguous which connector should be the placement reference.
//
//////////////////////////////////////////////////////////////////////

function placeAlignedCopy(
    context is Context,
    id is Id,
    currentComponent is Query,
    alternativeBody is Query)
{
    const currentConnectors = evaluateQuery(context, qMateConnectorsOfParts(currentComponent));
    const alternativeConnectors = evaluateQuery(context, qMateConnectorsOfParts(alternativeBody));

    if (size(currentConnectors) != 1)
    {
        throw regenError(
            "\"Current component\" needs exactly one owned Mate Connector to use as its placement reference (found "
            ~ toString(size(currentConnectors))
            ~ "). Add one Mate Connector to the current component before comparing alternatives.",
            currentComponent
        );
    }

    if (size(alternativeConnectors) != 1)
    {
        throw regenError(
            "This alternative needs exactly one owned Mate Connector at its mounting reference (found "
            ~ toString(size(alternativeConnectors))
            ~ "). Add one Mate Connector to the alternative's source Part Studio, at the same mounting point Current component uses, before comparing.",
            alternativeBody
        );
    }

    const currentFrame = evMateConnector(context, { "mateConnector" : currentConnectors[0] });
    const alternativeFrame = evMateConnector(context, { "mateConnector" : alternativeConnectors[0] });

    // Maps a point/direction expressed in the alternative connector's
    // local frame into world space, then out of world space into the
    // current connector's local frame -- net effect: the alternative's
    // connector ends up exactly where the current connector already is.
    const alignment = toWorld(currentFrame) * inverse(toWorld(alternativeFrame));

    opPattern(context, id + "duplicate", {
            "entities" : alternativeBody,
            "transforms" : [alignment],
            "instanceNames" : ["aligned"]
    });
}
