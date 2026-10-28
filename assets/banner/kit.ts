// Shared parts for the banner and the trailer: liquid chrome, the block
// lettering, the crossed-blade emblem and the steel bunker. See banner.ts
// for the style these follow.

import {
    base,
    constant,
    fill,
    hex,
    keyed,
    stroke,
    type Animatable,
    type Color,
    type GradientFillStyle,
    type PathData,
    type SceneNode,
} from "@clayzo/animation";

export const BLACK = hex("#050608");
export const WHITE = hex("#FFFFFF");
export const STEEL_DARK = hex("#101217");
export const STEEL = hex("#1A1D24");
export const STEEL_LIGHT = hex("#2A2F39");
export const MICROTYPE = hex("#9AA3B5");

// Long, heavy eases for reveals; a hard snap for things that lock.
export const SLOW = { x1: 0.6, y1: 0, x2: 0.15, y2: 1 };
export const IN_OUT = { x1: 0.45, y1: 0, x2: 0.55, y2: 1 };
export const SNAP = { x1: 0.7, y1: 0, x2: 0.2, y2: 1 };
export type Ease = typeof SLOW;
export type Key<T> = [number, T] | [number, T, Ease | "linear"];

// The nodes of one composition, in drawing order.
export class Scene {
    readonly nodes: Record<string, SceneNode> = {};
    readonly order: string[] = [];
    readonly end: number;
    constructor(end: number) {
        this.end = end;
    }
    add(node: SceneNode) {
        this.nodes[node.id] = node;
        this.order.push(node.id);
        return node.id;
    }
    // A node inside a group: registered, but not a root.
    child(node: SceneNode) {
        this.nodes[node.id] = node;
        return node.id;
    }
}

export type Point = { x: number; y: number };
export const vertex = (p: Point) => ({ point: p, inTangent: { x: 0, y: 0 }, outTangent: { x: 0, y: 0 } });
const area = (points: Point[]) => points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
}, 0);
// Closed contours; holes are wound against the outline so they cut through.
export const shape = (outline: Point[], ...holes: Point[][]): PathData => {
    const sign = Math.sign(area(outline));
    return {
        contours: [outline, ...holes.map((h) => (Math.sign(area(h)) === sign ? [...h].reverse() : h))].map((points) => ({
            closed: true,
            vertices: points.map(vertex),
        })),
    };
};
export const openPath = (...points: Point[]): PathData => ({ contours: [{ closed: false, vertices: points.map(vertex) }] });
export const pts = (...xy: number[]): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < xy.length; i += 2) {
        out.push({ x: xy[i], y: xy[i + 1] });
    }
    return out;
};
// A rectangle with its corners cut at 45°.
export const chamfered = (x: number, y: number, w: number, h: number, cut: number) =>
    pts(x + cut, y, x + w - cut, y, x + w, y + cut, x + w, y + h - cut, x + w - cut, y + h, x + cut, y + h, x, y + h - cut, x, y + cut);

export const linear = (stops: Array<[number, Color]>, from: Point, to: Point, opacity: Animatable<number> = constant(1)): GradientFillStyle => ({
    kind: "linear",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant(from),
    end: constant(to),
    opacity,
});
export const radial = (stops: Array<[number, Color]>, radius: number): GradientFillStyle => ({
    kind: "radial",
    stops: constant(stops.map(([position, color]) => ({ position, color }))),
    start: constant({ x: 0, y: 0 }),
    end: constant({ x: radius, y: 0 }),
    opacity: constant(1),
});

