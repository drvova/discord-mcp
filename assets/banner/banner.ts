// The animated README banner, authored with Clayzo.
//
//   node banner.ts                      writes banner.json and validates it (no account needed)
//   npx clayzo export banner.json ../img/banner.svg --format svg
//                                       renders it (needs `npx clayzo login`)
//
// Style: 2000s performance-eyewear tech (in the spirit of the era's machined
// metal frames and mirrored sport lenses, with no brand marks): a wraparound
// shield lens with a fire-to-sapphire mirror coat and a sweeping glint, a wide
// slanted chrome wordmark, machined titanium hardware (hex bolts, temple arms
// with shock springs), and catalog-style callouts with leader lines. Kept from
// the sportswear take: ripstop grid, stitched seam, care-label microtype.
//
// Only geometry, no font text, so the animated SVG export draws it exactly.
// The lens, hardware and garment are always there; the bolts turn by one
// hex step (60°) per loop and the glint starts and ends off the lens, while
// the wordmark, tagline, callouts and request path draw on and fade each
// loop: the last frame leads straight into the first.

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
    pen,
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

// Palette: graphite, polished titanium, and a fire-to-sapphire mirror coat.
const GRAPHITE = hex("#07080D");
const GUNMETAL = hex("#3A404E");
const TITANIUM = hex("#B9C2D3");
const WHITE = hex("#FFFFFF");
const SHADOW = hex("#1B1E29");
const FIRE = hex("#FF7A1A");
const FIRE_CHROME = hex("#FF8A3D");
const FIRE_HIGHLIGHT = hex("#FFE3C2");
const SAPPHIRE = hex("#2F86FF");
const ICE = hex("#8FF4FF");
const VOLT = hex("#D4FF3A");

const OUT = { x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 };
const IN_OUT = { x1: 0.45, y1: 0, x2: 0.55, y2: 1 };

const FADE_START = END - 24;
// Opacity that holds `level` and fades to 0 just before the loop point.
const fading = (id: string, start: number, level = 1): Animatable<number> =>
    keyed<number>(id, [[start, 0, OUT], [start + 12, level], [FADE_START, level, IN_OUT], [END - 4, 0]]);

const nodes: Record<string, SceneNode> = {};
const order: string[] = [];
// `root: false` for nodes that live inside a group (or are a clip shape).
const add = (node: SceneNode, root = true) => {
    nodes[node.id] = node;
    if (root) {
        order.push(node.id);
    }
};

const vertex = (x: number, y: number) => ({ point: { x, y }, inTangent: { x: 0, y: 0 }, outTangent: { x: 0, y: 0 } });
const polyline = (points: Array<[number, number]>): PathContour => ({
    closed: false,
    vertices: points.map(([x, y]) => vertex(x, y)),
});
const linear = (stops: Array<[number, Color]>, from: [number, number], to: [number, number], opacity = 1): GradientFillStyle => ({
    kind: "linear",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant({ x: from[0], y: from[1] }),
    end: constant({ x: to[0], y: to[1] }),
    opacity: constant(opacity),
});
const radial = (stops: Array<[number, Color]>, radius: number): GradientFillStyle => ({
    kind: "radial",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant({ x: 0, y: 0 }),
    end: constant({ x: radius, y: 0 }),
    opacity: constant(1),
});
// Polished titanium: bright top edge, dark band through the middle.
const titanium = (height: number) =>
    linear(
        [[0, WHITE], [0.42, hex("#8E97A8")], [0.56, hex("#5C6578")], [1, hex("#E9EDF4")]],
        [0, -height / 2],
        [0, height / 2],
    );
// Pixel-face microtype; `align` says whether `x` is its left edge, right edge or centre.
const microtype = (
    id: string,
    text: string,
    x: number,
    y: number,
    color: Color,
    opacity: number | Animatable<number>,
    align: "left" | "right" | "center" = "left",
    inTick = 0,
) => {
    const label = cellWordmark(text, { cell: 2.5, gap: 0.5, face: "3x5" });
    const centre = align === "center" ? x : align === "left" ? x + label.width / 2 : x - label.width / 2;
    add({
        ...base(id, { outTick: END, inTick, x: centre, y }),
        type: "path",
        path: constant(label.path),
        style: { fill: fill(color, opacity) },
    });
};
// A machined hex bolt: chrome-rimmed hexagon with a darker recess.
const bolt = (id: string, x: number, y: number, radius: number, options: { inTick?: number; turn: Animatable<Vec3>; opacity?: Animatable<number>; accent?: Color }) => {
    const common = { outTick: END, inTick: options.inTick ?? 0, x, y, rotation: options.turn, opacity: options.opacity };
    add({
        ...base(id, common),
        type: "polystar",
        variant: "polygon",
        points: constant(6),
        innerRadius: constant(0),
        outerRadius: constant(radius),
        innerRoundness: constant(0),
        outerRoundness: constant(0),
        rotationOffset: constant(0),
        style: { gradientFill: titanium(radius * 2), stroke: stroke(SHADOW, 1.5) },
    });
    add({
        ...base(`${id}.recess`, common),
        type: "polystar",
        variant: "polygon",
        points: constant(6),
        innerRadius: constant(0),
        outerRadius: constant(radius * 0.45),
        innerRoundness: constant(0),
        outerRoundness: constant(0),
        rotationOffset: constant(30),
        style: { fill: fill(options.accent ?? GUNMETAL) },
    });
};

