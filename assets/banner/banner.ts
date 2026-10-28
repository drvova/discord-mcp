// The animated README banner, authored with Clayzo.
//
//   node banner.ts                      writes banner.json and validates it (no account needed)
//   npx clayzo export banner.json ../img/banner.svg --format svg
//                                       renders it (needs `npx clayzo login`)
//
// Style: 2000s performance-gear design language, without any product or mark:
// - sculpted liquid chrome: solid shapes with a sky-horizon-ground chrome
//   reflection, a hard dark horizon line, extruded depth and dark outlines;
// - aggressive type: a wide, italic, sharp-edged block wordmark with
//   chamfered corners, drawn here as polygons (no font);
// - a bold emblem: two crossed accelerating-curve blades in chrome, held by
//   a hex bolt;
// - a dark industrial bunker: heavy steel plates, grooved seams and
//   oversized domed rivets.
//
// Motion is a slow product reveal: dark, a light sweeps across the bunker,
// the emblem settles in, the wordmark is revealed behind a travelling
// reflection, a hold with one glint, then back to dark. The first and last
// frames are the same dark bunker, so the 8-second loop is seamless.
//
// Only geometry, no font text, so the animated SVG export draws it exactly.

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
    stroke,
    withComputedRevision,
    type Animatable,
    type Color,
    type GradientFillStyle,
    type PathData,
    type SceneNode,
    type Vec3,
} from "@clayzo/animation";

const WIDTH = 1280;
const HEIGHT = 400;
const FPS = 30;
const END = 8 * FPS; // 8 s loop

const BLACK = hex("#050608");
const STEEL_DARK = hex("#101217");
const STEEL = hex("#1A1D24");
const STEEL_LIGHT = hex("#2A2F39");
const WHITE = hex("#FFFFFF");

// Long, heavy eases for the reveal.
const SLOW = { x1: 0.6, y1: 0, x2: 0.15, y2: 1 };
const IN_OUT = { x1: 0.45, y1: 0, x2: 0.55, y2: 1 };
type Ease = typeof SLOW;
type Key<T> = [number, T] | [number, T, Ease | "linear"];

const nodes: Record<string, SceneNode> = {};
const order: string[] = [];
const add = (node: SceneNode) => {
    nodes[node.id] = node;
    order.push(node.id);
};
// A node that lives inside a group: not a root.
const child = (node: SceneNode) => {
    nodes[node.id] = node;
    return node.id;
};

type Point = { x: number; y: number };
const vertex = (p: Point) => ({ point: p, inTangent: { x: 0, y: 0 }, outTangent: { x: 0, y: 0 } });
const area = (points: Point[]) => points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
}, 0);
// Closed contours; holes are wound against the outline so they cut through.
const shape = (outline: Point[], ...holes: Point[][]): PathData => {
    const sign = Math.sign(area(outline));
    return {
        contours: [outline, ...holes.map((h) => (Math.sign(area(h)) === sign ? [...h].reverse() : h))].map((points) => ({
            closed: true,
            vertices: points.map(vertex),
        })),
    };
};
const pts = (...xy: number[]): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < xy.length; i += 2) {
        out.push({ x: xy[i], y: xy[i + 1] });
    }
    return out;
};
const linear = (stops: Array<[number, Color]>, from: Point, to: Point, opacity: Animatable<number> = constant(1)): GradientFillStyle => ({
    kind: "linear",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant(from),
    end: constant(to),
    opacity,
});
const radial = (stops: Array<[number, Color]>, radius: number): GradientFillStyle => ({
    kind: "radial",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant({ x: 0, y: 0 }),
    end: constant({ x: radius, y: 0 }),
    opacity: constant(1),
});

