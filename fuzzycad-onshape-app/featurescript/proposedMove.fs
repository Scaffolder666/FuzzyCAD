FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");


annotation { "Feature Type Name" : "FuzzyCAD Proposed Move" }
export const fuzzycadProposedMove = defineFeature(function(
        context is Context,
        id is Id,
        definition is map)

    precondition
    {
        annotation {
            "Name" : "Body to move",
            "Filter" : EntityType.BODY
        }
        definition.body is Query;


        annotation { "Name" : "Move X" }
        isLength(definition.moveX, LENGTH_BOUNDS);


        annotation { "Name" : "Move Y" }
        isLength(definition.moveY, LENGTH_BOUNDS);


        annotation { "Name" : "Move Z" }
        isLength(definition.moveZ, LENGTH_BOUNDS);


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

        const offset = vector(
            definition.moveX,
            definition.moveY,
            definition.moveZ
        );


        //////////////////////////////////////////////////////////////////
        //
        // ACCEPTED STATE
        //
        // Once the right panel changes accepted = true,
        // the proposal visualization disappears and the actual
        // CAD body is moved.
        //
        //////////////////////////////////////////////////////////////////

        if (definition.accepted)
        {
            opTransform(context, id + "acceptedMove", {
                "bodies" : originalBody,
                "transform" : transform(offset)
            });

            return;
        }



        //////////////////////////////////////////////////////////////////
        //
        // PENDING STATE
        //
        //////////////////////////////////////////////////////////////////


        //////////////////////////////////////////////////////////////////
        // 1. Fade the ORIGINAL body
        //////////////////////////////////////////////////////////////////

        setProperty(context, {
            "entities" : originalBody,
            "propertyType" : PropertyType.APPEARANCE,
            "value" : color(
                0.75,
                0.75,
                0.75,
                0.08
            )
        });



        //////////////////////////////////////////////////////////////////
        // 2. Create a TEMPORARY moved copy
        //
        // We need this solid only so we can obtain the exact proposed
        // edges at the proposed location.
        //
        // It will be deleted at the end of the feature.
        //////////////////////////////////////////////////////////////////

        opPattern(context, id + "duplicate", {
            "entities" : originalBody,
            "transforms" : [
                transform(offset)
            ],
            "instanceNames" : [
                "proposed"
            ]
        });


        const proposedBody =
            qCreatedBy(
                id + "duplicate",
                EntityType.BODY
            );


        const proposedEdges =
            qCreatedBy(
                id + "duplicate",
                EntityType.EDGE
            );



        //////////////////////////////////////////////////////////////////
        // 3. HAND-DRAWN / SKETCHY PROPOSAL
        //
        // Same principle as the old FuzzyCAD implementation:
        //
        // exact edge
        //      ↓
        // sample many points
        //      ↓
        // independently jitter every point
        //      ↓
        // fit spline
        //      ↓
        // repeat 2–4 times per edge
        //
        //////////////////////////////////////////////////////////////////

        const chordLength =
            3 * millimeter;

        const variance =
            0.5 * millimeter;


        var rnd =
            RandomNumberFunction(id);


        var allSketchyStrokes =
            qNothing();


        var edgeIndex = 0;


        for (
            var edgeQuery
            in evaluateQuery(context, proposedEdges))
        {
            const strokes =
                handDrawEdgeSketchy(
                    context,
                    id + (
                        "sketchyEdge"
                        ~ toString(edgeIndex)
                    ),
                    chordLength,
                    variance,
                    rnd,
                    edgeQuery
                );


            allSketchyStrokes =
                qUnion(
                    allSketchyStrokes,
                    strokes
                );


            edgeIndex += 1;
        }



        //////////////////////////////////////////////////////////////////
        // 4. Combine sketchy strokes into one composite
        //////////////////////////////////////////////////////////////////

        if (!isQueryEmpty(context, allSketchyStrokes))
        {
            opCreateCompositePart(
                context,
                id + "sketchyComposite",
                {
                    "bodies" :
                        allSketchyStrokes,

                    "closed" :
                        false
                }
            );


            setProperty(context, {
                "entities" :
                    qCreatedBy(
                        id + "sketchyComposite",
                        EntityType.BODY
                    ),

                "propertyType" :
                    PropertyType.APPEARANCE,

                "value" :
                    color(
                        0.25,
                        0.55,
                        0.95,
                        1.0
                    )
            });
        }



        //////////////////////////////////////////////////////////////////
        // 5. Movement arrows
        //////////////////////////////////////////////////////////////////

        const arrowColor =
            color(
                0.25,
                0.55,
                0.95,
                1.0
            );


        const bbox =
            evBox3d(
                context,
                {
                    "topology" :
                        originalBody,

                    "tight" :
                        true
                }
            );


        const bboxCenter =
            vector(
                (
                    bbox.minCorner[0]
                    +
                    bbox.maxCorner[0]
                ) / 2,

                (
                    bbox.minCorner[1]
                    +
                    bbox.maxCorner[1]
                ) / 2,

                (
                    bbox.minCorner[2]
                    +
                    bbox.maxCorner[2]
                ) / 2
            );



        drawAxisArrow(
            context,
            id + "arrowX",
            bboxCenter,

            vector(
                definition.moveX,
                0 * meter,
                0 * meter
            ),

            "X",
            arrowColor
        );



        drawAxisArrow(
            context,
            id + "arrowY",
            bboxCenter,

            vector(
                0 * meter,
                definition.moveY,
                0 * meter
            ),

            "Y",
            arrowColor
        );



        drawAxisArrow(
            context,
            id + "arrowZ",
            bboxCenter,

            vector(
                0 * meter,
                0 * meter,
                definition.moveZ
            ),

            "Z",
            arrowColor
        );



        //////////////////////////////////////////////////////////////////
        // 6. DELETE THE TEMPORARY EXACT PROPOSED SOLID
        //
        // THIS removes the black native CAD edge you were seeing.
        //
        // The sketchy strokes and arrows are independent wire bodies,
        // so they remain.
        //////////////////////////////////////////////////////////////////

        opDeleteBodies(
            context,
            id + "deleteTemporaryProposal",
            {
                "entities" :
                    proposedBody
            }
        );
    });



