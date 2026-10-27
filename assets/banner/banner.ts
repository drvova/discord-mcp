// The animated README banner, authored with Clayzo.
//
//   node banner.ts                      writes banner.json and validates it (no account needed)
//   npx clayzo export banner.json ../img/banner.svg --format svg
//                                       renders it (needs `npx clayzo login`)
//
// Only geometry (monoline and pixel wordmarks, shapes): no font text, so the
// animated SVG export draws it exactly as the engine does.

import { writeFileSync } from "node:fs";
import {
    ANIMATION_DOCUMENT_VERSION,
    arcVertices,
    assertValidAnimationDocument,
    base,
    cellWordmark,
    constant,
    fill,
    hex,
    keyed,
    marker,
    monolineWordmark,
    stroke,
    trim,
    withComputedRevision,
    type SceneNode,
    type Vec3,
} from "@clayzo/animation";

const WIDTH = 1280;
const HEIGHT = 400;
const FPS = 30;
const END = 8 * FPS; // 8 s loop

const BACKGROUND = hex("#0B0D17");
const INK = hex("#F5F6FF");
const BLURPLE = hex("#5865F2");
const SOFT = hex("#A5B4FC");
const DIM = hex("#2A2F4A");

// Easings: a quick, settled ease-out, and a gentle in-out.
const OUT = { x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 };
const IN_OUT = { x1: 0.45, y1: 0, x2: 0.55, y2: 1 };

// Everything fades out together just before the loop point, so the last
// frame (empty background) leads straight into the first.
const FADE_START = END - 24;
const fadeOut = (id: string, from = 1) =>
    keyed<number>(id, [[0, from], [FADE_START, from, IN_OUT], [END - 4, 0]]);

const nodes: Record<string, SceneNode> = {};
const order: string[] = [];
const add = (node: SceneNode) => {
    nodes[node.id] = node;
    order.push(node.id);
};

// 0. The card: the SVG export doesn't paint the canvas colour, so draw it,
// or the light ink would vanish on GitHub's light theme.
add({
    ...base("card", { outTick: END, x: WIDTH / 2, y: HEIGHT / 2 }),
    type: "rect",
    size: constant({ width: WIDTH, height: HEIGHT }),
    cornerRadius: constant(24),
    style: { fill: fill(BACKGROUND) },
});

// 1. "DISCORD MCP": each letter draws on in turn, "MCP" in blurple. Spaces
// aren't letters in a wordmark, so "MCP" is the last three.
const word = monolineWordmark("DISCORD MCP", { capHeight: 92, polyline: true });
const WORD_Y = 138;
word.letters.forEach((letter, index) => {
    if (letter.contours.length === 0) {
        return;
    }
    const start = 8 + index * 5;
    const id = `word.letter-${index}`;
    add({
        ...base(id, { outTick: END, x: WIDTH / 2, y: WORD_Y }),
        type: "path",
        path: constant({ contours: [...letter.contours] }),
        style: {
            stroke: stroke(index >= word.letters.length - 3 ? BLURPLE : INK, word.stroke, {
                opacity: fadeOut(`${id}.opacity`),
            }),
        },
        operators: [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[start, 0, OUT], [start + 22, 1]]) })],
    });
});

// 2. The tagline in a pixel face, each letter popping up and in.
const tagline = cellWordmark("ONE TOOL. YOUR CODE. IT REMEMBERS.", { cell: 4, gap: 1, face: "3x5" });
const TAG_Y = 236;
tagline.letters.forEach((letter, index) => {
    if (letter.contours.length === 0) {
        return;
    }
    const start = 70 + index * 2;
    const id = `tagline.letter-${index}`;
    add({
        ...base(id, {
            outTick: END,
            inTick: start,
            position: keyed<Vec3>(`${id}.position`, [
                [start, { x: WIDTH / 2, y: TAG_Y + 10, z: 0 }, OUT],
                [start + 12, { x: WIDTH / 2, y: TAG_Y, z: 0 }],
            ]),
        }),
        type: "path",
        path: constant({ contours: [...letter.contours] }),
        style: {
            fill: fill(SOFT, keyed(`${id}.opacity`, [[start, 0, OUT], [start + 12, 1], [FADE_START, 1, IN_OUT], [END - 4, 0]])),
        },
    });
});

// 3. The request path: model -> run -> agent -> discord, with a pulse.
const FLOW_Y = 326;
const stations = [
    { label: "MODEL", x: 380 },
    { label: "RUN", x: 560 },
    { label: "AGENT", x: 740 },
    { label: "DISCORD", x: 920 },
];
const FLOW_IN = 104;