// Liquid chrome: bright sky, a hard dark horizon just below the middle,
// then a lighter ground reflection. Top to bottom over `height`.
const CHROME: Array<[number, Color]> = [
    [0, hex("#FFFFFF")],
    [0.18, hex("#E4E9F1")],
    [0.44, hex("#8C95A6")],
    [0.5, hex("#14171D")],
    [0.56, hex("#3B4250")],
    [0.8, hex("#B8C1CF")],
    [1, hex("#F4F7FB")],
];
// The same chrome, tinted Discord blurple.
const BLURPLE_CHROME: Array<[number, Color]> = [
    [0, hex("#FFFFFF")],
    [0.18, hex("#D8DCFF")],
    [0.44, hex("#7C86F7")],
    [0.5, hex("#14163A")],
    [0.56, hex("#3A43B8")],
    [0.8, hex("#A9B1FF")],
    [1, hex("#EEF0FF")],
];
const chrome = (stops: Array<[number, Color]>, top: number, bottom: number) => linear(stops, { x: 0, y: top }, { x: 0, y: bottom });

// A travelling reflection: a soft white band whose gradient endpoints move
// from `from` to `to` (in the node's local space) over [start, start + span],
// parked out of sight otherwise.
const sweep = (id: string, passes: Array<{ start: number; span: number }>, from: number, to: number, width: number, strength = "B0"): GradientFillStyle => {
    const startKeys: Array<Key<Point>> = [[0, { x: from - width, y: 0 }]];
    const endKeys: Array<Key<Point>> = [[0, { x: from, y: -width * 0.35 }]];
    for (const { start, span } of passes) {
        startKeys.push([start, { x: from - width, y: 0 }, IN_OUT], [start + span, { x: to, y: 0 }], [start + span + 1, { x: from - width, y: 0 }]);
        endKeys.push([start, { x: from, y: -width * 0.35 }, IN_OUT], [start + span, { x: to + width, y: -width * 0.35 }], [start + span + 1, { x: from, y: -width * 0.35 }]);
    }
    return {
        kind: "linear",
        stops: constant([
            { position: 0, color: hex("#FFFFFF00") },
            { position: 0.5, color: hex(`#FFFFFF${strength}`) },
            { position: 1, color: hex("#FFFFFF00") },
        ]),
        start: keyed(`${id}.from`, startKeys),
        end: keyed(`${id}.to`, endKeys),
        opacity: constant(1),
    };
};

// --- The bunker: heavy steel plates, seams, oversized rivets ---

