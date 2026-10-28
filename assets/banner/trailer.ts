// A 25-second teaser trailer, authored with Clayzo, in the language of the
// banner and the player page: the Y2K Universal Design Spec and its v5 kit.
//
//   node trailer.ts                     writes trailer.json and validates it
//   node trailer.ts --preview && npx clayzo export trailer-preview.json ../img/trailer.svg --format svg
//                                       the silent, looping preview the README shows, with a play
//                                       badge that links to the player page (site/)
//   npx clayzo export trailer.json trailer.mp4 --format mp4 --tier final
//   python3 trailer-audio.py            synthesises the soundtrack (trailer.wav)
//   ffmpeg -i trailer.mp4 -i trailer.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart ../video/trailer.mp4
// README.md has the full recipe, including the WebM and the player's poster.
//
// The language: textured brushed titanium (the kit's PBR base colour, in
// textures/) on aerodynamic shells with one biomorphic channel; molded
// elastomer as the soft counter-material; smoked polymer as the one
// translucent detail; the kit's contour lines and signal bars; bone
// lettering in a wide, upright cut; and one accent, Ion Blue, for state
// only (the HUD's status word, signal bars, the key, the lock). Motion is
// the spec's: material revealed by moving light, slow hero moves, short
// panel transitions, no glitches and no permanent pulsing.
//
// Shots (30 fps ticks), timed to the soundtrack in trailer-audio.py:
//   1    0– 75  STANDBY  light reveals a titanium shell; contour lines draw on
//   2   75–150  ARMED    a recessed titanium ring turns and seats         ONE TOOL.
//   3  150–240  RUN      two shells slide in and interlock                RUN
//   4  240–345  LIVE     schematic panel: wireframe, spec labels, signal  YOUR CODE. LIVE API.
//   5  345–435  KEPT     modular titanium panels drop and lock in a stack KEPT ACROSS RESTARTS
//   6  435–540  SEALED   titanium doors close over an Ion Blue key        TOKENS NEVER LEAVE
//   7  540–630  SEALED   material macros, then a card, then black         ENCRYPTED AT REST
//   8  630–750  OK       end card: the shell, Ion Blue along its channel, the name; hold

import { readFileSync, writeFileSync } from "node:fs";
import {
    ANIMATION_DOCUMENT_VERSION,
    assertValidAnimationDocument,
    base,
    cellWordmark,
    circleContour,
    constant,
    fill,
    hex,
    keyed,
    marker,
    parseSvgPath,
    stroke,
    trim,
    withComputedRevision,
    type Animatable,
    type Color,
    type PathData,
    type SceneNode,
    type Vec3,
} from "@clayzo/animation";
import { IN_OUT, SLOW, SNAP, Scene, glyph, hexagon, linear, openPath, radial, shape, sweep, type Cut, type Key, type Point } from "./kit.ts";

const W = 1920;
const H = 1080;
const FPS = 30;
const END = 25 * FPS;
const CENTRE = { x: W / 2, y: H / 2 };

// The spec's palette.
const OBSIDIAN = hex("#101214");
const GRAPHITE = hex("#25292D");
const TITANIUM = hex("#A6ABB1");
const CHROME = hex("#D4DCE1");
const BONE = hex("#E4E1D8");
const EDGE = hex("#4B555C");
const ION = hex("#65B8D6");

const scene = new Scene(END);
const v3 = (x: number, y = x): Vec3 => ({ x, y, z: 1 });
const at = (x: number, y: number): Vec3 => ({ x, y, z: 0 });

// --- Textures: the kit's PBR base colours ---

const assets: Record<string, { id: string; type: "image"; uri: string; width: number; height: number; mimeType: string }> = {};
const texture = (id: string) => {
    const data = readFileSync(new URL(`./textures/${id}.jpg`, import.meta.url)).toString("base64");
    assets[id] = { id, type: "image", uri: `data:image/jpeg;base64,${data}`, width: 512, height: 512, mimeType: "image/jpeg" };
    return id;
};
const TI = texture("brushed-titanium");
const MESH = texture("engineered-mesh");
const CARBON = texture("carbon-weave");
const RIPSTOP = texture("ripstop-textile");
const SATIN = texture("satin-aluminum");

// --- Timing helpers ---

// Visible inside the windows, with short (3-tick) panel transitions.
const windows = (id: string, spans: Array<[number, number]>, fade = 3): Animatable<number> => {
    const keys: Array<Key<number>> = [[0, spans[0][0] <= 0 ? 1 : 0]];
    for (const [start, end] of spans) {
        if (start > 0) {
            keys.push([Math.max(start - fade, keys[keys.length - 1][0] + 1), 0], [start, 1]);
        }
        if (end < END) {
            keys.push([end - fade, 1], [end, 0]);
        }
    }
    return keyed(id, keys);
};
const appear = (id: string, from: number, length = 8, until = END): Animatable<number> =>
    keyed(id, until < END ? [[0, 0], [from, 0, SLOW], [from + length, 1], [until - 4, 1], [until, 0]] : [[0, 0], [from, 0, SLOW], [from + length, 1]]);

// --- Shapes, drawn about their own origin ---

const path = (d: string): PathData => parseSvgPath(d).path;
// The same outline as many short straight segments, sampled along each
// curve: trims then draw partial curves smoothly, and holes can be cut.
const points = (d: PathData, steps = 24): Point[][] =>
    d.contours.map((contour) => {
        const vs = contour.vertices;
        const out: Point[] = [];
        const count = contour.closed ? vs.length : vs.length - 1;
        for (let i = 0; i < count; i += 1) {
            const a = vs[i];
            const b = vs[(i + 1) % vs.length];
            const p1 = { x: a.point.x + a.outTangent.x, y: a.point.y + a.outTangent.y };
            const p2 = { x: b.point.x + b.inTangent.x, y: b.point.y + b.inTangent.y };
            for (let k = 0; k < steps; k += 1) {
                const t = k / steps;
                const u = 1 - t;
                out.push({
                    x: u * u * u * a.point.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.point.x,
                    y: u * u * u * a.point.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.point.y,
                });
            }
        }
        if (!contour.closed) {
            out.push(vs[vs.length - 1].point);
        }
        return out;
    });