//////////////////////////////////////////////////////////////////////
//
// HAND-DRAWN EDGE
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
    //////////////////////////////////////////////////////////////////
    // Determine edge length
    //////////////////////////////////////////////////////////////////

    var edgeLength =
        evLength(
            context,
            {
                "entities" :
                    edgeQuery
            }
        );


    //////////////////////////////////////////////////////////////////
    // Number of sample points
    //
    // Short edges still get at least five samples.
    //////////////////////////////////////////////////////////////////

    var pointCount =
        ceil(
            max(
                edgeLength / chordLength,
                5
            )
        );


    //////////////////////////////////////////////////////////////////
    // Sample the exact CAD edge
    //////////////////////////////////////////////////////////////////

    var tangents =
        @evEdgeTangentLines(
            context,
            {
                "edge" :
                    edgeQuery,

                "parameters" :
                    range(
                        0.0,
                        1.0,
                        pointCount
                    )
            }
        );


    //////////////////////////////////////////////////////////////////
    // Randomly choose 2, 3, or 4 strokes
    //////////////////////////////////////////////////////////////////

    var rawRandom =
        rnd() % 100;


    var numStrokes =
        2
        +
        floor(
            rawRandom / 33
        );


    var strokesQuery =
        qNothing();



    //////////////////////////////////////////////////////////////////
    // Create each hand-drawn stroke
    //////////////////////////////////////////////////////////////////

    for (
        var strokeIndex = 0;
        strokeIndex < numStrokes;
        strokeIndex += 1)
    {
        var newPoints =
            makeArray(
                pointCount,
                undefined
            );



        //////////////////////////////////////////////////////////////
        // Jitter every sampled point independently
        //////////////////////////////////////////////////////////////

        for (
            var i = 0;
            i < pointCount;
            i += 1)
        {
            // IMPORTANT:
            //
            // In the current FeatureScript version, .origin already
            // carries length units.
            //
            // Do NOT multiply this by meter.
            var basePt =
                tangents[i].origin as Vector;


            var s1 =
                rnd();


            var s2 =
                rnd();



            //////////////////////////////////////////////////////////
            // Random jitter strength from 0.5 → 1.0
            //////////////////////////////////////////////////////////

            var jitterFactor =
                0.5
                +
                (
                    (s2 % 100)
                    /
                    100.0
                )
                *
                0.5;



            //////////////////////////////////////////////////////////
            // Independent XYZ offsets
            //////////////////////////////////////////////////////////

            var offsetX =
                2
                *
                (
                    (
                        (
                            s1
                            +
                            i * 17
                            +
                            strokeIndex * 29
                        )
                        %
                        100
                    )
                    /
                    100.0
                    -
                    0.5
                )
                *
                variance
                *
                jitterFactor;



            var offsetY =
                2
                *
                (
                    (
                        (
                            s1
                            +
                            i * 23
                            +
                            strokeIndex * 37
                        )
                        %
                        100
                    )
                    /
                    100.0
                    -
                    0.5
                )
                *
                variance
                *
                jitterFactor;



            var offsetZ =
                2
                *
                (
                    (
                        (
                            s1
                            +
                            i * 31
                            +
                            strokeIndex * 41
                        )
                        %
                        100
                    )
                    /
                    100.0
                    -
                    0.5
                )
                *
                variance
                *
                jitterFactor;



            //////////////////////////////////////////////////////////
            // Apply jitter
            //////////////////////////////////////////////////////////

            var perturbed =
                basePt;


            perturbed[0] +=
                offsetX;


            perturbed[1] +=
                offsetY;


            perturbed[2] +=
                offsetZ;


            newPoints[i] =
                perturbed;
        }



        //////////////////////////////////////////////////////////////
        // Create one spline stroke
        //////////////////////////////////////////////////////////////

        const strokeId =
            id
            +
            (
                "_stroke"
                ~
                toString(
                    strokeIndex
                )
            );


        opFitSpline(
            context,
            strokeId,
            {
                "points" :
                    newPoints
            }
        );


        strokesQuery =
            qUnion(
                strokesQuery,

                qCreatedBy(
                    strokeId,
                    EntityType.BODY
                )
            );
    }


    return strokesQuery;
}



