// The animated README banner, authored with Clayzo.
//
//   node banner.ts                      writes banner.json and validates it (no account needed)
//   npx clayzo export banner.json ../img/banner.svg --format svg
//                                       renders it (needs `npx clayzo login`)
//
// Style: the design language of 2000s Oakley, not its products (no brand marks):
// - "accelerating curves": every sweep is an Euler spiral, whose curvature
//   grows along its length, so the forms start almost straight and tighten
//   like an aerofoil or a race-car body;
// - offset geometry: two sculpted blades that answer each other without
//   mirroring, the wordmark set off-centre;
// - exposed structure: veins along each blade, machined rivets, hex bolts
//   that turn, and a bolted hinge where the blades meet, the
//   organic-mechanical look of the era's metal frames;
// - machined surfaces: a chamfered plate with a bevel and an engraved line,
//   and a chrome wordmark with a dark horizon band under its highlight;
// - restraint: matte black and titanium, with one small accent.
// Callouts wrap the function in the art: each points at a part and names
// what the project does.
//
// Only geometry, no font text, so the animated SVG export draws it exactly.
// The blades and rivets are always there; edges, veins, wordmark and callouts
// draw on and fade each loop, and the glint starts and ends hidden, so the
// last frame leads straight into the first.

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

// Palette: matte black and titanium; Discord blurple as the one accent.
const MATTE = hex("#0A0B0E");
const SHADOW = hex("#15171D");
const GUNMETAL = hex("#3A404E");
const TITANIUM = hex("#B9C2D3");
const WHITE = hex("#FFFFFF");
const ACCENT = hex("#5865F2");
const ACCENT_LIGHT = hex("#A9B1FF");

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

type Point = { x: number; y: number };
const vertex = (p: Point) => ({ point: p, inTangent: { x: 0, y: 0 }, outTangent: { x: 0, y: 0 } });
const open = (points: Point[]): PathContour => ({ closed: false, vertices: points.map(vertex) });
const linear = (stops: Array<[number, Color]>, from: Point, to: Point): GradientFillStyle => ({
    kind: "linear",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant(from),
    end: constant(to),
    opacity: constant(1),
});
const radial = (stops: Array<[number, Color]>, radius: number): GradientFillStyle => ({
    kind: "radial",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant({ x: 0, y: 0 }),
    end: constant({ x: radius, y: 0 }),
    opacity: constant(1),
});

// --- Accelerating curves ---

