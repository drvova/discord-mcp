// Shared parts for the banner and the trailer: the scene builder, path and
// gradient helpers, the travelling light, hex hardware and the wide block
// lettering. See banner.ts and trailer.ts for the design they follow.

import {
    constant,
    hex,
    keyed,
    type Animatable,
    type Color,
    type GradientFillStyle,
    type PathData,
    type SceneNode,
} from "@clayzo/animation";

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

// --- The lettering: wide, italic, sharp-edged block letters ---

// Letters on a cap-height grid: t is the stroke, c the chamfer.
// `cut` sets the stroke weight and chamfer as fractions of the cap height.
export type Cut = { weight: number; chamfer: number };
export const glyph = (letter: string, H: number, cut: Cut): { width: number; path: PathData } => {
    const t = H * cut.weight;
    const c = H * cut.chamfer;
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