const sampled = (d: PathData): PathData => openPath(...points(d)[0]);
const SHELL = "M-380 60 C-350 -150 -120 -230 80 -170 C230 -125 330 -40 380 40 C400 120 300 170 160 150 C40 135 -60 190 -200 175 C-310 165 -395 130 -380 60 Z";
const SHELL_CHANNEL = "M-318 74 C-210 -6 -40 -16 90 22 C200 56 282 42 342 30";
const SHELL_B = "M-40 -20 C60 -150 300 -150 400 -30 C470 60 400 170 250 175 C140 178 40 120 -40 -20 Z";
const bbox = (d: PathData) => {
    // Control points too: curves bulge past their end points.
    const all = d.contours.flatMap((c) => c.vertices.flatMap((v) => [v.point, { x: v.point.x + v.inTangent.x, y: v.point.y + v.inTangent.y }, { x: v.point.x + v.outTangent.x, y: v.point.y + v.outTangent.y }]));
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

// A textured part: the texture tiled at native resolution (for `screenScale`)
// and clipped to the outline, shaded top to bottom, with an edge and an
// optional travelling light. Returns the ids of its parts, for a group.
let clipCount = 0;
const SHADE: Array<[number, Color]> = [[0, hex("#FFFFFF2E")], [0.45, hex("#FFFFFF00")], [1, hex("#00000085")]];
const part = (id: string, outline: PathData, tex: string, options: { screenScale?: number; light?: Array<{ start: number; span: number }>; shade?: boolean | Array<[number, Color]>; edge?: Color; edgeWidth?: number } = {}) => {
    const box = bbox(outline);
    const tile = 512 / (options.screenScale ?? 1);
    const tiles: string[] = [];
    for (let ty = box.y; ty < box.y + box.h; ty += tile) {
        for (let tx = box.x; tx < box.x + box.w; tx += tile) {
            tiles.push(scene.child({ ...base(`${id}.tile-${tiles.length}`, { outTick: END, x: tx + tile / 2, y: ty + tile / 2 }), type: "image", assetId: tex, size: constant({ width: tile + 1, height: tile + 1 }), fit: "fill" } as SceneNode));
        }
    }
    clipCount += 1;
    const clipId = scene.child({ ...base(`${id}.clip`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(outline), style: {} });
    const parts = [scene.child({ ...base(`${id}.surface`, { outTick: END, x: 0, y: 0 }), type: "group", children: tiles, clipPathId: clipId })];
    if (options.shade !== false) {
        parts.push(scene.child({
            ...base(`${id}.shade`, { outTick: END, x: 0, y: 0 }),
            type: "path",
            path: constant(outline),
            style: { gradientFill: linear(Array.isArray(options.shade) ? options.shade : SHADE, { x: 0, y: box.y }, { x: 0, y: box.y + box.h }) },
        }));
    }
    if (options.light) {
        parts.push(scene.child({ ...base(`${id}.light`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(outline), style: { gradientFill: sweep(`${id}.light`, options.light, box.x - 60, box.x + box.w + 60, box.w * 0.35, "4C") } }));
    }
    parts.push(scene.child({ ...base(`${id}.edge`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(outline), style: { stroke: stroke(options.edge ?? EDGE, options.edgeWidth ?? 1.5) } }));
    return parts;
};
// The channel pressed into a shell: a dark cut with a lit lower lip.
const channel = (id: string, d: string, width = 18) => [
    scene.child({ ...base(`${id}.lip`, { outTick: END, x: 0, y: width * 0.22 }), type: "path", path: constant(path(d)), style: { stroke: stroke(hex("#FFFFFF"), 2, { opacity: 0.6 }) } }),
    scene.child({ ...base(`${id}.cut`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(path(d)), style: { stroke: stroke(GRAPHITE, width) } }),
];
// Molded elastomer: a matte graphite fill with a soft top light.
const elastomer = (id: string, outline: PathData) => {
    const box = bbox(outline);
    return scene.child({
        ...base(id, { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant(outline),
        style: { gradientFill: linear([[0, hex("#3E4348")], [0.35, hex("#2E3237")], [1, hex("#1C1F23")]], { x: 0, y: box.y }, { x: 0, y: box.y + box.h }), stroke: stroke(hex("#0B0C0E"), 2) },
    });
};

// --- Type ---

const LIGHT: Cut = { weight: 0.18, chamfer: 0.06 };
const STRETCH = 1.3;
const measure = (text: string, cap: number) => [...text].reduce((sum, letter) => sum + glyph(letter, cap, LIGHT).width * STRETCH, 0) + cap * 0.16 * (text.length - 1);
// A line of bone lettering as one group, from (x, y) at its top-left.
const words = (id: string, text: string, x: number, y: number, cap: number, color: Color = BONE) => {
    const letters: string[] = [];
    let cursor = 0;
    for (const [index, letter] of [...text].entries()) {
        const { width, path: d } = glyph(letter, cap, LIGHT);
        if (d.contours.length > 0) {
            letters.push(scene.child({ ...base(`${id}.${index}`, { outTick: END, x: cursor, y: 0, scale: { x: STRETCH, y: 1 } }), type: "path", path: constant(d), style: { fill: fill(color) } }));
        }
        cursor += width * STRETCH + cap * 0.16;
    }
    return { letters, x, y };
};
// Pixel microtype, from its left edge.
const micro = (id: string, text: string, x: number, y: number, cell: number, color: Color, opacity: Animatable<number> = constant(1)) => {
    const label = cellWordmark(text, { cell, gap: cell * 0.2, face: "3x5" });
    return scene.child({ ...base(id, { outTick: END, x: x + label.width / 2, y, opacity }), type: "path", path: constant(label.path), style: { fill: fill(color) } });
};
// A card: an index label and a line of lettering, centred, sliding in a
// little and fading over a panel transition, then out.
const card = (id: string, index: string, text: string, start: number, end: number, cap: number, y: number) => {
    const width = measure(text, cap);
    const x = (W - width) / 2;
    const line = words(`${id}.words`, text, 0, 0, cap);
    const children = [...line.letters, micro(`${id}.index`, index, 0, -26, 3, TITANIUM)];
    scene.add({
        ...base(id, {
            outTick: END,
            position: keyed<Vec3>(`${id}.slide`, [[0, at(x + 18, y)], [start, at(x + 18, y), SLOW], [start + 10, at(x, y)]]),
            opacity: keyed(`${id}.fade`, [[0, 0], [start, 0, SLOW], [start + 8, 1], [end - 5, 1], [end, 0]]),
        }),
        type: "group",
        children,
    });
};
// A shot: a group shown in its windows, with an optional slow push.
const shot = (id: string, spans: Array<[number, number]>, children: string[], push?: Animatable<Vec3>) =>
    scene.add({ ...base(id, { outTick: END, x: CENTRE.x, y: CENTRE.y, anchor: CENTRE, scale: push, opacity: windows(`${id}.cut`, spans) }), type: "group", children });
const push = (id: string, from: number, to: number, a: number, b: number) =>
    keyed<Vec3>(id, from > 0 ? [[0, v3(a)], [from, v3(a), "linear"], [to, v3(b)]] : [[0, v3(a), "linear"], [to, v3(b)]]);

// --- The studio: obsidian, a faint technical grid, a soft graphite glow ---

scene.add({ ...base("studio", { outTick: END, x: CENTRE.x, y: CENTRE.y }), type: "rect", size: constant({ width: W, height: H }), cornerRadius: constant(0), style: { fill: fill(OBSIDIAN) } });
scene.add({ ...base("studio.glow", { outTick: END, x: 1040, y: 520 }), type: "ellipse", size: constant({ width: 1900, height: 1300 }), style: { gradientFill: radial([[0, hex("#2A2F35")], [0.55, hex("#1A1D21")], [1, hex("#10121400")]], 950) } });
{
    const lines = [];
    for (let x = 120; x < W; x += 120) {
        lines.push(openPath({ x, y: 0 }, { x, y: H }).contours[0]);
    }
    for (let y = 120; y < H; y += 120) {
        lines.push(openPath({ x: 0, y }, { x: W, y }).contours[0]);
    }
    scene.add({ ...base("studio.grid", { outTick: END, x: 0, y: 0 }), type: "path", path: constant({ contours: lines }), style: { stroke: stroke(CHROME, 1, { opacity: 0.035 }) } });
}

// --- 1 STANDBY: light reveals a titanium shell; contour lines draw on ---

{
    const contours: string[] = [];
    for (const [index, dy] of [-48, -24, 0, 24, 48].entries()) {
        contours.push(scene.child({
            ...base(`s1.contour-${index}`, { outTick: END, x: 0, y: dy }),
            type: "path",
            path: constant(sampled(path("M40 960 C420 860 380 560 820 610 C1180 650 1420 640 1880 300"))),
            style: { stroke: stroke(index === 2 ? TITANIUM : index % 2 ? ION : CHROME, index === 2 ? 5 : 1.4, { opacity: index === 2 ? 0.9 : 0.45 }) },
            operators: [trim(`s1.contour-${index}.trim`, { end: keyed(`s1.contour-${index}.end`, [[0, 0], [14 + index * 3, 0, SLOW], [62 + index * 3, 1]]) })],
        }));
    }
    const shell = scene.child({
        ...base("s1.shell", { outTick: END, x: 1080, y: 470, scale: 1.7, rotation: keyed<Vec3>("s1.turn", [[0, { x: 0, y: 0, z: -5 }], [75, { x: 0, y: 0, z: -2 }]]) }),
        type: "group",
        children: [...part("s1.shell.ti", path(SHELL), TI, { screenScale: 1.7, light: [{ start: 12, span: 56 }] }), ...channel("s1.shell.channel", SHELL_CHANNEL)],
    });
    shot("s1", [[0, 75], [580, 590]], [...contours, shell], push("s1.push", 0, 75, 1, 1.05));
}

// --- 2 ARMED: a recessed titanium ring turns and seats ---

const SEAT = 130;
{
    const circle = (r: number) => points({ contours: [circleContour({ x: 0, y: 0 }, r)] })[0];
    const ring = shape(circle(250), circle(166));
    const slots: string[] = [];
    for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * 360 + 30;
        slots.push(scene.child({
            ...base(`s2.slot-${i}`, { outTick: END, x: Math.cos((a * Math.PI) / 180) * 208, y: Math.sin((a * Math.PI) / 180) * 208, rotation: a + 90 }),
            type: "rect",
            size: constant({ width: 46, height: 12 }),
            cornerRadius: constant(6),
            style: { fill: fill(OBSIDIAN), stroke: stroke(hex("#FFFFFF"), 1, { opacity: 0.25 }) },
        }));
    }
    const face = scene.child({ ...base("s2.face", { outTick: END, x: 0, y: 0 }), type: "ellipse", size: constant({ width: 330, height: 330 }), style: { gradientFill: linear([[0, hex("#3E4348")], [0.4, hex("#2B2F33")], [1, hex("#17191C")]], { x: 0, y: -165 }, { x: 0, y: 165 }), stroke: stroke(hex("#0B0C0E"), 3) } });
    const recess = scene.child({ ...base("s2.recess", { outTick: END, x: 0, y: 0 }), type: "ellipse", size: constant({ width: 150, height: 150 }), style: { gradientFill: linear([[0, hex("#0B0C0E")], [1, hex("#2B2F33")]], { x: 0, y: -75 }, { x: 0, y: 75 }), stroke: stroke(EDGE, 2) } });
    const bolt = scene.child({ ...base("s2.bolt", { outTick: END, x: 0, y: 0 }), ...hexagon(46, 0), style: { gradientFill: linear([[0, CHROME], [0.45, TITANIUM], [1, hex("#6B7178")]], { x: 0, y: -46 }, { x: 0, y: 46 }), stroke: stroke(hex("#0B0C0E"), 2) } });
    const socket = scene.child({ ...base("s2.socket", { outTick: END, x: 0, y: 0 }), ...hexagon(18, 30), style: { fill: fill(OBSIDIAN) } });
    const turning = scene.child({
        ...base("s2.turning", {
            outTick: END,
            x: 0,
            y: 0,
            rotation: keyed<Vec3>("s2.turn", [[0, { x: 0, y: 0, z: -120 }], [76, { x: 0, y: 0, z: -120 }, SLOW], [SEAT - 4, { x: 0, y: 0, z: -3 }], [SEAT, { x: 0, y: 0, z: 0 }]]),
            scale: keyed<Vec3>("s2.seat", [[0, v3(1.05)], [SEAT - 4, v3(1.05), SNAP], [SEAT, v3(1)]]),
        }),
        type: "group",
        children: [...part("s2.ring", ring, TI, { screenScale: 1.5, light: [{ start: 92, span: 34 }] }), ...slots, face, recess, bolt, socket],
    });
    shot("s2", [[75, 150], [540, 550]], [scene.child({ ...base("s2.frame", { outTick: END, x: 960, y: 470, scale: 1.5 }), type: "group", children: [turning] })]);
}

// --- 3 RUN: two shells slide in and interlock ---

const LOCK = 198;
{
    const a = scene.child({
        ...base("s3.a", { outTick: END, position: keyed<Vec3>("s3.a.slide", [[0, at(-900, 0)], [152, at(-900, 0), SLOW], [LOCK, at(-120, 0)]]) }),
        type: "group",
        children: [...part("s3.a.ti", path(SHELL), TI, { screenScale: 1.3, light: [{ start: 200, span: 36 }] }), ...channel("s3.a.channel", SHELL_CHANNEL)],
    });
    const meshInlay = (() => {
        const outline = path("M40 10 C120 -80 290 -90 360 -10 C400 50 350 120 250 125 C170 128 90 90 40 10 Z");
        return part("s3.b.mesh", outline, MESH, { screenScale: 1.3, shade: false, edge: hex("#0B0C0E"), edgeWidth: 2 });
    })();
    const b = scene.child({
        ...base("s3.b", { outTick: END, position: keyed<Vec3>("s3.b.slide", [[0, at(900, 30)], [152, at(900, 30), SLOW], [LOCK, at(40, 30)]]) }),
        type: "group",
        children: [elastomer("s3.b.shell", path(SHELL_B)), ...meshInlay, scene.child({ ...base("s3.b.edge", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(path(SHELL_B)), style: { stroke: stroke(ION, 3, { opacity: keyed("s3.b.edge.lit", [[0, 0.25], [LOCK - 1, 0.25], [LOCK + 2, 1], [LOCK + 30, 0.6]]) }) } })],
    });
    // The lock: an Ion Blue ring opens at the joint.
    const ping = scene.child({
        ...base("s3.ping", { outTick: END, x: -40, y: 10, scale: keyed<Vec3>("s3.ping.grow", [[0, v3(0.2)], [LOCK, v3(0.2), SLOW], [LOCK + 24, v3(1.4)]]), opacity: keyed("s3.ping.fade", [[0, 0], [LOCK - 1, 0], [LOCK, 0.9], [LOCK + 24, 0]]) }),
        type: "ellipse",
        size: constant({ width: 200, height: 200 }),
        style: { stroke: stroke(ION, 3) },
    });
    const settle = keyed<Vec3>("s3.settle", [[0, v3(1.3)], [LOCK, v3(1.3), SNAP], [LOCK + 3, v3(1.32)], [LOCK + 10, v3(1.3), IN_OUT]]);
    shot("s3", [[150, 240], [550, 560]], [scene.child({ ...base("s3.frame", { outTick: END, x: 960, y: 450, scale: settle }), type: "group", children: [a, b, ping] })]);
}

// --- 4 LIVE: the schematic panel ---

{
    const parts: string[] = [];
    parts.push(scene.child({ ...base("s4.panel", { outTick: END, x: 960, y: 520 }), type: "rect", size: constant({ width: 1600, height: 780 }), cornerRadius: constant(24), style: { gradientFill: linear([[0, hex("#262A2F")], [1, hex("#1B1E22")]], { x: 0, y: -390 }, { x: 0, y: 390 }), stroke: stroke(EDGE, 1.5) } }));
    parts.push(micro("s4.eyebrow", "MODULE / PERFORMANCE", 220, 190, 3, TITANIUM));
    const draw = (id: string, start: number, length: number) => [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[0, 0], [start, 0, SLOW], [start + length, 1]]) })];
    const wire = [
        scene.child({ ...base("s4.wire", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath(...points(path(SHELL))[0], points(path(SHELL))[0][0])), style: { stroke: stroke(CHROME, 1.6) }, operators: draw("s4.wire", 244, 46) }),
        // Dashed, so it fades in rather than drawing on (the SVG export can't trim a dashed stroke).
        scene.child({ ...base("s4.wire.channel", { outTick: END, x: 0, y: 0, opacity: appear("s4.wire.channel.on", 262, 20) }), type: "path", path: constant(sampled(path(SHELL_CHANNEL))), style: { stroke: stroke(ION, 1.4, { dash: [6, 6] }) } }),
    ];
    for (const [index, dy] of [-26, 26].entries()) {
        wire.push(scene.child({ ...base(`s4.wire.contour-${index}`, { outTick: END, x: 0, y: dy }), type: "path", path: constant(sampled(path(SHELL_CHANNEL))), style: { stroke: stroke(TITANIUM, 1, { opacity: 0.4 }) }, operators: draw(`s4.wire.contour-${index}`, 270, 40) }));
    }
    parts.push(scene.child({ ...base("s4.x", { outTick: END, x: 640, y: 470, scale: 1.25, rotation: keyed<Vec3>("s4.tilt", [[0, { x: 0, y: 0, z: -2 }], [240, { x: 0, y: 0, z: -2 }, "linear"], [345, { x: 0, y: 0, z: 2 }]]) }), type: "group", children: wire }));
    const specs: Array<[string, Point, Point, number]> = [
        ["TOOL 01 / RUN", { x: 760, y: 360 }, { x: 1180, y: 330 }, 268],
        ["TARGET / DISCORD.JS", { x: 820, y: 470 }, { x: 1180, y: 450 }, 278],
        ["MODE / LIVE API", { x: 700, y: 590 }, { x: 1180, y: 570 }, 288],
    ];
    for (const [index, [text, from, to, start]] of specs.entries()) {
        parts.push(scene.child({ ...base(`s4.leader-${index}`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath(from, { x: to.x - 50, y: to.y }, { x: to.x - 14, y: to.y })), style: { stroke: stroke(TITANIUM, 1.2) }, operators: draw(`s4.leader-${index}`, start, 14) }));
        parts.push(scene.child({ ...base(`s4.dot-${index}`, { outTick: END, x: from.x, y: from.y, opacity: appear(`s4.dot-${index}.on`, start, 2) }), type: "ellipse", size: constant({ width: 9, height: 9 }), style: { fill: fill(BONE) } }));
        parts.push(micro(`s4.label-${index}`, text, to.x, to.y, 4.4, BONE, appear(`s4.label-${index}.on`, start + 10, 6)));
    }
    // Signal bars: one lit, travelling as the request runs.
    const BARS = 12;
    for (let i = 0; i < BARS; i += 1) {
        const h = 20 + ((i * 37) % 7) * 7;
        const x = 1190 + i * 38;
        parts.push(scene.child({ ...base(`s4.bar-${i}`, { outTick: END, x, y: 720 - h / 2 }), type: "rect", size: constant({ width: 24, height: h }), cornerRadius: constant(2), style: { fill: fill(hex("#4B555C")) } }));
        const keys: Array<Key<number>> = [[0, 0]];
        for (let pass = 0; pass < 2; pass += 1) {
            const t = 252 + pass * 46 + i * 3;
            keys.push([t - 1, 0], [t, 1], [t + 3, 1], [t + 4, 0]);
        }
        parts.push(scene.child({ ...base(`s4.bar-${i}.lit`, { outTick: END, x, y: 720 - h / 2, opacity: keyed(`s4.bar-${i}.on`, keys) }), type: "rect", size: constant({ width: 24, height: h }), cornerRadius: constant(2), style: { fill: fill(ION) } }));
    }
    parts.push(micro("s4.bars.label", "SIGNAL / 12 CH", 1190, 770, 2.6, TITANIUM));
    shot("s4", [[240, 345]], parts);
}

// --- 5 KEPT: modular titanium panels drop and lock in a stack ---

{
    const parts: string[] = [];
    const names = ["HELPER 01 / FIND CHANNEL", "HELPER 02 / PURGE SPAM", "HELPER 03 / ROLE AUDIT", "HELPER 04 / WEEKLY DIGEST", "HELPER 05 / MOD QUEUE"];
    // The kit's modular panel: chamfered, one end longer than the other.
    const panel = path("M-520 -20 L-470 -52 L470 -52 L520 -14 L520 22 L476 52 L-480 52 L-520 26 Z");
    const strip = path("M-300 -16 L300 -16 L312 0 L300 16 L-300 16 L-312 0 Z");
    for (const [index, name] of names.entries()) {
        const lock = 352 + index * 11;
        const restY = 700 - index * 118;
        const drop = keyed<Vec3>(`s5.panel-${index}.drop`, [[0, at(960, -160)], [lock - 9, at(960, -160), SNAP], [lock, at(960, restY)]]);
        const children = [
            ...part(`s5.panel-${index}.ti`, panel, TI, { screenScale: 1, light: [{ start: lock + 1, span: 18 }] }),
            ...part(`s5.panel-${index}.mesh`, strip, MESH, { screenScale: 1.6, shade: false, edge: hex("#0B0C0E"), edgeWidth: 2 }),
            micro(`s5.panel-${index}.name`, name, -290, 0, 3.4, GRAPHITE),
            scene.child({ ...base(`s5.panel-${index}.led`, { outTick: END, x: 470, y: 0, opacity: appear(`s5.panel-${index}.led.on`, lock, 2) }), type: "ellipse", size: constant({ width: 12, height: 12 }), style: { fill: fill(ION) } }),
        ];
        for (const side of [-1, 1]) {
            children.push(scene.child({ ...base(`s5.panel-${index}.screw-${side}`, { outTick: END, x: side * 420, y: 0 }), ...hexagon(11, 0), style: { gradientFill: linear([[0, CHROME], [1, hex("#6B7178")]], { x: 0, y: -11 }, { x: 0, y: 11 }), stroke: stroke(hex("#0B0C0E"), 1.5) } }));
        }
        parts.push(scene.child({ ...base(`s5.panel-${index}`, { outTick: END, position: drop }), type: "group", children }));
    }
    shot("s5", [[345, 435], [570, 580]], parts);
}

// --- 6 SEALED: titanium doors close over an Ion Blue key ---

const SLAM = 488;
{
    const parts: string[] = [];
    // Smoked polymer: a tinted window with a little internal depth.
    parts.push(scene.child({ ...base("s6.window", { outTick: END, x: 960, y: 500 }), type: "rect", size: constant({ width: 760, height: 420 }), cornerRadius: constant(36), style: { gradientFill: linear([[0, hex("#13191D")], [0.55, hex("#2C3A42")], [1, hex("#101214")]], { x: -380, y: -210 }, { x: 380, y: 210 }), stroke: stroke(EDGE, 2) } }));
    parts.push(scene.child({ ...base("s6.glow", { outTick: END, x: 960, y: 500 }), type: "ellipse", size: constant({ width: 640, height: 420 }), style: { gradientFill: radial([[0, hex("#65B8D666")], [0.5, hex("#65B8D622")], [1, hex("#65B8D600")]], 320) } }));
    const key = [
        scene.child({ ...base("s6.key.bow", { outTick: END, x: -150, y: 0 }), type: "ellipse", size: constant({ width: 170, height: 170 }), style: { stroke: stroke(ION, 30) } }),
        scene.child({ ...base("s6.key.shaft", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape([{ x: -66, y: -16 }, { x: 250, y: -16 }, { x: 266, y: 0 }, { x: 250, y: 16 }, { x: -66, y: 16 }])), style: { fill: fill(ION) } }),
        scene.child({ ...base("s6.key.bit-0", { outTick: END, x: 210, y: 42 }), type: "rect", size: constant({ width: 30, height: 56 }), cornerRadius: constant(5), style: { fill: fill(ION) } }),
        scene.child({ ...base("s6.key.bit-1", { outTick: END, x: 156, y: 32 }), type: "rect", size: constant({ width: 24, height: 36 }), cornerRadius: constant(5), style: { fill: fill(ION) } }),
    ];
    parts.push(scene.child({ ...base("s6.key", { outTick: END, x: 950, y: 500, rotation: -14 }), type: "group", children: key }));
    // The doors: titanium plates, each with an aerodynamic nose at its leading edge.
    for (const side of [-1, 1]) {
        const door = side < 0
            ? path("M-1000 -380 L-80 -380 C0 -380 30 -330 30 -250 L30 250 C30 330 0 380 -80 380 L-1000 380 Z")
            : path("M1000 -380 L80 -380 C0 -380 -30 -330 -30 -250 L-30 250 C-30 330 0 380 80 380 L1000 380 Z");
        const open = side * 1020;
        const slide = keyed<Vec3>(`s6.door-${side}.slide`, [[0, at(960 + open, 540)], [460, at(960 + open, 540), SNAP], [SLAM, at(960 + side * 30, 540)], [SLAM + 3, at(960 + side * 26, 540)], [SLAM + 8, at(960 + side * 30, 540), IN_OUT]]);
        const vents: string[] = [];
        for (let i = 0; i < 5; i += 1) {
            vents.push(scene.child({ ...base(`s6.door-${side}.vent-${i}`, { outTick: END, x: side * 380, y: -160 + i * 80, rotation: side * -12 }), type: "rect", size: constant({ width: 150, height: 22 }), cornerRadius: constant(11), style: { fill: fill(OBSIDIAN), stroke: stroke(hex("#FFFFFF"), 1, { opacity: 0.2 }) } }));
        }
        parts.push(scene.child({ ...base(`s6.door-${side}`, { outTick: END, position: slide }), type: "group", children: [...part(`s6.door-${side}.ti`, door, TI, { screenScale: 1, shade: [[0, hex("#FFFFFF14")], [0.5, hex("#00000030")], [1, hex("#000000A8")]] }), ...channel(`s6.door-${side}.channel`, side < 0 ? "M-900 250 C-700 180 -420 300 -120 230" : "M900 250 C700 180 420 300 120 230", 14), ...vents] }));
    }
    // Ion Blue leaking through the closed seam: the key is still there.
    parts.push(scene.child({ ...base("s6.leak", { outTick: END, x: 960, y: 540, opacity: keyed("s6.leak.on", [[0, 0], [SLAM, 0], [SLAM + 1, 0.9], [SLAM + 40, 0.45]]) }), type: "rect", size: constant({ width: 3, height: 760 }), cornerRadius: constant(0), style: { fill: fill(ION) } }));
    for (const [index, by] of [-270, -90, 90, 270].entries()) {
        const t = SLAM + 7 + index * 6;
        parts.push(scene.child({
            ...base(`s6.bolt-${index}`, {
                outTick: END,
                x: 960,
                y: 540 + by,
                scale: keyed<Vec3>(`s6.bolt-${index}.drive`, [[0, v3(1.9)], [t, v3(1.9), SNAP], [t + 5, v3(1)]]),
                rotation: keyed<Vec3>(`s6.bolt-${index}.turn`, [[0, { x: 0, y: 0, z: -90 }], [t, { x: 0, y: 0, z: -90 }, SNAP], [t + 5, { x: 0, y: 0, z: 0 }]]),
                opacity: appear(`s6.bolt-${index}.on`, t - 1, 1),
            }),
            ...hexagon(28, 0),
            style: { gradientFill: linear([[0, CHROME], [0.45, TITANIUM], [1, hex("#6B7178")]], { x: 0, y: -28 }, { x: 0, y: 28 }), stroke: stroke(hex("#0B0C0E"), 2) },
        }));
    }
    shot("s6", [[435, 540], [560, 570]], parts);
}

// --- 7: material macros, then a card, then black ---

{
    const macros: Array<[string, string, number]> = [[TI, "TITANIUM", 0], [MESH, "ENGINEERED MESH", 1], [CARBON, "CARBON WEAVE", 2], [RIPSTOP, "RIPSTOP", 3], [SATIN, "SATIN ALUMINUM", 4]];
    const starts = [584, 586, 588, 590, 592];
    // Each macro shows briefly between the montage's own cuts.
    for (const [tex, label, index] of macros) {
        const frame = path("M-960 -540 L960 -540 L960 540 L-960 540 Z");
        const tiles = part(`s7.macro-${index}`, frame, tex, { screenScale: 3.2, shade: true, edge: OBSIDIAN });
        const edge = scene.child({ ...base(`s7.macro-${index}.form`, { outTick: END, x: 220, y: 120, scale: 3.4, rotation: index * 7 - 10 }), type: "path", path: constant(path(SHELL)), style: { stroke: stroke(CHROME, 0.8, { opacity: 0.8 }) } });
        const tag = micro(`s7.macro-${index}.label`, `MATERIAL / ${label}`, -880, 460, 4, BONE);
        const start = starts[index];
        scene.add({ ...base(`s7.macro-${index}`, { outTick: END, x: CENTRE.x, y: CENTRE.y, opacity: windows(`s7.macro-${index}.cut`, [[start, start + 2]], 1) }), type: "group", children: [...tiles, edge, tag] });
    }
}
card("card.one-tool", "01 / ONE TOOL", "ONE TOOL.", 100, 147, 76, 860);
card("card.run", "02 / RUN", "RUN", 206, 238, 132, 790);
card("card.code", "03 / LIVE", "YOUR CODE. LIVE API.", 300, 343, 48, 840);
card("card.kept", "04 / KEPT", "KEPT ACROSS RESTARTS", 404, 433, 46, 930);
card("card.tokens", "05 / SEALED", "TOKENS NEVER LEAVE", 500, 538, 50, 930);
card("card.sealed", "06 / AT REST", "ENCRYPTED AT REST", 594, 618, 70, 500);

// --- 8 OK: the end card ---

const IMPACT = 630;
{
    const hero = [
        ...part("end.shell", path(SHELL), TI, { screenScale: 1.1, light: [{ start: IMPACT + 16, span: 42 }] }),
        ...channel("end.shell.channel", SHELL_CHANNEL),
        scene.child({ ...base("end.shell.signal", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(sampled(path(SHELL_CHANNEL))), style: { stroke: stroke(ION, 5) }, operators: [trim("end.shell.signal.trim", { end: keyed("end.shell.signal.end", [[0, 0], [IMPACT + 10, 0, SLOW], [IMPACT + 40, 1]]) })] }),
    ];
    const settle = keyed<Vec3>("end.shell.settle", [[0, v3(1.18)], [IMPACT, v3(1.18), SLOW], [IMPACT + 28, v3(1.1)]]);
    const name = words("end.discord", "DISCORD", 0, 0, 86);
    const mcp = words("end.mcp", "MCP", 0, 0, 86);
    const NAME_X = 990;
    const lockup = [
        scene.child({ ...base("end.hero", { outTick: END, x: 520, y: 500, scale: settle, rotation: -4 }), type: "group", children: hero }),
        scene.child({ ...base("end.discord", { outTick: END, x: NAME_X, y: 380, opacity: appear("end.discord.on", IMPACT + 6, 14) }), type: "group", children: name.letters }),
        scene.child({ ...base("end.mcp", { outTick: END, x: NAME_X, y: 490, opacity: appear("end.mcp.on", IMPACT + 12, 14) }), type: "group", children: mcp.letters }),
        micro("end.sub", "ONE TOOL / YOUR CODE / THE LIVE DISCORD API", NAME_X, 630, 4.4, TITANIUM, appear("end.sub.on", IMPACT + 22, 12)),
        scene.child({ ...base("end.rule", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath({ x: 160, y: 900 }, { x: 1760, y: 900 })), style: { stroke: stroke(ION, 3) }, operators: [trim("end.rule.trim", { end: keyed("end.rule.end", [[0, 0], [IMPACT + 20, 0, SLOW], [IMPACT + 50, 1]]) })] }),
        micro("end.url", "GITHUB.COM/DRVOVA/DISCORD-MCP", 160, 940, 4.4, BONE, appear("end.url.on", IMPACT + 34, 12)),
    ];
    shot("end", [[IMPACT, END]], lockup);
}

// --- The HUD: system identifier, live status, shot index; hidden in the black ---

{
    const STATES: Array<[string, number, number]> = [["STANDBY", 0, 75], ["ARMED", 75, 150], ["RUN", 150, 240], ["LIVE", 240, 345], ["KEPT", 345, 435], ["SEALED", 435, 618], ["OK", IMPACT, END]];
    const hud = [micro("hud.system", "SYSTEM / TX-01 / DISCORD-MCP", 72, 64, 3.2, BONE, constant(0.85)), micro("hud.teaser", "TEASER / 00:25", 72, 1020, 3.2, TITANIUM)];
    for (const [index, [word, from, to]] of STATES.entries()) {
        const on = windows(`hud.state-${index}.cut`, [[from, to]], 2);
        hud.push(scene.child({ ...base(`hud.dot-${index}`, { outTick: END, x: 1640, y: 64, opacity: on }), type: "ellipse", size: constant({ width: 12, height: 12 }), style: { fill: fill(ION) } }));
        hud.push(micro(`hud.state-${index}`, word, 1660, 64, 3.2, ION, on));
        hud.push(micro(`hud.index-${index}`, `0${index + 1} / 07`, 1730, 1020, 3.2, TITANIUM, on));
    }
    scene.add({ ...base("hud", { outTick: END, x: 0, y: 0, opacity: windows("hud.cut", [[0, 618], [IMPACT, END]], 2) }), type: "group", children: hud });
}

// --- Fades: up from black at the start; the beat of black before the end ---

scene.add({ ...base("dark", { outTick: END, x: CENTRE.x, y: CENTRE.y }), type: "rect", size: constant({ width: W, height: H }), cornerRadius: constant(0), style: { fill: fill(OBSIDIAN, keyed("dark.opacity", [[0, 1], [4, 1, SLOW], [36, 0], [612, 0, IN_OUT], [618, 1], [IMPACT, 1], [IMPACT + 1, 0.4, SLOW], [IMPACT + 16, 0]])) } });
// A restrained light on each lock and on the impact: never a full white-out.
{
    const HITS: Array<[number, number]> = [[SEAT, 0.12], [LOCK, 0.2], [SLAM, 0.16], [IMPACT, 0.25]];
    const keys: Array<Key<number>> = [[0, 0]];
    for (const [tick, level] of HITS) {
        keys.push([tick - 1, 0], [tick, level], [tick + 5, 0]);
    }
    scene.add({ ...base("hit", { outTick: END, x: CENTRE.x, y: CENTRE.y }), type: "rect", size: constant({ width: W, height: H }), cornerRadius: constant(0), style: { fill: fill(CHROME, keyed("hit.opacity", keys)) } });
}

// --- The README preview: the trailer with a play badge on top ---

// `node trailer.ts --preview` adds the badge and writes trailer-preview.json,
// exported as the silent, looping SVG the README shows; the badge links to
// the player page, which plays the MP4 with sound.
const PREVIEW = process.argv.includes("--preview");
if (PREVIEW) {
    // A satin titanium bezel, a molded elastomer face and an Ion Blue glyph;
    // no pulsing (the spec asks for minimal idle motion).
    // Small and in the corner, clear of the cards and the HUD; the README's
    // caption says what it does.
    const badge = { x: 1792, y: 894 };
    const R = 62;
    scene.add({ ...base("play.shadow", { outTick: END, x: badge.x + 8, y: badge.y + 12 }), type: "ellipse", size: constant({ width: R * 2 + 10, height: R * 2 + 10 }), style: { gradientFill: radial([[0, hex("#000000CC")], [0.75, hex("#00000088")], [1, hex("#00000000")]], R + 5) } });
    scene.add({ ...base("play.bezel", { outTick: END, x: badge.x, y: badge.y }), type: "ellipse", size: constant({ width: R * 2, height: R * 2 }), style: { gradientFill: linear([[0, CHROME], [0.4, TITANIUM], [1, hex("#7F858B")]], { x: 0, y: -R }, { x: 0, y: R }), stroke: stroke(EDGE, 2) } });
    scene.add({ ...base("play.face", { outTick: END, x: badge.x, y: badge.y }), type: "ellipse", size: constant({ width: R * 2 - 20, height: R * 2 - 20 }), style: { gradientFill: linear([[0, hex("#3A3F44")], [1, GRAPHITE]], { x: 0, y: -R }, { x: 0, y: R }), stroke: stroke(OBSIDIAN, 3) } });
    scene.add({
        ...base("play.arrow", { outTick: END, x: badge.x + 8, y: badge.y }),
        type: "polystar",
        variant: "polygon",
        points: constant(3),
        innerRadius: constant(0),
        outerRadius: constant(R * 0.46),
        innerRoundness: constant(0),
        outerRoundness: constant(0),
        rotationOffset: constant(90),
        style: { fill: fill(ION) },
    });
}

const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: "discord-mcp-trailer",
    name: "discord-mcp teaser trailer",
    canvas: { width: W, height: H, pixelAspectRatio: 1, backgroundColor: OBSIDIAN },
    timing: {
        ticksPerSecond: FPS,
        frameRate: { numerator: FPS, denominator: 1 },
        durationTicks: END,
        displayStartTick: 0,
    },
    assets,
    compositions: {
        main: { id: "main", name: "Trailer", width: W, height: H, durationTicks: END, nodes: scene.nodes, rootNodeIds: scene.order },
    },
    rootCompositionId: "main",
    components: {},
    markers: [
        marker("standby", 0, { name: "Light reveals a titanium shell", durationTicks: 75 }),
        marker("armed", 75, { name: "A recessed ring turns and seats", durationTicks: 75 }),
        marker("run", 150, { name: "Two shells interlock", durationTicks: 90 }),
        marker("live", 240, { name: "Schematic panel", durationTicks: 105 }),
        marker("kept", 345, { name: "Helper panels stack and lock", durationTicks: 90 }),
        marker("sealed", 435, { name: "Doors seal the key", durationTicks: 105 }),
        marker("materials", 540, { name: "Material macros, card, black", durationTicks: 90 }),
        marker("ok", IMPACT, { name: "End card", durationTicks: END - IMPACT }),
    ],
    design: {
        description: "A 25-second teaser for discord-mcp in Y2K industrial retrofuturism: textured titanium shells, elastomer, smoked polymer and one Ion Blue accent for state.",
        accessibilityLabel: "discord-mcp teaser: one tool runs your code against the live Discord API; helpers are kept across restarts; tokens never leave the agent; secrets are encrypted at rest.",
    },
    capabilities: { required: [], optional: [], unsupportedPolicy: "error" },
});

try {
    assertValidAnimationDocument(document);
} catch (error) {
    console.error(JSON.stringify((error as { diagnostics?: unknown }).diagnostics ?? String(error), null, 2).slice(0, 4000));
    process.exit(1);
}
const out = PREVIEW ? "trailer-preview.json" : "trailer.json";
writeFileSync(new URL(`./${out}`, import.meta.url), `${JSON.stringify(document)}\n`);
console.log(`${out}: ${Object.keys(scene.nodes).length} nodes, ${END} ticks at ${FPS} fps, revision ${document.revision}`);