type Sample = { point: Point; normal: Point; s: number };
// An Euler spiral from (x, y): heading `headingDeg`, turning `turnDeg` in
// total over `length`, with curvature growing linearly along it.
function spiral(x: number, y: number, headingDeg: number, length: number, turnDeg: number, count = 96): Sample[] {
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
const offsetAlong = (samples: Sample[], width: (s: number) => number, side: number): Point[] =>
    samples.map(({ point, normal, s }) => ({ x: point.x + normal.x * width(s) * side, y: point.y + normal.y * width(s) * side }));

// A sculpted blade along a spiral: a tapered body in graphite-to-titanium,
// a bright leading edge and two veins that draw on, and machined rivets.
function blade(id: string, samples: Sample[], rootWidth: number, start: number, rivetsAt: number[]) {
    const width = (s: number) => (rootWidth / 2) * (1 - s) ** 1.15 + 0.8;
    const upper = offsetAlong(samples, width, -1);
    const lower = offsetAlong(samples, width, 1);
    const first = samples[0].point;
    const last = samples[samples.length - 1].point;
    add({
        ...base(`${id}.body`, { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant<PathData>({ contours: [{ closed: true, vertices: [...upper, ...lower.reverse()].map(vertex) }] }),
        style: {
            gradientFill: linear(
                [[0, SHADOW], [0.45, GUNMETAL], [0.85, hex("#8E97A8")], [1, hex("#DDE3EC")]],
                first,
                last,
            ),
        },
    });
    const drawn = (part: string, points: Point[], color: Color, lineWidth: number, level: number, delay: number) => {
        const partId = `${id}.${part}`;
        add({
            ...base(partId, { outTick: END, inTick: start + delay, x: 0, y: 0 }),
            type: "path",
            path: constant<PathData>({ contours: [open(points)] }),
            style: { stroke: stroke(color, lineWidth, { opacity: fading(`${partId}.opacity`, start + delay, level) }) },
            operators: [trim(`${partId}.trim`, { end: keyed(`${partId}.end`, [[start + delay, 0, OUT], [start + delay + 36, 1]]) })],
        });
    };
    drawn("edge", offsetAlong(samples, (s) => width(s) * 0.92, -1), WHITE, 1.6, 0.85, 0);
    drawn("vein-a", offsetAlong(samples, (s) => width(s) * 0.35, -1), SHADOW, 1.4, 0.9, 6);
    drawn("vein-b", offsetAlong(samples, (s) => width(s) * 0.35, 1), TITANIUM, 1, 0.35, 10);
    for (const [index, at] of rivetsAt.entries()) {
        const sample = samples[Math.round(at * (samples.length - 1))];
        const radius = Math.max(4, width(sample.s) * 0.3);
        add({
            ...base(`${id}.rivet-${index}`, { outTick: END, x: sample.point.x, y: sample.point.y }),
            type: "polystar",
            variant: "polygon",
            points: constant(6),
            innerRadius: constant(0),
            outerRadius: constant(radius),
            innerRoundness: constant(0),
            outerRoundness: constant(0),
            rotationOffset: constant(0),
            style: { gradientFill: linear([[0, WHITE], [0.5, hex("#7C8597")], [1, hex("#E9EDF4")]], { x: 0, y: -radius }, { x: 0, y: radius }), stroke: stroke(SHADOW, 1) },
        });
    }
    return { width, upper: offsetAlong(samples, width, -1) };
}

// --- The surface ---

// A machined plate, not a rounded card: chamfers on two opposite corners
// (offset, not symmetric), a bevel catching light along the top and left,
// and an engraved inner line.
const chamfered = (inset: number, big: number, small: number): Point[] => {
    const [l, t, r, b] = [inset, inset, WIDTH - inset, HEIGHT - inset];
    return [
        { x: l + big, y: t }, { x: r - small, y: t }, { x: r, y: t + small },
        { x: r, y: b - big }, { x: r - big, y: b }, { x: l + small, y: b },
        { x: l, y: b - small }, { x: l, y: t + big },
    ];
};
const plate = chamfered(0, 44, 10);
add({
    ...base("card", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant<PathData>({ contours: [{ closed: true, vertices: plate.map(vertex) }] }),
    style: { fill: fill(MATTE) },
});
add({
    ...base("bevel.light", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant<PathData>({ contours: [open([plate[6], plate[7], plate[0], plate[1]].map((p) => ({ x: p.x + (p.x === 0 ? 1 : 0), y: p.y + (p.y === 0 ? 1 : 0) })))] }),
    style: { stroke: stroke(WHITE, 1.5, { opacity: 0.18, cap: "butt" }) },
});
add({
    ...base("bevel.dark", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant<PathData>({ contours: [open([plate[2], plate[3], plate[4], plate[5]].map((p) => ({ x: p.x - (p.x === WIDTH ? 1 : 0), y: p.y - (p.y === HEIGHT ? 1 : 0) })))] }),
    style: { stroke: stroke(GUNMETAL, 1.5, { opacity: 0.6, cap: "butt" }) },
});
add({
    ...base("engraving", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant<PathData>({ contours: [{ closed: true, vertices: chamfered(14, 38, 6).map(vertex) }] }),
    style: { stroke: stroke(GUNMETAL, 1, { opacity: 0.45 }) },
});
// A faint technical grid, barely there.
const grid: PathContour[] = [];
for (let x = 32; x < WIDTH; x += 32) {
    grid.push(open([{ x, y: 0 }, { x, y: HEIGHT }]));
}
for (let y = 32; y < HEIGHT; y += 32) {
    grid.push(open([{ x: 0, y }, { x: WIDTH, y }]));
}
add({
    ...base("grid", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant({ contours: grid }),
    style: { stroke: stroke(WHITE, 0.6, { opacity: 0.03 }) },
});

// Blade A sweeps along the bottom and curls up at the right; blade B hangs
// from the top right and tucks in. Offset, never mirrored.
const sweepA = spiral(-4, 366, 3, 1094, -55);
// Blade B is cut where it meets blade A, so its tip lands on the hinge.
const fullB = spiral(1284, 30, 182, 562, -95, 562);
const landing = fullB.findIndex(({ point }) => sweepA.some((a) => Math.hypot(a.point.x - point.x, a.point.y - point.y) < 4) && point.y > 150);
const sweepB = fullB.slice(0, landing + 1).filter((_, i, all) => i % 5 === 0 || i === all.length - 1).map((sample, i, all) => ({ ...sample, s: i / (all.length - 1) }));
const bladeA = blade("blade-a", sweepA, 46, 4, [0.22, 0.5, 0.74]);
blade("blade-b", sweepB, 30, 22, [0.3, 0.62]);
const tipB = sweepB[sweepB.length - 1].point;

// Exposed hardware: machined hex bolts that turn one hex step (60°) per loop,
// which looks the same at both ends, so the loop stays seamless.
const titanium = (radius: number): GradientFillStyle =>
    linear([[0, WHITE], [0.45, hex("#7C8597")], [0.55, hex("#4A5162")], [1, hex("#E9EDF4")]], { x: 0, y: -radius }, { x: 0, y: radius });
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
const bolt = (id: string, x: number, y: number, radius: number) => {
    const turn = keyed<Vec3>(`${id}.turn`, [[0, { x: 0, y: 0, z: 0 }, "linear"], [END, { x: 0, y: 0, z: 60 }]]);
    add({ ...base(id, { outTick: END, x, y, rotation: turn }), ...hexagon(radius, 0), style: { gradientFill: titanium(radius), stroke: stroke(SHADOW, 1.5) } });
    add({ ...base(`${id}.socket`, { outTick: END, x, y, rotation: keyed<Vec3>(`${id}.socket.turn`, [[0, { x: 0, y: 0, z: 0 }, "linear"], [END, { x: 0, y: 0, z: 60 }]]) }), ...hexagon(radius * 0.42, 30), style: { fill: fill(SHADOW) } });
};
bolt("bolt.top-left", 54, 46, 9);
bolt("bolt.bottom-right", 1226, 354, 9);

// The hinge: where blade B lands on blade A, a machined plate along A's
// tangent, held by a bolt. Structure left in plain sight.
const nearest = sweepA.reduce((best, sample) =>
    Math.hypot(sample.point.x - tipB.x, sample.point.y - tipB.y) < Math.hypot(best.point.x - tipB.x, best.point.y - tipB.y) ? sample : best);
const hinge = nearest.point;
const hingeAngle = Math.atan2(nearest.normal.x, -nearest.normal.y) * (180 / Math.PI);
add({
    ...base("hinge.plate", { outTick: END, x: hinge.x, y: hinge.y, rotation: hingeAngle }),
    type: "rect",
    size: constant({ width: 44, height: 20 }),
    cornerRadius: constant(10),
    style: { gradientFill: titanium(10), stroke: stroke(SHADOW, 1.5) },
});
bolt("hinge.bolt", hinge.x, hinge.y, 6.5);

// The glint: a blurple-cored highlight that rides blade A's edge from root
// to tip, twice a loop, hidden at the loop point.
const GLINTS = [48, 150];
const edgePath = bladeA.upper;
const glintPosition: Array<[number, Vec3] | [number, Vec3, "linear"]> = [[0, { ...edgePath[0], z: 0 }]];
const glintOpacity: Array<[number, number] | [number, number, typeof OUT]> = [[0, 0]];
for (const start of GLINTS) {
    const duration = 44;
    for (let k = 0; k <= 12; k += 1) {
        // Ease in along the curve: the glint accelerates with it.
        const t = (k / 12) ** 1.6;
        const point = edgePath[Math.round(t * (edgePath.length - 1))];
        glintPosition.push([start + Math.round((k / 12) * duration), { ...point, z: 0 }, "linear"]);
    }
    glintOpacity.push([start, 0, OUT], [start + 6, 1], [start + duration - 6, 1, OUT], [start + duration, 0]);
}
add({
    ...base("glint", { outTick: END, position: keyed<Vec3>("glint.position", glintPosition), opacity: keyed("glint.opacity", glintOpacity) }),
    type: "ellipse",
    size: constant({ width: 34, height: 34 }),
    style: { gradientFill: radial([[0, WHITE], [0.25, ACCENT_LIGHT], [0.55, hex("#5865F255")], [1, hex("#5865F200")]], 17) },
});

// --- The wordmark: wide, slanted titanium, set off-centre ---

const WORD_X = 450;
const WORD_Y = 170;
const word = monolineWordmark("DISCORD MCP", { capHeight: 66, polyline: true });
word.letters.forEach((letter, index) => {
    if (letter.contours.length === 0) {
        return;
    }
    const start = 14 + index * 5;
    const path = constant<PathData>({ contours: [...letter.contours] });
    const isMcp = index >= word.letters.length - 3;
    const layers: Array<[string, Color, number, number]> = [
        ["shadow", SHADOW, word.stroke + 6, 5],
        ["body", TITANIUM, word.stroke, 0],
        // Chrome reads as a horizon: a dark band under the bright line.
        ["horizon", GUNMETAL, word.stroke * 0.22, word.stroke * 0.22],
        // Restraint: the accent is only the specular line on "MCP".
        ["highlight", isMcp ? ACCENT_LIGHT : WHITE, word.stroke * 0.3, -word.stroke * 0.2],
    ];
    for (const [layer, color, width, offset] of layers) {
        const id = `word.${index}.${layer}`;
        add({
            ...base(id, { outTick: END, x: WORD_X, y: WORD_Y + offset, skew: constant({ x: -10, y: 0 }), scale: { x: 1.1, y: 1 } }),
            type: "path",
            path,
            style: { stroke: stroke(color, width, { opacity: fading(`${id}.opacity`, start) }) },
            operators: [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[start, 0, OUT], [start + 24, 1]]) })],
        });
    }
});

// --- Callouts: each points at a part and names what the project does ---

const microtype = (id: string, text: string, x: number, y: number, align: "left" | "right", color: Color, opacity: Animatable<number>, inTick: number) => {
    const label = cellWordmark(text, { cell: 2.5, gap: 0.5, face: "3x5" });
    add({
        ...base(id, { outTick: END, inTick, x: align === "left" ? x + label.width / 2 : x - label.width / 2, y }),
        type: "path",
        path: constant(label.path),
        style: { fill: fill(color, opacity) },
    });
};
const callout = (id: string, points: Point[], start: number, text: string, align: "left" | "right", color: Color) => {
    add({
        ...base(`${id}.dot`, { outTick: END, inTick: start, x: points[0].x, y: points[0].y, opacity: fading(`${id}.dot.opacity`, start) }),
        type: "ellipse",
        size: constant({ width: 6, height: 6 }),
        style: { fill: fill(color) },
    });
    add({
        ...base(`${id}.leader`, { outTick: END, inTick: start, x: 0, y: 0 }),
        type: "path",
        path: constant({ contours: [open(points)] }),
        style: { stroke: stroke(color, 1, { opacity: fading(`${id}.leader.opacity`, start, 0.6), cap: "butt" }) },
        operators: [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[start, 0, OUT], [start + 16, 1]]) })],
    });
    const tip = points[points.length - 1];
    microtype(`${id}.label`, text, align === "left" ? tip.x + 8 : tip.x - 8, tip.y, align, color, fading(`${id}.label.opacity`, start + 12, 0.85), start + 12);
};
const rivet = (bladeId: string, index: number) => {
    const node = nodes[`${bladeId}.rivet-${index}`];
    return (node.transform.position as { value: Vec3 }).value;
};
const r0 = rivet("blade-a", 0);
callout("callout.tool", [{ x: 214, y: 112 }, { x: 214, y: 56 }, { x: 240, y: 56 }], 74, "ONE TOOL. RUNS YOUR CODE.", "left", TITANIUM);
callout("callout.agent", [{ x: r0.x, y: r0.y }, { x: r0.x + 40, y: r0.y - 52 }, { x: r0.x + 72, y: r0.y - 52 }], 92, "TOKENS STAY IN THE AGENT.", "left", ACCENT_LIGHT);
callout("callout.kept", [{ x: hinge.x, y: hinge.y }, { x: hinge.x + 40, y: hinge.y + 40 }, { x: hinge.x + 72, y: hinge.y + 40 }], 110, "HELPERS KEPT ACROSS RESTARTS.", "left", TITANIUM);

