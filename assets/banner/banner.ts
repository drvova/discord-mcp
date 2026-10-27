// The animated README banner, authored with Clayzo.
//
//   node banner.ts                      writes banner.json and validates it (no account needed)
//   npx clayzo export banner.json ../img/banner.svg --format svg
//                                       renders it (needs `npx clayzo login`)
//
// Style: Y2K retrofuturism (liquid-chrome lettering, sparkles, an orbit ring,
// iridescent ice/lilac/silver), biomorphic forms (soft gradient blobs that
// morph), and technical sportswear (ripstop grid, stitched seam, registration
// marks, spec-label microtype, a volt pull-tab).
//
// Only geometry, no font text, so the animated SVG export draws it exactly.
// The "garment" (card, grid, seam, marks, labels) is static and the blobs and
// sparkles run in closed cycles, while the wordmark, tagline and request path
// draw on and fade each loop: the last frame leads straight into the first.

import { writeFileSync } from "node:fs";
import {
    ANIMATION_DOCUMENT_VERSION,
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
    type Animatable,
    type Color,
    type GradientFillStyle,
    type PathContour,
    type PathData,
    type SceneNode,
    type Vec3,
} from "@clayzo/animation";

const WIDTH = 1280;
const HEIGHT = 400;
const FPS = 30;
const END = 8 * FPS; // 8 s loop

// Palette.
const GRAPHITE = hex("#07080D");
const CHROME_SHADOW = hex("#232736");
const CHROME = hex("#B9C2D3");
const CHROME_HIGHLIGHT = hex("#FFFFFF");
const IRIS = hex("#7C86FF"); // "MCP": blurple shifted towards iridescent lilac
const IRIS_HIGHLIGHT = hex("#E6E8FF");
const ICE = hex("#9FF0FF");
const LILAC = hex("#C7B8FF");
const SILVER_MUTED = hex("#8E97A8");
const VOLT = hex("#D4FF3A");

const OUT = { x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 };
const IN_OUT = { x1: 0.45, y1: 0, x2: 0.55, y2: 1 };

const FADE_START = END - 24;
// Opacity that holds `level` and fades to 0 just before the loop point.
const fading = (id: string, start: number, level = 1): Animatable<number> =>
    keyed<number>(id, [[start, 0, OUT], [start + 12, level], [FADE_START, level, IN_OUT], [END - 4, 0]]);

const nodes: Record<string, SceneNode> = {};
const order: string[] = [];
const add = (node: SceneNode) => {
    nodes[node.id] = node;
    order.push(node.id);
};

const vertex = (x: number, y: number) => ({ point: { x, y }, inTangent: { x: 0, y: 0 }, outTangent: { x: 0, y: 0 } });
const line = (x1: number, y1: number, x2: number, y2: number): PathContour => ({
    closed: false,
    vertices: [vertex(x1, y1), vertex(x2, y2)],
});
const radial = (stops: Array<[number, Color]>, radius: number): GradientFillStyle => ({
    kind: "radial",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant({ x: 0, y: 0 }),
    end: constant({ x: radius, y: 0 }),
    opacity: constant(1),
});
const chromeGradient = (height: number): GradientFillStyle => ({
    kind: "linear",
    stops: constant([
        { position: 0, color: hex("#FFFFFF") },
        { position: 0.45, color: hex("#8E97A8") },
        { position: 0.55, color: hex("#6B7487") },
        { position: 1, color: hex("#F2F5FA") },
    ]),
    start: constant({ x: 0, y: -height / 2 }),
    end: constant({ x: 0, y: height / 2 }),
    opacity: constant(1),
});
// Pixel-face microtype, left-aligned at `left` (cellWordmark centres on 0).
const microtype = (id: string, text: string, left: number, y: number, color: Color, opacity = 0.55) => {
    const label = cellWordmark(text, { cell: 2.5, gap: 0.5, face: "3x5" });
    add({
        ...base(id, { outTick: END, x: left + label.width / 2, y }),
        type: "path",
        path: constant(label.path),
        style: { fill: fill(color, opacity) },
    });
    return label.width;
};

// --- The garment: card, ripstop grid, stitched seam, registration marks ---