const CUT = 26;
const plateOutline = pts(CUT, 0, WIDTH - CUT, 0, WIDTH, CUT, WIDTH, HEIGHT - CUT, WIDTH - CUT, HEIGHT, CUT, HEIGHT, 0, HEIGHT - CUT, 0, CUT);
add({
    ...base("plate", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(shape(plateOutline)),
    style: { gradientFill: linear([[0, STEEL_LIGHT], [0.35, STEEL], [1, STEEL_DARK]], { x: 0, y: 0 }, { x: 0, y: HEIGHT }) },
});
// Galvanised sheen: broad diagonal bands, barely there.
for (const [index, x] of [180, 620, 1010].entries()) {
    add({
        ...base(`plate.sheen-${index}`, { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant(shape(pts(x, 0, x + 150, 0, x + 30, HEIGHT, x - 120, HEIGHT))),
        style: { fill: fill(WHITE, 0.018) },
    });
}
// Grooved seams: a dark cut with a lit lip beside it.
const SEAM_TOP = 46;
const SEAM_BOTTOM = HEIGHT - 46;
const BAY = 368;
const seam = (id: string, a: Point, b: Point) => {
    add({ ...base(`${id}.cut`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant({ contours: [{ closed: false, vertices: [a, b].map(vertex) }] }), style: { stroke: stroke(BLACK, 4, { cap: "butt" }) } });
    const lip = a.x === b.x ? { x: 2.5, y: 0 } : { x: 0, y: 2.5 };
    add({
        ...base(`${id}.lip`, { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant({ contours: [{ closed: false, vertices: [{ x: a.x + lip.x, y: a.y + lip.y }, { x: b.x + lip.x, y: b.y + lip.y }].map(vertex) }] }),
        style: { stroke: stroke(hex("#3C4250"), 1, { cap: "butt" }) },
    });
};
seam("seam.top", { x: 0, y: SEAM_TOP }, { x: WIDTH, y: SEAM_TOP });
seam("seam.bottom", { x: 0, y: SEAM_BOTTOM }, { x: WIDTH, y: SEAM_BOTTOM });
seam("seam.bay", { x: BAY, y: SEAM_TOP }, { x: BAY, y: SEAM_BOTTOM });
// Domed rivets: a dark dome with a highlight up and to the left.
const rivet = (id: string, x: number, y: number) => {
    add({
        ...base(id, { outTick: END, x, y }),
        type: "ellipse",
        size: constant({ width: 13, height: 13 }),
        style: { gradientFill: linear([[0, hex("#5B6373")], [0.5, hex("#262A33")], [1, BLACK]], { x: -4, y: -5 }, { x: 4, y: 5 }), stroke: stroke(BLACK, 1.5) },
    });
    add({
        ...base(`${id}.shine`, { outTick: END, x: x - 2, y: y - 2.5 }),
        type: "ellipse",
        size: constant({ width: 4, height: 3 }),
        style: { fill: fill(WHITE, 0.55) },
    });
};
for (let x = 40; x < WIDTH; x += 80) {
    rivet(`rivet.top-${x}`, x, SEAM_TOP / 2);
    rivet(`rivet.bottom-${x}`, x, HEIGHT - SEAM_TOP / 2);
}
for (const y of [SEAM_TOP + 34, SEAM_BOTTOM - 34]) {
    rivet(`rivet.bay-${y}`, BAY + 18, y);
}

// --- The emblem: two crossed blades of liquid chrome ---

const EMBLEM = { x: BAY / 2, y: HEIGHT / 2 };
type Sample = { point: Point; normal: Point; s: number };
// An Euler spiral (curvature growing along it): the accelerating curve.
function spiral(x: number, y: number, headingDeg: number, length: number, turnDeg: number, count = 64): Sample[] {
    const rate = (2 * turnDeg * (Math.PI / 180)) / (length * length);
    const step = length / count;
    const samples: Sample[] = [];
    let px = x;
    let py = y;
    for (let i = 0; i <= count; i += 1) {
        const s = i * step;
        const heading = headingDeg * (Math.PI / 180) + (rate * s * s) / 2;
        samples.push({ point: { x: px, y: py }, normal: { x: -Math.sin(heading), y: Math.cos(heading) }, s: s / length });
        const mid = headingDeg * (Math.PI / 180) + (rate * (s + step / 2) ** 2) / 2;
        px += Math.cos(mid) * step;
        py += Math.sin(mid) * step;
    }
    return samples;
}
// A fang: fat in the middle, sharp at both ends, swelling toward the tip.
const fang = (samples: Sample[], width: number): Point[] => {
    const w = (s: number) => width * Math.sin(Math.PI * s ** 0.8) ** 0.9 + 0.5;
    const side = (dir: number) => samples.map(({ point, normal, s }) => ({ x: point.x + normal.x * w(s) * dir, y: point.y + normal.y * w(s) * dir }));
    return [...side(-1), ...side(1).reverse()];
};
// Centred on the emblem's origin; offset, not mirrored.
const spines = [spiral(-122, 112, -40, 320, -24), spiral(-118, -118, 50, 300, 30)];
// Where the two spines cross: the bolt goes there, and the emblem is placed
// so the crossing sits at its anchor.
const crossing = spines[0].reduce((best, a) => {
    const d = Math.min(...spines[1].map((b) => Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y)));
    return d < best.d ? { d, point: a.point } : best;
}, { d: Infinity, point: { x: 0, y: 0 } }).point;
const blades = [fang(spines[0], 32), fang(spines[1], 26)];
const emblemParts: string[] = [];
for (const [index, outline] of blades.entries()) {
    const path = constant(shape(outline));
    // Extruded depth, then the chrome body with a dark edge.
    emblemParts.push(child({ ...base(`emblem.${index}.depth`, { outTick: END, x: 7, y: 9 }), type: "path", path, style: { fill: fill(BLACK, 0.9) } }));
    emblemParts.push(child({
        ...base(`emblem.${index}.body`, { outTick: END, x: 0, y: 0 }),
        type: "path",
        path,
        style: { gradientFill: chrome(CHROME, -130, 130), stroke: stroke(BLACK, 2) },
    }));
}
// The travelling reflection, over both blades.
for (const [index, outline] of blades.entries()) {
    emblemParts.push(child({
        ...base(`emblem.${index}.sweep`, { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant(shape(outline)),
        style: { gradientFill: sweep(`emblem.${index}.sweep`, [{ start: 26, span: 44 }, { start: 168, span: 30 }], -170, 170, 90) },
    }));
}
// The hex bolt at the crossing.
const hexagon = (radius: number, offset: number) => ({
    type: "polystar" as const,
    variant: "polygon" as const,
    points: constant(6),
    innerRadius: constant(0),
    outerRadius: constant(radius),
    innerRoundness: constant(0),
    outerRoundness: constant(0),
    rotationOffset: constant(offset),
});
emblemParts.push(child({ ...base("emblem.bolt", { outTick: END, x: crossing.x, y: crossing.y }), ...hexagon(19, 0), style: { gradientFill: chrome(CHROME, -19, 19), stroke: stroke(BLACK, 2) } }));
emblemParts.push(child({ ...base("emblem.bolt.socket", { outTick: END, x: crossing.x, y: crossing.y }), ...hexagon(8, 30), style: { fill: fill(BLACK) } }));

// --- The light: a soft glow sweeps the bunker as the scene comes up ---

add({
    ...base("light", {
        outTick: END,
        position: keyed<Vec3>("light.position", [[0, { x: -300, y: 170, z: 0 }], [8, { x: -300, y: 170, z: 0 }, SLOW], [96, { x: 1500, y: 170, z: 0 }]]),
    }),
    type: "ellipse",
    size: constant({ width: 760, height: 520 }),
    style: { gradientFill: radial([[0, hex("#C9D2E633")], [0.45, hex("#8E9AB514")], [1, hex("#8E9AB500")]], 380) },
});

// --- Darkness: the scene starts and ends unlit ---

add({
    ...base("dark", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(shape(plateOutline)),
    style: { fill: fill(BLACK, keyed("dark.opacity", [[0, 0.72], [8, 0.72, SLOW], [70, 0], [200, 0, IN_OUT], [234, 0.72]])) },
});

// The emblem settles in: from slightly large and unlit to its place.
add({
    ...base("emblem", {
        outTick: END,
        x: EMBLEM.x,
        y: EMBLEM.y,
        anchor: crossing,
        scale: keyed<Vec3>("emblem.scale", [[0, { x: 1.12, y: 1.12, z: 1 }], [14, { x: 1.12, y: 1.12, z: 1 }, SLOW], [74, { x: 1, y: 1, z: 1 }], [200, { x: 1, y: 1, z: 1 }, IN_OUT], [236, { x: 1.06, y: 1.06, z: 1 }], [END, { x: 1.12, y: 1.12, z: 1 }]]),
        opacity: keyed("emblem.opacity", [[0, 0], [14, 0, SLOW], [58, 1], [204, 1, IN_OUT], [234, 0]]),
    }),
    type: "group",
    children: emblemParts,
});

// --- The wordmark: wide, italic, sharp-edged block letters in chrome ---

// Letters on a cap-height grid: t is the stroke, c the chamfer.
const glyph = (letter: string, H: number): { width: number; path: PathData } => {
    const t = H * 0.25;
    const c = H * 0.2;
    const ci = c * 0.5;
    const b = H * 0.56;
    switch (letter) {
        case "D": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(0, 0, W - c, 0, W, c, W, H - c, W - c, H, 0, H), pts(t, t, W - t - ci, t, W - t, t + ci, W - t, H - t - ci, W - t - ci, H - t, t, H - t)) };
        }
        case "I":
            return { width: t, path: shape(pts(0, 0, t, 0, t, H, 0, H)) };
        case "S": {
            const W = H * 0.96;
            const m0 = (H - t) / 2;
            const m1 = (H + t) / 2;
            return { width: W, path: shape(pts(c, 0, W, 0, W, t, t, t, t, m0, W - c, m0, W, m0 + c, W, H, 0, H, 0, H - t, W - t, H - t, W - t, m1, c, m1, 0, m1 - c, 0, c)) };
        }
        case "C": {
            const W = H * 0.92;
            return { width: W, path: shape(pts(c, 0, W, 0, W, t, t, t, t, H - t, W, H - t, W, H, c, H, 0, H - c, 0, c)) };
        }
        case "O": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(c, 0, W - c, 0, W, c, W, H - c, W - c, H, c, H, 0, H - c, 0, c), pts(t, t, W - t, t, W - t, H - t, t, H - t)) };
        }
        case "R": {
            const W = H * 1.0;
            const leg = t * 1.25;
            return {
                width: W,
                path: shape(
                    pts(0, 0, W - c, 0, W, c, W, b - c, W - c, b, W * 0.42 + leg, b, W, H, W - leg, H, W * 0.42, b, t, b, t, H, 0, H),
                    pts(t, t, W - t, t, W - t, b - t, t, b - t),
                ),
            };
        }
        case "M": {
            const W = H * 1.28;
            const half = t / 2;
            return { width: W, path: shape(pts(c, 0, W, 0, W, H, W - t, H, W - t, t, W / 2 + half, t, W / 2 + half, H * 0.72, W / 2 - half, H * 0.72, W / 2 - half, t, t, t, t, H, 0, H, 0, c)) };
        }
        case "P": {
            const W = H * 0.98;
            return { width: W, path: shape(pts(0, 0, W - c, 0, W, c, W, b - c, W - c, b, t, b, t, H, 0, H), pts(t, t, W - t, t, W - t, b - t, t, b - t)) };
        }
        default:
            throw new Error(`No glyph for ${letter}`);
    }
};

const SKEW = constant({ x: -14, y: 0 });
// One line of chrome letters. Each letter is a group (depth, body,
// reflection) that is revealed just behind the travelling reflection.
const line = (id: string, text: string, x: number, y: number, H: number, stops: Array<[number, Color]>, glints: Array<{ start: number; span: number }>, stretch = 1.16) => {
    const gap = H * 0.16;
    const letters = [...text].map((letter) => glyph(letter, H));
    const total = letters.reduce((sum, g) => sum + g.width * stretch, 0) + gap * (letters.length - 1);
    let cursor = x;
    for (const [index, { width, path }] of letters.entries()) {
        const letterId = `${id}.${index}`;
        // The reflection crosses the whole line, so each letter's copy of it
        // is the line's band shifted into the letter's own space.
        const offset = cursor - x;
        const parts = [
            child({ ...base(`${letterId}.depth`, { outTick: END, x: 6, y: 7 }), type: "path", path: constant(path), style: { fill: fill(BLACK, 0.95) } }),
            child({ ...base(`${letterId}.body`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(path), style: { gradientFill: chrome(stops, 0, H), stroke: stroke(BLACK, 2) } }),
            child({
                ...base(`${letterId}.sweep`, { outTick: END, x: 0, y: 0 }),
                type: "path",
                path: constant(path),
                style: { gradientFill: sweep(`${letterId}.sweep`, glints, (-160 - offset) / stretch, (total + 160 - offset) / stretch, 110) },
            }),
        ];
        // Revealed in order, as the first pass of the reflection reaches it.
        const at = glints[0].start + Math.round((offset / total) * glints[0].span * 0.8);
        add({
            ...base(letterId, {
                outTick: END,
                x: cursor,
                y,
                skew: SKEW,
                scale: { x: stretch, y: 1 },
                opacity: keyed(`${letterId}.opacity`, [[0, 0], [at, 0, SLOW], [at + 16, 1], [204, 1, IN_OUT], [232, 0]]),
            }),
            type: "group",
            children: parts,
        });
        cursor += width * stretch + gap;
    }
    return { width: total, right: x + total };
};

const WORD_X = 420;
const CAP = 96;
const WORD_Y = 90;
line("discord", "DISCORD", WORD_X, WORD_Y, CAP, CHROME, [{ start: 40, span: 46 }, { start: 150, span: 40 }]);
const MCP_CAP = 54;
const MCP_Y = WORD_Y + CAP + 30;
const mcp = line("mcp", "MCP", WORD_X - 14, MCP_Y, MCP_CAP, BLURPLE_CHROME, [{ start: 78, span: 24 }, { start: 166, span: 24 }]);

// A machined bar after "MCP", carrying the one-line pitch in microtype.
const BAR_X = mcp.right + 30;
const BAR_Y = MCP_Y + MCP_CAP / 2;
add({
    ...base("bar", { outTick: END, x: BAR_X, y: BAR_Y, opacity: keyed("bar.opacity", [[0, 0], [96, 0, SLOW], [118, 1], [204, 1, IN_OUT], [232, 0]]) }),
    type: "path",
    path: constant(shape(pts(0, -7, 560, -7, 552, 7, 8, 7))),
    style: { gradientFill: linear([[0, hex("#6A7384")], [0.5, hex("#1C2027")], [1, hex("#4A5262")]], { x: 0, y: -7 }, { x: 0, y: 7 }), stroke: stroke(BLACK, 1.5) },
});
const pitch = cellWordmark("ONE TOOL. RUNS YOUR CODE. TOKENS STAY IN THE AGENT.", { cell: 2.5, gap: 0.5, face: "3x5" });
add({
    ...base("pitch", { outTick: END, x: BAR_X + 24 + pitch.width / 2, y: BAR_Y + 26, opacity: keyed("pitch.opacity", [[0, 0], [104, 0, SLOW], [126, 1], [204, 1, IN_OUT], [232, 0]]) }),
    type: "path",
    path: constant(pitch.path),
    style: { fill: fill(hex("#9AA3B5")) },
});

const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: "discord-mcp-banner",
    name: "discord-mcp README banner",
    canvas: { width: WIDTH, height: HEIGHT, pixelAspectRatio: 1, backgroundColor: BLACK },
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
        marker("lights", 8, { name: "Light sweeps the bunker", durationTicks: 88 }),
        marker("emblem", 14, { name: "Emblem settles in", durationTicks: 60 }),
        marker("wordmark", 40, { name: "Wordmark revealed behind the reflection", durationTicks: 60 }),
        marker("hold", 126, { name: "Hold, one glint", durationTicks: 78 }),
        marker("dark", 204, { name: "Back to dark", durationTicks: 36 }),
    ],
    design: {
        description:
            "discord-mcp banner in a 2000s performance-gear language: liquid chrome emblem and block wordmark in a dark steel bunker, revealed like a product launch.",
        accessibilityLabel: "discord-mcp. One tool runs your code; tokens stay in the agent.",
        tokens: { looping: true },
    },
    capabilities: { required: [], optional: [], unsupportedPolicy: "error" },
});

assertValidAnimationDocument(document);
writeFileSync(new URL("./banner.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
console.log(`banner.json: ${Object.keys(nodes).length} nodes, ${END} ticks at ${FPS} fps, revision ${document.revision}`);