// --- The garment: card, ripstop grid, stitched seam ---

add({
    ...base("card", { outTick: END, x: WIDTH / 2, y: HEIGHT / 2 }),
    type: "rect",
    size: constant({ width: WIDTH, height: HEIGHT }),
    cornerRadius: constant(28),
    style: { fill: fill(GRAPHITE) },
});
const gridLines = (every: number, step: number): PathData => {
    const contours: PathContour[] = [];
    for (let x = step; x < WIDTH; x += step) {
        if (every === 1 || Math.round(x / step) % every === 0) {
            contours.push(polyline([[x, 0], [x, HEIGHT]]));
        }
    }
    for (let y = step; y < HEIGHT; y += step) {
        if (every === 1 || Math.round(y / step) % every === 0) {
            contours.push(polyline([[0, y], [WIDTH, y]]));
        }
    }
    return { contours };
};
add({
    ...base("ripstop.fine", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(gridLines(1, 16)),
    style: { stroke: stroke(WHITE, 0.6, { opacity: 0.022 }) },
});
add({
    ...base("ripstop.thread", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(gridLines(4, 16)),
    style: { stroke: stroke(WHITE, 1, { opacity: 0.045 }) },
});
add({
    ...base("seam", { outTick: END, x: WIDTH / 2, y: HEIGHT / 2 }),
    type: "rect",
    size: constant({ width: WIDTH - 28, height: HEIGHT - 28 }),
    cornerRadius: constant(18),
    style: {
        // Crawls by whole dash periods (7 + 5) per loop, so it is seamless.
        stroke: stroke(TITANIUM, 1.2, { opacity: 0.28, dash: [7, 5], dashOffset: keyed("seam.offset", [[0, 0, "linear"], [END, -12 * 8]]) }),
    },
});

// --- The shield lens ---

const LENS_X = WIDTH / 2;
const LENS_Y = 150;
// A wraparound shield: a shallow arc on top, two lobes and a nose bridge below.
const shield = pen(-470, -46)
    .curveTo({ x: -300, y: -82 }, { x: 300, y: -82 }, 470, -46)
    .curveTo({ x: 500, y: -10 }, { x: 482, y: 40 }, 420, 62)
    .curveTo({ x: 330, y: 92 }, { x: 170, y: 86 }, 72, 50)
    .curveTo({ x: 32, y: 30 }, { x: -32, y: 30 }, -72, 50)
    .curveTo({ x: -170, y: 86 }, { x: -330, y: 92 }, -420, 62)
    .curveTo({ x: -482, y: 40 }, { x: -500, y: -10 }, -470, -46)
    .close();
const shieldPath = constant<PathData>({ contours: [shield] });

// Temple arms: titanium bars from the lens to the card edge, each with a
// shock spring near the hinge.
for (const side of [-1, 1]) {
    const hingeX = LENS_X + side * 470;
    const hingeY = LENS_Y - 46;
    const outerX = side < 0 ? 40 : WIDTH - 40;
    const id = side < 0 ? "temple.left" : "temple.right";
    const armLength = Math.abs(hingeX - outerX) - 40;
    add({
        ...base(id, { outTick: END, x: (outerX + hingeX + side * -40) / 2, y: hingeY }),
        type: "rect",
        size: constant({ width: armLength, height: 9 }),
        cornerRadius: constant(4.5),
        style: { gradientFill: titanium(9) },
    });
    const springStart = hingeX - side * 12;
    const zigzag: Array<[number, number]> = [];
    for (let step = 0; step <= 8; step += 1) {
        zigzag.push([springStart - side * step * 4, hingeY + (step % 2 === 0 ? -7 : 7)]);
    }
    add({
        ...base(`${id}.spring`, { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant({ contours: [polyline(zigzag)] }),
        style: { stroke: stroke(TITANIUM, 2, { join: "miter" }) },
    });
}

// The lens itself: mirror coat, a dark centre so the wordmark reads, and a
// glint that sweeps across twice a loop, all clipped to the shield.
add({ ...base("lens.clip", { outTick: END, x: 0, y: 0 }), type: "path", path: shieldPath, style: {} }, false);
add(
    {
        ...base("lens.coat", { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: shieldPath,
        style: {
            gradientFill: linear(
                [[0, hex("#FFC83A")], [0.16, FIRE], [0.32, hex("#D9213B")], [0.5, hex("#24104A")], [0.66, hex("#1D3FA8")], [0.84, SAPPHIRE], [1, ICE]],
                [-470, 0],
                [470, 0],
            ),
        },
    },
    false,
);
add(
    {
        ...base("lens.shade", { outTick: END, x: 0, y: 6, scale: { x: 1, y: 0.34 } }),
        type: "ellipse",
        size: constant({ width: 860, height: 860 }),
        style: { gradientFill: radial([[0, hex("#07080DE6")], [0.6, hex("#07080D99")], [1, hex("#07080D00")]], 430) },
    },
    false,
);
const GLINTS = [36, 160];
const glintKeys: Array<[number, Vec3, typeof IN_OUT] | [number, Vec3]> = [];
for (const start of GLINTS) {
    glintKeys.push([start, { x: -640, y: 0, z: 0 }, IN_OUT], [start + 40, { x: 640, y: 0, z: 0 }]);
}
add(
    {
        ...base("lens.glint", { outTick: END, rotation: 22, position: keyed<Vec3>("lens.glint.position", [[0, { x: -640, y: 0, z: 0 }], ...glintKeys]) }),
        type: "rect",
        size: constant({ width: 90, height: 320 }),
        cornerRadius: constant(0),
        style: { gradientFill: linear([[0, hex("#FFFFFF00")], [0.5, hex("#FFFFFF8C")], [1, hex("#FFFFFF00")]], [-45, 0], [45, 0]) },
    },
    false,
);
add({
    ...base("lens", { outTick: END, x: LENS_X, y: LENS_Y }),
    type: "group",
    children: ["lens.coat", "lens.shade", "lens.glint"],
    clipPathId: "lens.clip",
});
add({
    ...base("lens.rim", { outTick: END, x: LENS_X, y: LENS_Y }),
    type: "path",
    path: shieldPath,
    style: { stroke: stroke(TITANIUM, 2.5, { opacity: 0.9 }) },
});

// Hinge bolts: always there, turning one hex step (60°) per loop.
const hingeTurn = (id: string) => keyed<Vec3>(id, [[0, { x: 0, y: 0, z: 0 }, "linear"], [END, { x: 0, y: 0, z: 60 }]]);
bolt("bolt.hinge-left", LENS_X - 470, LENS_Y - 46, 14, { turn: hingeTurn("bolt.hinge-left.turn") });
bolt("bolt.hinge-right", LENS_X + 470, LENS_Y - 46, 14, { turn: hingeTurn("bolt.hinge-right.turn") });

// Flare: small four-point glints on the lens edge, twinkling from nothing.
const flares: Array<[number, number, number, number]> = [
    [LENS_X - 300, LENS_Y - 70, 12, 70],
    [LENS_X + 230, LENS_Y - 74, 16, 112],
    [LENS_X + 410, LENS_Y + 52, 10, 196],
];
flares.forEach(([x, y, size, at], index) => {
    const zero = { x: 0, y: 0, z: 1 };
    add({
        ...base(`flare-${index}`, {
            outTick: END,
            x,
            y,
            scale: keyed<Vec3>(`flare-${index}.scale`, [[0, zero], [at, zero, OUT], [at + 8, { x: 1, y: 1, z: 1 }, IN_OUT], [at + 20, zero]]),
        }),
        type: "polystar",
        variant: "star",
        points: constant(4),
        innerRadius: constant(size * 0.16),
        outerRadius: constant(size),
        innerRoundness: constant(0),
        outerRoundness: constant(0),
        rotationOffset: constant(0),
        style: { fill: fill(WHITE) },
    });
});

// --- The wordmark: wide, slanted, chrome; "MCP" in fire chrome ---

const WORD_Y = LENS_Y - 6;
const word = monolineWordmark("DISCORD MCP", { capHeight: 78, polyline: true });
word.letters.forEach((letter, index) => {
    if (letter.contours.length === 0) {
        return;
    }
    const isMcp = index >= word.letters.length - 3;
    const start = 8 + index * 5;
    const path = constant<PathData>({ contours: [...letter.contours] });
    const layers: Array<[string, Color, number, number]> = [
        ["shadow", SHADOW, word.stroke + 6, 5],
        ["body", isMcp ? FIRE_CHROME : TITANIUM, word.stroke, 0],
        ["highlight", isMcp ? FIRE_HIGHLIGHT : WHITE, word.stroke * 0.32, -word.stroke * 0.2],
    ];
    for (const [layer, color, width, offset] of layers) {
        const id = `word.${index}.${layer}`;
        add({
            // Skewed and widened about the word's centre: the sport italic.
            ...base(id, { outTick: END, x: LENS_X, y: WORD_Y + offset, skew: constant({ x: -14, y: 0 }), scale: { x: 1.14, y: 1 } }),
            type: "path",
            path,
            style: { stroke: stroke(color, width, { opacity: fading(`${id}.opacity`, start) }) },
            operators: [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[start, 0, OUT], [start + 24, 1]]) })],
        });
    }
});

// --- Catalog callouts: leader lines that draw out to spec labels ---

const callout = (id: string, points: Array<[number, number]>, start: number, label: string, align: "left" | "right", color: Color) => {
    const [anchorX, anchorY] = points[0];
    add({
        ...base(`${id}.dot`, { outTick: END, inTick: start, x: anchorX, y: anchorY, opacity: fading(`${id}.dot.opacity`, start) }),
        type: "ellipse",
        size: constant({ width: 6, height: 6 }),
        style: { fill: fill(color) },
    });
    add({
        ...base(`${id}.leader`, { outTick: END, inTick: start, x: 0, y: 0 }),
        type: "path",
        path: constant({ contours: [polyline(points)] }),
        style: { stroke: stroke(color, 1, { opacity: fading(`${id}.leader.opacity`, start, 0.7), cap: "butt" }) },
        operators: [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[start, 0, OUT], [start + 16, 1]]) })],
    });
    const [endX, endY] = points[points.length - 1];
    microtype(`${id}.label`, label, align === "left" ? endX + 8 : endX - 8, endY, color, fading(`${id}.label.opacity`, start + 12, 0.85), align, start + 12);
};
// Pixel microtype is 10 px per character here: keep labels inside the card.
callout("callout.coat", [[LENS_X - 360, LENS_Y + 40], [LENS_X - 390, LENS_Y + 100], [LENS_X - 420, LENS_Y + 100]], 86, "FIRE MIRROR", "right", FIRE);
callout("callout.sapphire", [[LENS_X + 360, LENS_Y + 40], [LENS_X + 390, LENS_Y + 100], [LENS_X + 420, LENS_Y + 100]], 94, "SAPPHIRE MIRROR", "left", ICE);
callout("callout.hardware", [[LENS_X - 470, LENS_Y - 62], [LENS_X - 470, 42]], 102, "TI ALLOY HARDWARE", "left", TITANIUM);
callout("callout.spec", [[LENS_X + 470, LENS_Y - 62], [LENS_X + 470, 42]], 110, "1 TOOL / NODE 22 / API V10", "right", TITANIUM);