// Liquid chrome: bright sky, a hard dark horizon just below the middle,
// then a lighter ground reflection.
export const CHROME: Array<[number, Color]> = [
    [0, hex("#FFFFFF")],
    [0.18, hex("#E4E9F1")],
    [0.44, hex("#8C95A6")],
    [0.5, hex("#14171D")],
    [0.56, hex("#3B4250")],
    [0.8, hex("#B8C1CF")],
    [1, hex("#F4F7FB")],
];
// The same chrome, tinted Discord blurple.
export const BLURPLE_CHROME: Array<[number, Color]> = [
    [0, hex("#FFFFFF")],
    [0.18, hex("#D8DCFF")],
    [0.44, hex("#7C86F7")],
    [0.5, hex("#14163A")],
    [0.56, hex("#3A43B8")],
    [0.8, hex("#A9B1FF")],
    [1, hex("#EEF0FF")],
];
// Top to bottom over [top, bottom].
export const chrome = (stops: Array<[number, Color]>, top: number, bottom: number) => linear(stops, { x: 0, y: top }, { x: 0, y: bottom });

export type Pass = { start: number; span: number };
// A travelling reflection: a soft white band whose gradient endpoints move
// from `from` to `to` (in the node's local space) during each pass, and are
// parked out of sight otherwise.
export const sweep = (id: string, passes: Pass[], from: number, to: number, width: number, strength = "B0"): GradientFillStyle => {
    const rest = { x: from - width, y: 0 };
    const restEnd = { x: from, y: -width * 0.35 };
    const startKeys: Array<Key<Point>> = [[0, rest]];
    const endKeys: Array<Key<Point>> = [[0, restEnd]];
    for (const { start, span } of passes) {
        startKeys.push([start, rest, IN_OUT], [start + span, { x: to, y: 0 }], [start + span + 1, rest]);
        endKeys.push([start, restEnd, IN_OUT], [start + span, { x: to + width, y: -width * 0.35 }], [start + span + 1, restEnd]);
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

export const hexagon = (radius: number, offset: number) => ({
    type: "polystar" as const,
    variant: "polygon" as const,
    points: constant(6),
    innerRadius: constant(0),
    outerRadius: constant(radius),
    innerRoundness: constant(0),
    outerRoundness: constant(0),
    rotationOffset: constant(offset),
});

// --- The emblem: two crossed blades of liquid chrome, held by a hex bolt ---

type Sample = { point: Point; normal: Point; s: number };
// An Euler spiral (curvature growing along it): the accelerating curve.
export function spiral(x: number, y: number, headingDeg: number, length: number, turnDeg: number, count = 64): Sample[] {
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
// Drawn about the emblem's origin; offset, not mirrored.
const spines = [spiral(-122, 112, -40, 320, -24), spiral(-118, -118, 50, 300, 30)];
// Where the two spines cross: the bolt sits there, and callers anchor the
// emblem on it.
export const EMBLEM_CROSSING = spines[0].reduce((best, a) => {
    const d = Math.min(...spines[1].map((b) => Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y)));
    return d < best.d ? { d, point: a.point } : best;
}, { d: Infinity, point: { x: 0, y: 0 } }).point;
export const EMBLEM_BLADES = [fang(spines[0], 32), fang(spines[1], 26)];

// The emblem's parts, as children for a group: depth, chrome bodies, their
// reflections, and the bolt (which turns if `boltTurn` is given).
export const emblem = (scene: Scene, id: string, passes: Pass[], boltTurn?: Animatable<{ x: number; y: number; z: number }>) => {
    const end = scene.end;
    const parts: string[] = [];
    for (const [index, outline] of EMBLEM_BLADES.entries()) {
        const path = constant(shape(outline));
        parts.push(scene.child({ ...base(`${id}.${index}.depth`, { outTick: end, x: 7, y: 9 }), type: "path", path, style: { fill: fill(BLACK, 0.9) } }));
        parts.push(scene.child({
            ...base(`${id}.${index}.body`, { outTick: end, x: 0, y: 0 }),
            type: "path",
            path,
            style: { gradientFill: chrome(CHROME, -130, 130), stroke: stroke(BLACK, 2) },
        }));
    }
    for (const [index, outline] of EMBLEM_BLADES.entries()) {
        parts.push(scene.child({
            ...base(`${id}.${index}.sweep`, { outTick: end, x: 0, y: 0 }),
            type: "path",
            path: constant(shape(outline)),
            style: { gradientFill: sweep(`${id}.${index}.sweep`, passes, -170, 170, 90) },
        }));
    }
    const { x, y } = EMBLEM_CROSSING;
    parts.push(scene.child({ ...base(`${id}.bolt`, { outTick: end, x, y, rotation: boltTurn }), ...hexagon(19, 0), style: { gradientFill: chrome(CHROME, -19, 19), stroke: stroke(BLACK, 2) } }));
    parts.push(scene.child({ ...base(`${id}.bolt.socket`, { outTick: end, x, y, rotation: boltTurn }), ...hexagon(8, 30), style: { fill: fill(BLACK) } }));
    return parts;
};

// --- The lettering: wide, italic, sharp-edged block letters ---

// Letters on a cap-height grid: t is the stroke, c the chamfer.
export const glyph = (letter: string, H: number): { width: number; path: PathData } => {
    const t = H * 0.25;
    const c = H * 0.2;
    const ci = c * 0.5;
    const b = H * 0.56;
    // The middle bar of E, F, G, H, S.
    const m0 = (H - t) / 2;
    const m1 = (H + t) / 2;
    // Diagonal strokes are a little wider so they read as heavy as the rest.
    const d = t * 1.25;
    switch (letter) {
        case " ":
            return { width: H * 0.4, path: { contours: [] } };
        case ".":
            return { width: t, path: shape(pts(0, H - t, t, H - t, t, H, 0, H)) };
        case "-": {
            const W = H * 0.5;
            return { width: W, path: shape(pts(0, m0, W, m0, W, m1, 0, m1)) };
        }
        case "A": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(c, 0, W - c, 0, W, c, W, H, W - t, H, W - t, b, t, b, t, H, 0, H, 0, c), pts(t, t, W - t, t, W - t, b - t, t, b - t)) };
        }
        case "B": {
            const W = H * 1.0;
            return {
                width: W,
                path: shape(
                    pts(0, 0, W - c, 0, W, c, W, H / 2 - ci, W - ci, H / 2, W, H / 2 + ci, W, H - c, W - c, H, 0, H),
                    pts(t, t, W - t, t, W - t, m0, t, m0),
                    pts(t, m1, W - t, m1, W - t, H - t, t, H - t),
                ),
            };
        }
        case "E": {
            const W = H * 0.9;
            return { width: W, path: shape(pts(c, 0, W, 0, W, t, t, t, t, m0, W * 0.85, m0, W * 0.85, m1, t, m1, t, H - t, W, H - t, W, H, 0, H, 0, c)) };
        }
        case "F": {
            const W = H * 0.88;
            return { width: W, path: shape(pts(c, 0, W, 0, W, t, t, t, t, m0, W * 0.85, m0, W * 0.85, m1, t, m1, t, H, 0, H, 0, c)) };
        }
        case "G": {
            const W = H * 0.96;
            return { width: W, path: shape(pts(c, 0, W, 0, W, t, t, t, t, H - t, W - t, H - t, W - t, m1, W * 0.5, m1, W * 0.5, m0, W, m0, W, H, c, H, 0, H - c, 0, c)) };
        }
        case "H": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(0, 0, t, 0, t, m0, W - t, m0, W - t, 0, W, 0, W, H, W - t, H, W - t, m1, t, m1, t, H, 0, H)) };
        }
        case "J": {
            const W = H * 0.85;
            return { width: W, path: shape(pts(W - t, 0, W, 0, W, H - c, W - c, H, 0, H, 0, H - t, W - t, H - t)) };
        }
        case "K": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(0, 0, t, 0, t, m0, W - d, 0, W, 0, t * 1.9, H / 2, W, H, W - d, H, t, m1, t, H, 0, H)) };
        }
        case "L": {
            const W = H * 0.85;
            return { width: W, path: shape(pts(0, 0, t, 0, t, H - t, W, H - t, W, H, 0, H)) };
        }
        case "N": {
            const W = H * 1.05;
            return { width: W, path: shape(pts(0, 0, d, 0, W - t, H * 0.62, W - t, 0, W, 0, W, H, W - d, H, t, H * 0.38, t, H, 0, H)) };
        }
        case "T": {
            const W = H * 0.95;
            return { width: W, path: shape(pts(0, 0, W, 0, W, t, W / 2 + t / 2, t, W / 2 + t / 2, H, W / 2 - t / 2, H, W / 2 - t / 2, t, 0, t)) };
        }
        case "U": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(0, 0, t, 0, t, H - t, W - t, H - t, W - t, 0, W, 0, W, H - c, W - c, H, c, H, 0, H - c)) };
        }
        case "V": {
            const W = H * 1.05;
            return { width: W, path: shape(pts(0, 0, d, 0, W / 2, H * 0.7, W - d, 0, W, 0, W / 2 + d * 0.6, H, W / 2 - d * 0.6, H)) };
        }
        case "W": {
            const W = H * 1.28;
            const half = t / 2;
            return { width: W, path: shape(pts(0, 0, t, 0, t, H - t, W / 2 - half, H - t, W / 2 - half, H * 0.28, W / 2 + half, H * 0.28, W / 2 + half, H - t, W - t, H - t, W - t, 0, W, 0, W, H - c, W - c, H, 0, H)) };
        }
        case "X": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(0, 0, d, 0, W / 2, H * 0.36, W - d, 0, W, 0, W / 2 + d * 0.6, H / 2, W, H, W - d, H, W / 2, H * 0.64, d, H, 0, H, W / 2 - d * 0.6, H / 2)) };
        }
        case "Y": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(0, 0, d, 0, W / 2, H * 0.36, W - d, 0, W, 0, W / 2 + t / 2, H * 0.56, W / 2 + t / 2, H, W / 2 - t / 2, H, W / 2 - t / 2, H * 0.56)) };
        }
        case "Z": {
            const W = H * 0.95;
            return { width: W, path: shape(pts(0, 0, W, 0, W, t, d * 1.2, H - t, W, H - t, W, H, 0, H, 0, H - t, W - d * 1.2, t, 0, t)) };
        }
        case "D": {
            const W = H * 1.0;
            return { width: W, path: shape(pts(0, 0, W - c, 0, W, c, W, H - c, W - c, H, 0, H), pts(t, t, W - t - ci, t, W - t, t + ci, W - t, H - t - ci, W - t - ci, H - t, t, H - t)) };
        }
        case "I":
            return { width: t, path: shape(pts(0, 0, t, 0, t, H, 0, H)) };
        case "S": {
            const W = H * 0.96;
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

export const SKEW = constant({ x: -14, y: 0 });
export type LineOptions = {
    stops: Array<[number, Color]>;
    passes: Pass[];
    stretch?: number;
    // Opacity for each letter, given its position along the line (0 to 1).
    opacity: (index: number, along: number) => Animatable<number>;
};
// One line of chrome letters starting at (x, y). Each letter is a group of
// depth, chrome body and reflection; the reflection crosses the whole line,
// so each letter's copy of it is the line's band shifted into its own space.
export const lettering = (scene: Scene, id: string, text: string, x: number, y: number, H: number, options: LineOptions) => {
    const stretch = options.stretch ?? 1.16;
    const gap = H * 0.16;
    const letters = [...text].map((letter) => glyph(letter, H));
    const total = letters.reduce((sum, g) => sum + g.width * stretch, 0) + gap * (letters.length - 1);
    const depth = H * 0.065;
    let cursor = x;
    for (const [index, { width, path }] of letters.entries()) {
        const letterId = `${id}.${index}`;
        const offset = cursor - x;
        if (path.contours.length === 0) {
            cursor += width * stretch + gap;
            continue;
        }
        const parts = [
            scene.child({ ...base(`${letterId}.depth`, { outTick: scene.end, x: depth, y: depth * 1.15 }), type: "path", path: constant(path), style: { fill: fill(BLACK, 0.95) } }),
            scene.child({ ...base(`${letterId}.body`, { outTick: scene.end, x: 0, y: 0 }), type: "path", path: constant(path), style: { gradientFill: chrome(options.stops, 0, H), stroke: stroke(BLACK, 2) } }),
            scene.child({
                ...base(`${letterId}.sweep`, { outTick: scene.end, x: 0, y: 0 }),
                type: "path",
                path: constant(path),
                style: { gradientFill: sweep(`${letterId}.sweep`, options.passes, (-160 - offset) / stretch, (total + 160 - offset) / stretch, 110) },
            }),
        ];
        scene.add({
            ...base(letterId, { outTick: scene.end, x: cursor, y, skew: SKEW, scale: { x: stretch, y: 1 }, opacity: options.opacity(index, offset / total) }),
            type: "group",
            children: parts,
        });
        cursor += width * stretch + gap;
    }
    return { width: total, right: x + total };
};
// The width a line of lettering will take, for centring it.
export const letteringWidth = (text: string, H: number, stretch = 1.16) =>
    [...text].reduce((sum, letter) => sum + glyph(letter, H).width * stretch, 0) + H * 0.16 * (text.length - 1);

// --- The bunker: heavy steel plate, grooved seams, domed rivets ---

export const steelPlate = (scene: Scene, id: string, outline: Point[], top: number, bottom: number) => {
    scene.add({
        ...base(id, { outTick: scene.end, x: 0, y: 0 }),
        type: "path",
        path: constant(shape(outline)),
        style: { gradientFill: linear([[0, STEEL_LIGHT], [0.35, STEEL], [1, STEEL_DARK]], { x: 0, y: top }, { x: 0, y: bottom }) },
    });
};
// Galvanised sheen: a broad diagonal band, barely there.
export const sheenBand = (scene: Scene, id: string, x: number, height: number, width = 150) => {
    scene.add({
        ...base(id, { outTick: scene.end, x: 0, y: 0 }),
        type: "path",
        path: constant(shape(pts(x, 0, x + width, 0, x + width * 0.2, height, x - width * 0.8, height))),
        style: { fill: fill(WHITE, 0.018) },
    });
};
// A grooved seam: a dark cut with a lit lip beside it.
export const seam = (scene: Scene, id: string, a: Point, b: Point, depth = 4) => {
    scene.add({ ...base(`${id}.cut`, { outTick: scene.end, x: 0, y: 0 }), type: "path", path: constant(openPath(a, b)), style: { stroke: stroke(BLACK, depth, { cap: "butt" }) } });
    const lip = a.x === b.x ? { x: depth * 0.62, y: 0 } : { x: 0, y: depth * 0.62 };
    scene.add({
        ...base(`${id}.lip`, { outTick: scene.end, x: 0, y: 0 }),
        type: "path",
        path: constant(openPath({ x: a.x + lip.x, y: a.y + lip.y }, { x: b.x + lip.x, y: b.y + lip.y })),
        style: { stroke: stroke(hex("#3C4250"), depth / 4, { cap: "butt" }) },
    });
};
// A domed rivet: a dark dome with a highlight up and to the left.
export const rivet = (scene: Scene, id: string, x: number, y: number, size = 13) => {
    const k = size / 13;
    scene.add({
        ...base(id, { outTick: scene.end, x, y }),
        type: "ellipse",
        size: constant({ width: size, height: size }),
        style: { gradientFill: linear([[0, hex("#5B6373")], [0.5, hex("#262A33")], [1, BLACK]], { x: -4 * k, y: -5 * k }, { x: 4 * k, y: 5 * k }), stroke: stroke(BLACK, 1.5 * k) },
    });
    scene.add({
        ...base(`${id}.shine`, { outTick: scene.end, x: x - 2 * k, y: y - 2.5 * k }),
        type: "ellipse",
        size: constant({ width: 4 * k, height: 3 * k }),
        style: { fill: fill(WHITE, 0.55) },
    });
};