//////////////////////////////////////////////////////////////////////
//
// FILLED AXIS ARROW
//
// Based on the straight-arrow construction from the reference Arrow
// FeatureScript:
//
//     closed 2D arrow profile
//              ↓
//        qSketchRegion
//              ↓
//       opExtractSurface
//              ↓
//        colored surface
//
// The arrow automatically aligns itself with axisOffset.
//
//////////////////////////////////////////////////////////////////////

function drawAxisArrow(
    context is Context,
    id is Id,
    start is Vector,
    axisOffset is Vector,
    axisName is string,
    arrowColor is map)
{
    //////////////////////////////////////////////////////////////////
    // 1. Movement distance
    //////////////////////////////////////////////////////////////////

    const distance =
        norm(axisOffset);

    const distanceMm =
        distance / millimeter;


    if (distanceMm < 0.001)
    {
        return;
    }


    //////////////////////////////////////////////////////////////////
    // 2. Arrow direction
    //////////////////////////////////////////////////////////////////

    const direction =
        normalize(axisOffset);


    //////////////////////////////////////////////////////////////////
    // 3. Construct a stable plane containing the arrow
    //
    // The local X direction of this plane = movement direction.
    //
    // We first choose a world reference direction that is not parallel
    // to the movement direction, then generate a plane normal.
    //////////////////////////////////////////////////////////////////

    const reference =
        (abs(direction[2]) < 0.9)
        ?
        vector(0, 0, 1)
        :
        vector(0, 1, 0);


    const planeNormal =
        normalize(
            cross(
                direction,
                reference
            )
        );


    const arrowPlane =
        plane(
            start,
            planeNormal,
            direction
        );


    //////////////////////////////////////////////////////////////////
    // 4. Automatically scale arrow dimensions
    //
    // width       = thickness of shaft
    // headLength  = length of triangular arrow head
    // headWidth   = total width of arrow head
    //////////////////////////////////////////////////////////////////

    // Bumped up again (shaftWidth 1.0-3.5mm -> 2.5-7mm, headLength cap
    // 12mm -> 24mm, headWidth = shaftWidth*4 -> *4.5) per explicit
    // feedback: "I want people to see at a glance where this moved to."
    const shaftWidth =
        min(
            max(
                distanceMm * 0.12,
                2.5
            ),
            7
        )
        * millimeter;


    const headLength =
        min(
            distanceMm * 0.5,
            24
        )
        * millimeter;


    const headWidth =
        shaftWidth * 4.5;



    //////////////////////////////////////////////////////////////////
    // 5. Create arrow sketch
    //////////////////////////////////////////////////////////////////

    const arrowSketch =
        newSketchOnPlane(
            context,
            id + "arrowSketch",
            {
                "sketchPlane" :
                    arrowPlane
            }
        );


    //////////////////////////////////////////////////////////////////
    // The profile looks like:
    //
    //
    //                          TIP
    //                           >
    //                         / |
    //                       /   |
    //   ===================     |
    //   ===================     |
    //                       \   |
    //                         \ |
    //                           >
    //
    //
    // local sketch X = movement direction
    //////////////////////////////////////////////////////////////////


    //////////////////////////////////////////////////////////////////
    // Upper arrowhead edge
    //////////////////////////////////////////////////////////////////

    skLineSegment(
        arrowSketch,
        "headUpper",
        {
            "start" :
                vector(
                    distance,
                    0 * meter
                ),

            "end" :
                vector(
                    distance - headLength,
                    headWidth / 2
                )
        }
    );


    //////////////////////////////////////////////////////////////////
    // Lower arrowhead edge
    //////////////////////////////////////////////////////////////////

    skLineSegment(
        arrowSketch,
        "headLower",
        {
            "start" :
                vector(
                    distance,
                    0 * meter
                ),

            "end" :
                vector(
                    distance - headLength,
                    -headWidth / 2
                )
        }
    );


    //////////////////////////////////////////////////////////////////
    // Transition from arrowhead → narrow shaft
    //////////////////////////////////////////////////////////////////

    skLineSegment(
        arrowSketch,
        "headUpperTransition",
        {
            "start" :
                vector(
                    distance - headLength,
                    headWidth / 2
                ),

            "end" :
                vector(
                    distance - headLength,
                    shaftWidth / 2
                )
        }
    );


    skLineSegment(
        arrowSketch,
        "headLowerTransition",
        {
            "start" :
                vector(
                    distance - headLength,
                    -headWidth / 2
                ),

            "end" :
                vector(
                    distance - headLength,
                    -shaftWidth / 2
                )
        }
    );


    //////////////////////////////////////////////////////////////////
    // Upper shaft
    //////////////////////////////////////////////////////////////////

    skLineSegment(
        arrowSketch,
        "shaftUpper",
        {
            "start" :
                vector(
                    distance - headLength,
                    shaftWidth / 2
                ),

            "end" :
                vector(
                    0 * meter,
                    shaftWidth / 2
                )
        }
    );


    //////////////////////////////////////////////////////////////////
    // Lower shaft
    //////////////////////////////////////////////////////////////////

    skLineSegment(
        arrowSketch,
        "shaftLower",
        {
            "start" :
                vector(
                    distance - headLength,
                    -shaftWidth / 2
                ),

            "end" :
                vector(
                    0 * meter,
                    -shaftWidth / 2
                )
        }
    );


    //////////////////////////////////////////////////////////////////
    // Close the back of the arrow
    //////////////////////////////////////////////////////////////////

    skLineSegment(
        arrowSketch,
        "shaftBack",
        {
            "start" :
                vector(
                    0 * meter,
                    shaftWidth / 2
                ),

            "end" :
                vector(
                    0 * meter,
                    -shaftWidth / 2
                )
        }
    );


    //////////////////////////////////////////////////////////////////
    // Solve closed arrow profile
    //////////////////////////////////////////////////////////////////

    skSolve(
        arrowSketch
    );



    //////////////////////////////////////////////////////////////////
    // 6. Convert closed arrow sketch into a planar surface
    //
    // This is the important part copied conceptually from your
    // reference Arrow FeatureScript.
    //////////////////////////////////////////////////////////////////

    opExtractSurface(
        context,
        id + "arrowSurface",
        {
            "faces" :
                qSketchRegion(
                    id + "arrowSketch"
                ),

            "offset" :
                0 * meter,

            "useFacesAroundToTrimOffset" :
                false
        }
    );



    //////////////////////////////////////////////////////////////////
    // 7. Delete construction sketch
    //
    // Keep only the extracted arrow surface.
    //////////////////////////////////////////////////////////////////

    opDeleteBodies(
        context,
        id + "deleteArrowSketch",
        {
            "entities" :
                qCreatedBy(
                    id + "arrowSketch"
                )
        }
    );



    //////////////////////////////////////////////////////////////////
    // 8. Give arrow the same proposal color
    //////////////////////////////////////////////////////////////////

    setProperty(
        context,
        {
            "entities" :
                qCreatedBy(
                    id + "arrowSurface",
                    EntityType.BODY
                ),

            "propertyType" :
                PropertyType.APPEARANCE,

            "value" :
                arrowColor
        }
    );



    //////////////////////////////////////////////////////////////////
    // 9. Text label
    //
    // X: 20 mm
    // Y: 10 mm
    // etc.
    //
    // Keep it on the same plane as the filled arrow.
    //////////////////////////////////////////////////////////////////

    const midPoint =
        start
        +
        axisOffset / 2;


    const labelSketch =
        newSketchOnPlane(
            context,
            id + "labelSketch",
            {
                "sketchPlane" :
                    arrowPlane
            }
        );


    const labelUv =
        worldToPlane(
            arrowPlane,
            midPoint
        );


    //////////////////////////////////////////////////////////////////
    // Push text slightly beside the shaft so it doesn't sit directly
    // on top of the filled arrow.
    //////////////////////////////////////////////////////////////////

    const labelOffset =
        headWidth / 2
        +
        1.5 * millimeter;


    const textHeight =
        2.5 * millimeter;


    skText(
        labelSketch,
        "labelText",
        {
            "text" :
                axisName
                ~ ": "
                ~ toString(
                    round(
                        distanceMm,
                        1
                    )
                )
                ~ " mm",

            "fontName" :
                "OpenSans-Regular.ttf",

            "firstCorner" :
                vector(
                    labelUv[0]
                    - textHeight * 1.5,

                    labelUv[1]
                    + labelOffset
                ),

            "secondCorner" :
                vector(
                    labelUv[0]
                    + textHeight * 1.5,

                    labelUv[1]
                    + labelOffset
                    + textHeight
                )
        }
    );


    skSolve(
        labelSketch
    );
}