// --- Tagline on chrome tape ---

const TAPE_Y = 270;
const tagline = cellWordmark("ONE TOOL. YOUR CODE. IT REMEMBERS.", { cell: 4, gap: 1, face: "3x5" });
add({
    ...base("tape", { outTick: END, inTick: 62, x: LENS_X, y: TAPE_Y, skew: constant({ x: -14, y: 0 }), opacity: fading("tape.opacity", 62) }),
    type: "rect",
    size: constant({ width: tagline.width + 52, height: 32 }),
    cornerRadius: constant(6),
    style: { gradientFill: titanium(32) },
});
tagline.letters.forEach((letter, index) => {
    if (letter.contours.length === 0) {
        return;
    }
    const start = 68 + index * 2;
    const id = `tagline.${index}`;
    add({
        ...base(id, {
            outTick: END,
            inTick: start,
            skew: constant({ x: -14, y: 0 }),
            position: keyed<Vec3>(`${id}.position`, [
                [start, { x: LENS_X, y: TAPE_Y + 8, z: 0 }, OUT],
                [start + 12, { x: LENS_X, y: TAPE_Y, z: 0 }],
            ]),
        }),
        type: "path",
        path: constant({ contours: [...letter.contours] }),
        style: { fill: fill(GRAPHITE, fading(`${id}.opacity`, start)) },
    });
});