const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: "discord-mcp-banner",
    name: "discord-mcp README banner",
    canvas: { width: WIDTH, height: HEIGHT, pixelAspectRatio: 1, backgroundColor: MATTE },
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
        marker("blades", 4, { name: "Blade edges and veins draw on", durationTicks: 60 }),
        marker("wordmark", 14, { name: "Wordmark draws on", durationTicks: 70 }),
        marker("glint", GLINTS[0], { name: "Glint rides the curve", durationTicks: 44 }),
        marker("callouts", 74, { name: "Callouts", durationTicks: 50 }),
        marker("fade", FADE_START, { name: "Fade to loop", durationTicks: 24 }),
    ],
    design: {
        description:
            "discord-mcp banner in the design language of 2000s Oakley: accelerating curves (Euler spirals), offset geometry, exposed structure, matte black and titanium with one accent.",
        accessibilityLabel:
            "discord-mcp. One tool runs your code; tokens stay in the agent; helpers are kept across restarts.",
        tokens: { looping: true },
    },
    capabilities: { required: [], optional: [], unsupportedPolicy: "error" },
});

assertValidAnimationDocument(document);
writeFileSync(new URL("./banner.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
console.log(`banner.json: ${order.length} nodes, ${END} ticks at ${FPS} fps, revision ${document.revision}`);