add({
    ...base("card", { outTick: END, x: WIDTH / 2, y: HEIGHT / 2 }),
    type: "rect",
    size: constant({ width: WIDTH, height: HEIGHT }),
    cornerRadius: constant(28),
    style: { fill: fill(GRAPHITE) },
});

// Ripstop: a fine grid with a heavier thread every fourth line.
const gridLines = (every: number, step: number) => {
    const contours: PathContour[] = [];
    for (let x = step; x < WIDTH; x += step) {
        if (Math.round(x / step) % every === 0 || every === 1) {
            contours.push(line(x, 0, x, HEIGHT));
        }
    }
    for (let y = step; y < HEIGHT; y += step) {
        if (Math.round(y / step) % every === 0 || every === 1) {
            contours.push(line(0, y, WIDTH, y));
        }
    }
    return { contours } satisfies PathData;
};
add({
    ...base("ripstop.fine", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(gridLines(1, 16)),
    style: { stroke: stroke(CHROME_HIGHLIGHT, 0.6, { opacity: 0.025 }) },
});
add({
    ...base("ripstop.thread", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(gridLines(4, 16)),
    style: { stroke: stroke(CHROME_HIGHLIGHT, 1, { opacity: 0.05 }) },
});

// Biomorphic blobs: smooth closed forms that breathe through three shapes and
// back, glowing from their centres.
const blobPath = (radius: number, wobble: readonly number[], turn: number): PathData => {
    const count = wobble.length;
    const handle = (4 / 3) * Math.tan(Math.PI / (2 * count));
    const vertices = wobble.map((w, index) => {
        const angle = ((index / count) * 360 + turn) * (Math.PI / 180);
        const r = radius * (1 + w);
        const tangent = { x: -Math.sin(angle) * r * handle, y: Math.cos(angle) * r * handle };
        return {
            point: { x: Math.cos(angle) * r, y: Math.sin(angle) * r },
            inTangent: { x: -tangent.x, y: -tangent.y },
            outTangent: tangent,
        };
    });
    return { contours: [{ closed: true, vertices }] };
};
const blob = (
    id: string,
    x: number,
    y: number,
    radius: number,
    shapes: ReadonlyArray<readonly number[]>,
    stops: Array<[number, Color]>,
    drift: { x: number; y: number },
    outline: Color,
) => {
    const third = END / 3;
    const [a, b, c] = shapes.map((wobble, index) => blobPath(radius, wobble, index * 18));
    add({
        ...base(id, {
            outTick: END,
            position: keyed<Vec3>(`${id}.position`, [
                [0, { x, y, z: 0 }, IN_OUT],
                [END / 2, { x: x + drift.x, y: y + drift.y, z: 0 }, IN_OUT],
                [END, { x, y, z: 0 }],
            ]),
        }),
        type: "path",
        path: keyed<PathData>(`${id}.path`, [[0, a, IN_OUT], [third, b, IN_OUT], [2 * third, c, IN_OUT], [END, a]]),
        // The glow ends inside the shape (padding with its transparent last
        // stop) so it dissolves softly; a fine contour line carries the
        // organic, morphing form.
        style: { gradientFill: radial(stops, radius * 0.86), stroke: stroke(outline, 1.2, { opacity: 0.42 }) },
    });
};
blob(
    "blob.lilac",
    330,
    176,
    150,
    [[0.08, -0.06, 0.12, -0.04, 0.1, -0.08], [-0.05, 0.12, -0.04, 0.1, -0.08, 0.06], [0.1, 0.02, -0.1, 0.12, 0.0, -0.04]],
    [[0, hex("#C7B8FFB0")], [0.55, hex("#5865F240")], [1, hex("#5865F200")]],
    { x: 18, y: -10 },
    LILAC,
);
blob(
    "blob.ice",
    985,
    150,
    120,
    [[-0.06, 0.1, -0.02, 0.12, -0.08, 0.04], [0.12, -0.04, 0.08, -0.08, 0.1, -0.02], [0.0, 0.08, 0.1, -0.06, 0.06, 0.1]],
    [[0, hex("#9FF0FFA0")], [0.5, hex("#7C86FF40")], [1, hex("#7C86FF00")]],
    { x: -14, y: 12 },
    ICE,
);
blob(
    "blob.satellite",
    1110,
    286,
    44,
    [[0.1, -0.08, 0.06, -0.1, 0.12, 0.0], [-0.08, 0.1, -0.06, 0.08, -0.02, 0.1], [0.04, 0.1, -0.1, 0.02, 0.08, -0.06]],
    [[0, hex("#D4FF3A70")], [0.6, hex("#D4FF3A20")], [1, hex("#D4FF3A00")]],
    { x: 10, y: -8 },
    VOLT,
);

// The seam: a dashed stitch inset from the edge, crawling by whole dash
// periods per loop so it is seamless.
const STITCH = [7, 5];
add({
    ...base("seam", { outTick: END, x: WIDTH / 2, y: HEIGHT / 2 }),
    type: "rect",
    size: constant({ width: WIDTH - 28, height: HEIGHT - 28 }),
    cornerRadius: constant(18),
    style: {
        stroke: stroke(CHROME, 1.2, {
            opacity: 0.32,
            dash: STITCH,
            dashOffset: keyed("seam.offset", [[0, 0, "linear"], [END, -12 * 8]]),
        }),
    },
});

// Registration marks in the corners.
for (const [index, [x, y]] of [[44, 44], [WIDTH - 44, 44], [44, HEIGHT - 44], [WIDTH - 44, HEIGHT - 44]].entries()) {
    add({
        ...base(`mark-${index}`, { outTick: END, x, y }),
        type: "path",
        path: constant({ contours: [line(-9, 0, 9, 0), line(0, -9, 0, 9)] }),
        style: { stroke: stroke(CHROME, 1.2, { opacity: 0.45, cap: "butt" }) },
    });
    add({
        ...base(`mark-${index}.ring`, { outTick: END, x, y }),
        type: "ellipse",
        size: constant({ width: 10, height: 10 }),
        style: { stroke: stroke(CHROME, 1, { opacity: 0.35 }) },
    });
}

// Spec-label microtype, like the print on a jacket's inner tag.
microtype("spec.model", "DMCP-01 / MCP TOOL SHELL", 64, 42, CHROME);
const specRight = cellWordmark("1 TOOL - NODE 22 - API V10", { cell: 2.5, gap: 0.5, face: "3x5" });
microtype("spec.build", "1 TOOL - NODE 22 - API V10", WIDTH - 64 - specRight.width, 42, CHROME);
microtype("spec.care", "KEEP TOKENS DRY. RUN SANDBOXED.", 64, HEIGHT - 42, VOLT, 0.7);
const careRight = cellWordmark("MADE OF CODE / KEPT ACROSS RESTARTS", { cell: 2.5, gap: 0.5, face: "3x5" });
microtype("spec.fabric", "MADE OF CODE / KEPT ACROSS RESTARTS", WIDTH - 64 - careRight.width, HEIGHT - 42, CHROME);

// --- The orbit ring and the liquid-chrome wordmark ---

const WORD_Y = 150;
add({
    ...base("orbit", { outTick: END, inTick: 40, x: WIDTH / 2, y: WORD_Y + 6, rotation: -5, opacity: fading("orbit.opacity", 40, 0.55) }),
    type: "ellipse",
    size: constant({ width: 1040, height: 150 }),
    style: { stroke: stroke(LILAC, 1.2) },
});

// Chrome: an extruded shadow, the body, and a specular highlight riding on
// top, each drawing on together, letter by letter.
const word = monolineWordmark("DISCORD MCP", { capHeight: 96, polyline: true });
word.letters.forEach((letter, index) => {
    if (letter.contours.length === 0) {
        return;
    }
    const isMcp = index >= word.letters.length - 3;
    const start = 10 + index * 5;
    const path = constant<PathData>({ contours: [...letter.contours] });
    const draw = (layer: string) =>
        trim(`word.${index}.${layer}.trim`, { end: keyed(`word.${index}.${layer}.end`, [[start, 0, OUT], [start + 24, 1]]) });
    const layers: Array<[string, Color, number, number]> = [
        ["shadow", CHROME_SHADOW, word.stroke + 6, 5],
        ["body", isMcp ? IRIS : CHROME, word.stroke, 0],
        ["highlight", isMcp ? IRIS_HIGHLIGHT : CHROME_HIGHLIGHT, word.stroke * 0.32, -word.stroke * 0.2],
    ];
    for (const [layer, color, width, offset] of layers) {
        const id = `word.${index}.${layer}`;
        add({
            ...base(id, { outTick: END, x: WIDTH / 2, y: WORD_Y + offset }),
            type: "path",
            path,
            style: { stroke: stroke(color, width, { opacity: fading(`${id}.opacity`, start) }) },
            operators: [draw(layer)],
        });
    }
});

// Sparkles: four-point stars that twinkle twice a loop, from and back to nothing.
const sparkles: Array<[number, number, number, number, Color]> = [
    [212, 88, 18, 34, CHROME_HIGHLIGHT],
    [1088, 92, 14, 52, ICE],
    [905, 212, 10, 96, CHROME_HIGHLIGHT],
    [402, 216, 12, 128, LILAC],
    [760, 76, 9, 150, ICE],
    [600, 230, 8, 186, CHROME_HIGHLIGHT],
];
sparkles.forEach(([x, y, size, at, color], index) => {
    const id = `sparkle-${index}`;
    const zero = { x: 0, y: 0, z: 1 };
    const full = { x: 1, y: 1, z: 1 };
    const second = (at + 120) % (END - 30);
    const keys = [
        [Math.min(at, second), zero, OUT],
        [Math.min(at, second) + 8, full, IN_OUT],
        [Math.min(at, second) + 18, zero],
        [Math.max(at, second), zero, OUT],
        [Math.max(at, second) + 8, full, IN_OUT],
        [Math.max(at, second) + 18, zero],
    ] as const;
    add({
        ...base(id, {
            outTick: END,
            x,
            y,
            rotation: keyed<Vec3>(`${id}.spin`, [[0, { x: 0, y: 0, z: 0 }, "linear"], [END, { x: 0, y: 0, z: 90 }]]),
            scale: keyed<Vec3>(`${id}.scale`, [[0, zero], ...keys]),
        }),
        type: "polystar",
        variant: "star",
        points: constant(4),
        innerRadius: constant(size * 0.18),
        outerRadius: constant(size),
        innerRoundness: constant(0),
        outerRoundness: constant(0),
        rotationOffset: constant(0),
        style: { fill: fill(color) },
    });
});

// --- Tagline on a strip of reflective tape ---

const TAPE_Y = 244;
const tagline = cellWordmark("ONE TOOL. YOUR CODE. IT REMEMBERS.", { cell: 4, gap: 1, face: "3x5" });
add({
    ...base("tape", { outTick: END, inTick: 66, x: WIDTH / 2, y: TAPE_Y, opacity: fading("tape.opacity", 66) }),
    type: "rect",
    size: constant({ width: tagline.width + 48, height: 34 }),
    cornerRadius: constant(17),
    style: { gradientFill: chromeGradient(34) },
});
tagline.letters.forEach((letter, index) => {
    if (letter.contours.length === 0) {
        return;
    }
    const start = 72 + index * 2;
    const id = `tagline.${index}`;
    add({
        ...base(id, {
            outTick: END,
            inTick: start,
            position: keyed<Vec3>(`${id}.position`, [
                [start, { x: WIDTH / 2, y: TAPE_Y + 8, z: 0 }, OUT],
                [start + 12, { x: WIDTH / 2, y: TAPE_Y, z: 0 }],
            ]),
        }),
        type: "path",
        path: constant({ contours: [...letter.contours] }),
        style: { fill: fill(GRAPHITE, fading(`${id}.opacity`, start)) },
    });
});

// --- The request path: model -> run -> agent -> discord, as a zip track ---

const FLOW_Y = 306;
const FLOW_IN = 106;
const stations = [
    { label: "MODEL", x: 380 },
    { label: "RUN", x: 560, pullTab: true },
    { label: "AGENT", x: 740 },
    { label: "DISCORD", x: 920 },
];
add({
    ...base("flow.track", { outTick: END, inTick: FLOW_IN, x: 0, y: 0 }),
    type: "path",
    path: constant({ contours: [line(stations[0].x, FLOW_Y, stations[3].x, FLOW_Y)] }),
    // Fades in rather than drawing on: the SVG export can't trim a dashed stroke yet.
    style: { stroke: stroke(SILVER_MUTED, 2, { opacity: fading("flow.track.opacity", FLOW_IN, 0.6), dash: [2, 4], cap: "butt" }) },
});
stations.forEach((station, index) => {
    const start = FLOW_IN + index * 8;
    const id = `flow.station-${index}`;
    add({
        ...base(id, {
            outTick: END,
            inTick: start,
            x: station.x,
            y: FLOW_Y,
            scale: keyed<Vec3>(`${id}.scale`, [[start, { x: 0.6, y: 0.6, z: 1 }, OUT], [start + 12, { x: 1, y: 1, z: 1 }]]),
            opacity: fading(`${id}.opacity`, start),
        }),
        type: "rect",
        size: constant({ width: station.pullTab ? 54 : 40, height: 18 }),
        cornerRadius: constant(9),
        style: station.pullTab ? { fill: fill(VOLT) } : { gradientFill: chromeGradient(18) },
    });
    const label = cellWordmark(station.label, { cell: 2.5, gap: 0.5, face: "3x5" });
    add({
        ...base(`${id}.label`, { outTick: END, inTick: start + 6, x: station.x, y: FLOW_Y + 26 }),
        type: "path",
        path: constant(label.path),
        style: { fill: fill(station.pullTab ? VOLT : CHROME, fading(`${id}.label.opacity`, start + 6, 0.8)) },
    });
});

// The pulse: a volt glow riding the track from the model to Discord, twice.
const PULSE_STARTS = [FLOW_IN + 42, FLOW_IN + 84];
type Key<T> = [number, T] | [number, T, typeof IN_OUT | typeof OUT];
const pulsePosition: Array<Key<Vec3>> = [];
const pulseOpacity: Array<Key<number>> = [];
for (const start of PULSE_STARTS) {
    pulsePosition.push([start, { x: stations[0].x, y: FLOW_Y, z: 0 }, IN_OUT], [start + 36, { x: stations[3].x, y: FLOW_Y, z: 0 }]);
    pulseOpacity.push([start, 0, OUT], [start + 4, 1], [start + 32, 1, OUT], [start + 38, 0]);
}
add({
    ...base("flow.pulse", {
        outTick: END,
        inTick: PULSE_STARTS[0],
        position: keyed<Vec3>("flow.pulse.position", pulsePosition),
        opacity: keyed("flow.pulse.opacity", pulseOpacity),
    }),
    type: "ellipse",
    size: constant({ width: 26, height: 26 }),
    style: { gradientFill: radial([[0, hex("#FFFFFF")], [0.3, VOLT], [1, hex("#D4FF3A00")]], 13) },
});

const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: "discord-mcp-banner",
    name: "discord-mcp README banner",
    canvas: { width: WIDTH, height: HEIGHT, pixelAspectRatio: 1, backgroundColor: GRAPHITE },
    timing: {
        ticksPerSecond: FPS,
        frameRate: { numerator: FPS, denominator: 1 },
        durationTicks: END,
        displayStartTick: 0,
    },
    assets: {},
    compositions: {
        main: { id: "main", name: "Banner", width: WIDTH, height: HEIGHT, durationTicks: END, nodes, rootNodeIds: order },
    },
    rootCompositionId: "main",
    components: {},
    markers: [
        marker("wordmark", 10, { name: "Chrome wordmark draws on", durationTicks: 70 }),
        marker("tagline", 66, { name: "Tagline on reflective tape", durationTicks: 40 }),
        marker("flow", FLOW_IN, { name: "Request path", durationTicks: 120 }),
        marker("fade", FADE_START, { name: "Fade to loop", durationTicks: 24 }),
    ],
    design: {
        description:
            "discord-mcp banner: Y2K retrofuturism (chrome, sparkles, orbit), biomorphic blobs, technical-sportswear details. A request flows model -> run -> agent -> Discord.",
        accessibilityLabel:
            "discord-mcp. One tool. Your code. It remembers. A request travels from the model through the run tool and the agent to Discord.",
        tokens: { looping: true },
    },
    capabilities: { required: [], optional: [], unsupportedPolicy: "error" },
});

assertValidAnimationDocument(document);
writeFileSync(new URL("./banner.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
console.log(`banner.json: ${order.length} nodes, ${END} ticks at ${FPS} fps, revision ${document.revision}`);