// --- The request path: a titanium bar with hex-bolt stations ---

const BAR_Y = 312;
const BAR_IN = 112;
const stations = [
    { label: "MODEL", x: 380 },
    { label: "RUN", x: 560, accent: FIRE },
    { label: "AGENT", x: 740 },
    { label: "DISCORD", x: 920 },
];
add({
    ...base("bar", {
        outTick: END,
        inTick: BAR_IN,
        x: (stations[0].x + stations[3].x) / 2,
        y: BAR_Y,
        scale: keyed<Vec3>("bar.scale", [[BAR_IN, { x: 0.2, y: 1, z: 1 }, OUT], [BAR_IN + 18, { x: 1, y: 1, z: 1 }]]),
        opacity: fading("bar.opacity", BAR_IN),
    }),
    type: "rect",
    size: constant({ width: stations[3].x - stations[0].x + 40, height: 8 }),
    cornerRadius: constant(4),
    style: { gradientFill: titanium(8) },
});
stations.forEach((station, index) => {
    const start = BAR_IN + 10 + index * 7;
    const id = `station-${index}`;
    // Screws in: a quarter turn as it appears.
    bolt(id, station.x, BAR_Y, 11, {
        inTick: start,
        turn: keyed<Vec3>(`${id}.turn`, [[start, { x: 0, y: 0, z: -90 }, OUT], [start + 14, { x: 0, y: 0, z: 0 }]]),
        opacity: fading(`${id}.opacity`, start),
        accent: station.accent,
    });
    microtype(`${id}.label`, station.label, station.x, BAR_Y + 24, station.accent ?? TITANIUM, fading(`${id}.label.opacity`, start + 6, 0.85), "center", start + 6);
});