add({
    ...base("flow.line", { outTick: END, inTick: FLOW_IN, x: 0, y: 0 }),
    type: "path",
    path: constant({
        contours: [
            {
                closed: false,
                vertices: [
                    { point: { x: stations[0].x, y: FLOW_Y }, inTangent: { x: 0, y: 0 }, outTangent: { x: 0, y: 0 } },
                    { point: { x: stations[3].x, y: FLOW_Y }, inTangent: { x: 0, y: 0 }, outTangent: { x: 0, y: 0 } },
                ],
            },
        ],
    }),
    style: { stroke: stroke(DIM, 3, { opacity: fadeOut("flow.line.opacity") }) },
    operators: [trim("flow.line.trim", { end: keyed("flow.line.end", [[FLOW_IN, 0, OUT], [FLOW_IN + 30, 1]]) })],
});

stations.forEach((station, index) => {
    const start = FLOW_IN + index * 8;
    const ring = `flow.station-${index}`;
    add({
        ...base(ring, { outTick: END, inTick: start, x: station.x, y: FLOW_Y }),
        type: "path",
        path: constant({ contours: [{ closed: false, vertices: arcVertices({ x: 0, y: 0 }, 9, -90, 270, { polyline: true }) }] }),
        style: { stroke: stroke(index === 3 ? BLURPLE : SOFT, 3, { opacity: fadeOut(`${ring}.opacity`) }) },
        operators: [trim(`${ring}.trim`, { end: keyed(`${ring}.end`, [[start, 0, OUT], [start + 14, 1]]) })],
    });

    const label = cellWordmark(station.label, { cell: 3, gap: 1, face: "3x5" });
    const labelId = `flow.label-${index}`;
    add({
        ...base(labelId, { outTick: END, inTick: start + 6, x: station.x, y: FLOW_Y + 30 }),
        type: "path",
        path: constant(label.path),
        style: {
            fill: fill(index === 3 ? BLURPLE : SOFT, keyed(`${labelId}.opacity`, [
                [start + 6, 0, OUT],
                [start + 18, 0.75],
                [FADE_START, 0.75, IN_OUT],
                [END - 4, 0],
            ])),
        },
    });
});

// The pulse: a request travelling from the model to Discord, twice.
const PULSE_STARTS = [FLOW_IN + 40, FLOW_IN + 82];
const pulseKeys: Array<[number, Vec3, typeof IN_OUT?]> = [];
const pulseOpacity: Array<[number, number, typeof IN_OUT?]> = [];
for (const start of PULSE_STARTS) {
    pulseKeys.push([start, { x: stations[0].x, y: FLOW_Y, z: 0 }, IN_OUT]);
    pulseKeys.push([start + 36, { x: stations[3].x, y: FLOW_Y, z: 0 }]);
    pulseOpacity.push([start, 0, OUT], [start + 4, 1], [start + 32, 1, OUT], [start + 38, 0]);
}
add({
    ...base("flow.pulse", {
        outTick: END,
        inTick: PULSE_STARTS[0],
        position: keyed<Vec3>("flow.pulse.position", pulseKeys.map(([tick, value, ease]) => (ease ? [tick, value, ease] : [tick, value]))),
    }),
    type: "ellipse",
    size: constant({ width: 12, height: 12 }),
    style: { fill: fill(BLURPLE, keyed("flow.pulse.opacity", pulseOpacity.map(([tick, value, ease]) => (ease ? [tick, value, ease] : [tick, value])))) },
});

const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: "discord-mcp-banner",
    name: "discord-mcp README banner",
    canvas: { width: WIDTH, height: HEIGHT, pixelAspectRatio: 1, backgroundColor: BACKGROUND },
    timing: {
        ticksPerSecond: FPS,
        frameRate: { numerator: FPS, denominator: 1 },
        durationTicks: END,
        displayStartTick: 0,
    },
    assets: {},
    compositions: {
        main: {
            id: "main",
            name: "Banner",
            width: WIDTH,
            height: HEIGHT,
            durationTicks: END,
            nodes,
            rootNodeIds: order,
        },
    },
    rootCompositionId: "main",
    components: {},
    markers: [
        marker("wordmark", 8, { name: "Wordmark draws on", durationTicks: 70 }),
        marker("tagline", 70, { name: "Tagline", durationTicks: 40 }),
        marker("flow", FLOW_IN, { name: "Request path", durationTicks: 124 }),
        marker("fade", FADE_START, { name: "Fade to loop", durationTicks: 24 }),
    ],
    design: {
        description: "discord-mcp: one tool that runs code; requests flow model -> run -> agent -> Discord.",
        accessibilityLabel:
            "discord-mcp. One tool. Your code. It remembers. A request travels from the model through the run tool and the agent to Discord.",
        tokens: { looping: true },
    },
    capabilities: { required: [], optional: [], unsupportedPolicy: "error" },
});

assertValidAnimationDocument(document);
writeFileSync(new URL("./banner.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
console.log(`banner.json: ${order.length} nodes, ${END} ticks at ${FPS} fps, revision ${document.revision}`);