//////////////////////////////////////////////////////////////////////
//
// RANDOM NUMBER GENERATOR
//
//////////////////////////////////////////////////////////////////////

function RandomNumberFunction(id)
returns function
{
    return lcprng(
        idToNum(
            id[0]
        )
    );
}



function idToNum(
    input is string)
returns number
{
    const chrMap =
    {
        'A' : 0,
        'B' : 1,
        'C' : 2,
        'D' : 3,
        'E' : 4,
        'F' : 5,
        'G' : 6,
        'H' : 7,
        'I' : 8,
        'J' : 9,
        'K' : 10,
        'L' : 11,
        'M' : 12,
        'N' : 13,
        'O' : 14,
        'P' : 15,
        'Q' : 16,
        'R' : 17,
        'S' : 18,
        'T' : 19,
        'U' : 20,
        'V' : 21,
        'W' : 22,
        'X' : 23,
        'Y' : 24,
        'Z' : 25,

        'a' : 26,
        'b' : 27,
        'c' : 28,
        'd' : 29,
        'e' : 30,
        'f' : 31,
        'g' : 32,
        'h' : 33,
        'i' : 34,
        'j' : 35,
        'k' : 36,
        'l' : 37,
        'm' : 38,
        'n' : 39,
        'o' : 40,
        'p' : 41,
        'q' : 42,
        'r' : 43,
        's' : 44,
        't' : 45,
        'u' : 46,
        'v' : 47,
        'w' : 48,
        'x' : 49,
        'y' : 50,
        'z' : 51,

        '_' : 99,
        '-' : 98
    };


    var out is string =
        "";


    for (
        var char
        in splitIntoCharacters(input))
    {
        var res =
            match(
                char,
                REGEX_NUMBER
            );


        if (res.hasMatch)
        {
            out =
                out
                ~
                toString(
                    res.captures[0]
                );
        }
        else
        {
            out =
                out
                ~
                toString(
                    chrMap[char]
                );
        }
    }


    return
        stringToNumber(out)
        %
        100000;
}



function lcprng(
    seed is number)
returns function
{
    const a =
        1103515245;


    const c =
        12345;


    const m =
        2^31;


    var state =
        new box(seed);


    return function()
    {
        state[] =
            (
                a
                *
                state[]
                +
                c
            )
            %
            m;


        return state[];
    };
}