// The pulse: a fire glow running the bar from the model to Discord, twice.
const PULSES = [BAR_IN + 44, BAR_IN + 86];
type Key<T> = [number, T] | [number, T, typeof IN_OUT | typeof OUT];
const pulsePosition: Array<Key<Vec3>> = [];
const pulseOpacity: Array<Key<number>> = [];
for (const start of PULSES) {
    pulsePosition.push([start, { x: stations[0].x, y: BAR_Y, z: 0 }, IN_OUT], [start + 34, { x: stations[3].x, y: BAR_Y, z: 0 }]);
    pulseOpacity.push([start, 0, OUT], [start + 4, 1], [start + 30, 1, OUT], [start + 36, 0]);
}
add({
    ...base("pulse", {
        outTick: END,
        inTick: PULSES[0],
        position: keyed<Vec3>("pulse.position", pulsePosition),
        opacity: keyed("pulse.opacity", pulseOpacity),
    }),
    type: "ellipse",
    size: constant({ width: 30, height: 30 }),
    style: { gradientFill: radial([[0, WHITE], [0.3, FIRE], [1, hex("#FF7A1A00")]], 15) },
});

// --- Care labels, as on the version before ---

microtype("care.left", "KEEP TOKENS DRY. RUN SANDBOXED.", 64, HEIGHT - 36, VOLT, 0.7);
microtype("care.right", "MADE OF CODE / KEPT ACROSS RESTARTS", WIDTH - 64, HEIGHT - 36, TITANIUM, 0.55, "right");

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
        marker("wordmark", 8, { name: "Chrome wordmark draws on", durationTicks: 70 }),
        marker("glint", GLINTS[0], { name: "Lens glint", durationTicks: 40 }),
        marker("callouts", 86, { name: "Catalog callouts", durationTicks: 40 }),
        marker("bar", BAR_IN, { name: "Request path", durationTicks: 120 }),
        marker("fade", FADE_START, { name: "Fade to loop", durationTicks: 24 }),
    ],
    design: {
        description:
            "discord-mcp banner: 2000s performance-eyewear tech (shield lens with a fire-to-sapphire mirror coat, machined titanium hardware, catalog callouts), over a ripstop-and-stitch sportswear card.",
        accessibilityLabel:
            "discord-mcp. One tool. Your code. It remembers. A request travels from the model through the run tool and the agent to Discord.",
        tokens: { looping: true },
    },
    capabilities: { required: [], optional: [], unsupportedPolicy: "error" },
});

assertValidAnimationDocument(document);
writeFileSync(new URL("./banner.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
console.log(`banner.json: ${order.length} root nodes, ${Object.keys(nodes).length} nodes, ${END} ticks at ${FPS} fps, revision ${document.revision}`);
