// The animated README banner, authored with Clayzo.
//
//   node banner.ts                      writes banner.json and validates it (no account needed)
//   npx clayzo export banner.json ../img/banner.svg --format svg
//                                       renders it (needs `npx clayzo login`)
//
// Style: late-90s / early-2000s industrial kit and technical sportswear, the
// same language as the trailer's player page (site/):
// - one brushed-titanium plate, its nose rounded and aerodynamic, tapering
//   toward the right, fixed with screws only at its corners;
// - the name engraved into the metal in a wide, upright industrial cut, with
//   an engraved spec line and a taped seam;
// - a molded-rubber control module where the hand goes: a pixel LCD, a
//   pebble key with a status light, level columns and a mesh vent;
// - graphite around it, and one accent (Discord blurple) used for state only.
// The parts it shares with the trailer live in kit.ts.
//
// Motion is the module running one cycle, like hardware: READY; the key is
// pressed and its light comes on; RUN while a progress bar fills and the
// levels move; OK; then back to READY. A soft sheen crosses the titanium
// once. Every loop starts and ends at READY, so the 8 seconds are seamless.
//
// Only geometry, no font text, so the animated SVG export draws it exactly.

import { writeFileSync } from "node:fs";
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
    stroke,
    withComputedRevision,
    type Animatable,
    type Color,
    type PathContour,
    type PathData,
    type Vec3,
} from "@clayzo/animation";
import { IN_OUT, SNAP, Scene, glyph, hexagon, linear, openPath, radial, shape, sweep, vertex, type Cut, type Key, type Point } from "./kit.ts";

const WIDTH = 1280;
const HEIGHT = 400;
const FPS = 30;
const END = 8 * FPS; // 8 s loop

const GRAPHITE = hex("#1C1E21");
const GRAPHITE_DEEP = hex("#141517");
const INK = hex("#E6E7E9");
const ENGRAVE = hex("#2A2D31");
const LCD = hex("#0E0F11");
const ACCENT = hex("#8B95FF");
const ACCENT_DEEP = hex("#5865F2");
const OFF = hex("#3A3D42");

const scene = new Scene(END);
const v3 = (x: number, y: number): Vec3 => ({ x, y, z: 0 });
// On only inside [from, to), switching in about a frame.
const between = (id: string, from: number, to: number, level = 1): Animatable<number> =>
    keyed(id, from <= 0 ? [[0, level], [to - 1, level], [to, 0], [END, 0]] : [[0, 0], [from - 1, 0], [from, level], [to - 1, level], [to, 0]]);
// An arc of points about (cx, cy), angles in degrees, y down.
const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 16): Point[] =>
    Array.from({ length: steps + 1 }, (_, i) => {
        const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
        return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    });
// A rectangle with its own radius at each corner: [top-left, top-right, bottom-right, bottom-left].
const rounded = (x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]): Point[] => [
    ...arc(x + tl, y + tl, tl, tl, 180, 270, 8),
    ...arc(x + w - tr, y + tr, tr, tr, 270, 360, 8),
    ...arc(x + w - br, y + h - br, br, br, 0, 90, 8),
    ...arc(x + bl, y + h - bl, bl, bl, 90, 180, 8),
];

// --- The graphite field ---

scene.add({
    ...base("field", { outTick: END, x: WIDTH / 2, y: HEIGHT / 2 }),
    type: "rect",
    size: constant({ width: WIDTH, height: HEIGHT }),
    cornerRadius: constant(26),
    style: { gradientFill: linear([[0, hex("#26292D")], [0.55, GRAPHITE], [1, GRAPHITE_DEEP]], { x: 0, y: -200 }, { x: 0, y: 200 }) },
});

// --- The plate: brushed titanium, an aerodynamic nose tapering to the right ---

const NOSE = { x: 186, y: 200, rx: 150, ry: 152 };
const plate: Point[] = [
    ...arc(NOSE.x, NOSE.y, NOSE.rx, NOSE.ry, 90, 270, 28),
    ...arc(1222, 90, 22, 22, 270, 360, 8).map((p, i) => (i === 0 ? { x: p.x, y: 68 } : p)),
    ...arc(1222, 310, 22, 22, 0, 90, 8).map((p, i, all) => (i === all.length - 1 ? { x: p.x, y: 332 } : p)),
];
// A soft shadow under it: two offset, faint copies.
for (const [index, [dy, alpha]] of [[14, 0.22], [7, 0.3]].entries()) {
    scene.add({ ...base(`plate.shadow-${index}`, { outTick: END, x: 0, y: dy }), type: "path", path: constant(shape(plate)), style: { fill: fill(hex("#000000"), alpha) } });
}
scene.add({
    ...base("plate", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(shape(plate)),
    style: { gradientFill: linear([[0, hex("#D3D6DA")], [0.35, hex("#BDC1C6")], [1, hex("#8E9298")]], { x: 0, y: 48 }, { x: 0, y: 352 }), stroke: stroke(hex("#5B6066"), 1.5) },
});
// The brushing: fine horizontal grain, light and dark, clipped to the plate.
{
    const grain = (id: string, start: number, step: number, color: Color, alpha: number) => {
        const lines: PathContour[] = [];
        for (let y = start; y < 356; y += step) {
            lines.push(openPath({ x: 30, y }, { x: 1250, y }).contours[0]);
        }
        return scene.child({ ...base(id, { outTick: END, x: 0, y: 0 }), type: "path", path: constant({ contours: lines }), style: { stroke: stroke(color, 0.7, { opacity: alpha, cap: "butt" }) } });
    };
    scene.child({ ...base("plate.clip", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(plate)), style: {} });
    scene.add({
        ...base("plate.grain", { outTick: END, x: 0, y: 0 }),
        type: "group",
        clipPathId: "plate.clip",
        children: [grain("plate.grain.light", 49, 3, hex("#FFFFFF"), 0.16), grain("plate.grain.dark", 50.5, 4, hex("#000000"), 0.07), grain("plate.grain.long", 52, 13, hex("#FFFFFF"), 0.12)],
    });
}
// The lit top edge.
scene.add({
    ...base("plate.edge", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(openPath(...arc(NOSE.x, NOSE.y, NOSE.rx - 2, NOSE.ry - 2, 200, 270, 10), { x: 1220, y: 70 })),
    style: { stroke: stroke(hex("#FFFFFF"), 1.4, { opacity: 0.7 }) },
});
// The sheen that crosses the plate once a loop.
scene.add({
    ...base("plate.sheen", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(shape(plate)),
    style: { gradientFill: sweep("plate.sheen", [{ start: 154, span: 64 }], -260, 1500, 280, "80") },
});

// Screws only where the plate is fixed: a hex head with a six-point socket.
const screw = (id: string, x: number, y: number) => {
    scene.add({ ...base(id, { outTick: END, x, y }), ...hexagon(7.5, 0), style: { gradientFill: radial([[0, hex("#F2F3F5")], [0.6, hex("#9AA0A6")], [1, hex("#6B7077")]], 8), stroke: stroke(hex("#4A4E54"), 1) } });
    scene.add({
        ...base(`${id}.socket`, { outTick: END, x, y }),
        type: "polystar",
        variant: "star",
        points: constant(6),
        innerRadius: constant(1.6),
        outerRadius: constant(3.4),
        innerRoundness: constant(0),
        outerRoundness: constant(0),
        rotationOffset: constant(0),
        style: { fill: fill(ENGRAVE) },
    });
};
screw("screw.nose-top", 104, 110);
screw("screw.nose-bottom", 104, 290);
screw("screw.tail-top", 1224, 92);
screw("screw.tail-bottom", 1224, 308);

// --- The engraving: the name, the pitch, a seam and the model line ---

const LIGHT: Cut = { weight: 0.18, chamfer: 0.06 };
const STRETCH = 1.3;
// Engraved: dark letters with a lit lower lip, as if cut into the metal.
const engrave = (id: string, text: string, x: number, y: number, H: number) => {
    const gap = H * 0.16;
    let cursor = x;
    for (const [index, letter] of [...text].entries()) {
        const { width, path } = glyph(letter, H, LIGHT);
        if (path.contours.length > 0) {
            for (const [layer, dy, color, alpha] of [["lip", 1.6, hex("#FFFFFF"), 0.6], ["cut", 0, ENGRAVE, 1]] as const) {
                scene.add({
                    ...base(`${id}.${index}.${layer}`, { outTick: END, x: cursor, y: y + dy, scale: { x: STRETCH, y: 1 } }),
                    type: "path",
                    path: constant(path),
                    style: { fill: fill(color, alpha) },
                });
            }
        }
        cursor += width * STRETCH + gap;
    }
    return cursor - gap;
};
const microtype = (id: string, text: string, x: number, y: number, cell: number, color: Color, opacity: Animatable<number> = constant(1), lip = false) => {
    const label = cellWordmark(text, { cell, gap: cell * 0.2, face: "3x5" });
    if (lip) {
        scene.add({ ...base(`${id}.lip`, { outTick: END, x: x + label.width / 2, y: y + 1 }), type: "path", path: constant(label.path), style: { fill: fill(hex("#FFFFFF"), 0.5) } });
    }
    scene.add({ ...base(id, { outTick: END, x: x + label.width / 2, y, opacity }), type: "path", path: constant(label.path), style: { fill: fill(color) } });
    return label.width;
};

const NAME_X = 196;
engrave("name.discord", "DISCORD", NAME_X, 96, 68);
const mcpRight = engrave("name.mcp", "MCP", NAME_X, 184, 68);
microtype("pitch.0", "ONE TOOL. RUNS YOUR CODE.", mcpRight + 30, 205, 2.6, ENGRAVE, constant(1), true);
microtype("pitch.1", "TOKENS STAY IN THE AGENT.", mcpRight + 30, 228, 2.6, ENGRAVE, constant(1), true);
// The taped seam: a band with a stitch line.
scene.add({ ...base("seam.tape", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath({ x: 196, y: 278 }, { x: 834, y: 278 })), style: { stroke: stroke(hex("#000000"), 5, { opacity: 0.08, cap: "butt" }) } });
scene.add({ ...base("seam.stitch", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath({ x: 196, y: 278 }, { x: 834, y: 278 })), style: { stroke: stroke(ENGRAVE, 1, { opacity: 0.55, dash: [5, 4], cap: "butt" }) } });
microtype("model", "MODEL TX-01 / DISCORD.JS 14 / NODE 22 / 1 TOOL", NAME_X, 302, 2.2, ENGRAVE, constant(0.85), true);

// --- The module: molded rubber, where the hand goes ---

const MOD = { x: 868, y: 102, w: 330, h: 196 };
const moduleOutline = rounded(MOD.x, MOD.y, MOD.w, MOD.h, [44, 16, 16, 44]);
scene.add({ ...base("module.shadow", { outTick: END, x: 0, y: 4 }), type: "path", path: constant(shape(moduleOutline)), style: { fill: fill(hex("#000000"), 0.35) } });
scene.add({
    ...base("module", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(shape(moduleOutline)),
    style: { gradientFill: linear([[0, hex("#4A4E52")], [0.12, hex("#3A3D41")], [1, hex("#25282C")]], { x: 0, y: MOD.y }, { x: 0, y: MOD.y + MOD.h }), stroke: stroke(hex("#15171A"), 1.5) },
});
scene.add({
    ...base("module.lip", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(openPath(...arc(MOD.x + 44, MOD.y + 44, 42, 42, 200, 270, 8), { x: MOD.x + MOD.w - 16, y: MOD.y + 2 })),
    style: { stroke: stroke(hex("#FFFFFF"), 1, { opacity: 0.16 }) },
});

// The LCD: a smoked window with unlit segments faintly visible.
const WIN = { x: 896, y: 122, w: 282, h: 70 };
scene.add({
    ...base("lcd", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(shape(rounded(WIN.x, WIN.y, WIN.w, WIN.h, [10, 6, 6, 10]))),
    style: { fill: fill(LCD), stroke: stroke(hex("#000000"), 1.5) },
});
scene.add({ ...base("lcd.lip", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath({ x: WIN.x + 10, y: WIN.y + WIN.h + 1 }, { x: WIN.x + WIN.w - 6, y: WIN.y + WIN.h + 1 })), style: { stroke: stroke(hex("#FFFFFF"), 1, { opacity: 0.1 }) } });
const LCD_TEXT = { x: WIN.x + 16, y: WIN.y + 26, cell: 4.4 };
microtype("lcd.ghost", "88888888", LCD_TEXT.x, LCD_TEXT.y, LCD_TEXT.cell, INK, constant(0.06));
microtype("lcd.label", "T-01", WIN.x + WIN.w - 46, WIN.y + 14, 1.8, INK, constant(0.45));
// The cycle: READY, RUN, OK; READY again at the loop point.
const PRESS = 30;
const DONE = 150;
const RESET = 210;
microtype("lcd.ready", "READY", LCD_TEXT.x, LCD_TEXT.y, LCD_TEXT.cell, INK, keyed("lcd.ready.on", [[0, 1], [PRESS - 1, 1], [PRESS, 0], [RESET - 1, 0], [RESET, 1]]));
microtype("lcd.run", "RUN", LCD_TEXT.x, LCD_TEXT.y, LCD_TEXT.cell, INK, between("lcd.run.on", PRESS, DONE));
// A block cursor that blinks while it runs.
{
    const keys: Array<Key<number>> = [[0, 0], [PRESS - 1, 0]];
    for (let t = PRESS; t + 16 <= DONE; t += 16) {
        keys.push([t, 1], [t + 7, 1], [t + 8, 0], [t + 15, 0]);
    }
    keys.push([DONE, 0]);
    scene.add({ ...base("lcd.cursor", { outTick: END, x: LCD_TEXT.x + 66, y: LCD_TEXT.y, opacity: keyed("lcd.cursor.on", keys) }), type: "rect", size: constant({ width: 13, height: 22 }), cornerRadius: constant(1), style: { fill: fill(INK) } });
}
microtype("lcd.ok", "OK 0.42S", LCD_TEXT.x, LCD_TEXT.y, LCD_TEXT.cell, INK, between("lcd.ok.on", DONE, RESET));
// The progress bar along the window's foot: segments light in turn.
const SEGMENTS = 16;
for (let i = 0; i < SEGMENTS; i += 1) {
    const x = WIN.x + 16 + i * 15.5;
    scene.add({ ...base(`lcd.seg-${i}`, { outTick: END, x: x + 6, y: WIN.y + 56 }), type: "rect", size: constant({ width: 12, height: 5 }), cornerRadius: constant(1), style: { fill: fill(INK, 0.07) } });
    const at = PRESS + 10 + Math.round((i / SEGMENTS) * (DONE - PRESS - 22));
    scene.add({ ...base(`lcd.seg-${i}.on`, { outTick: END, x: x + 6, y: WIN.y + 56, opacity: between(`lcd.seg-${i}.lit`, at, RESET) }), type: "rect", size: constant({ width: 12, height: 5 }), cornerRadius: constant(1), style: { fill: fill(ACCENT) } });
}

// The pebble key, which sinks when pressed; its light shows the state.
const KEY = { x: 930, y: 250 };
const press = keyed<Vec3>("key.press", [[0, v3(KEY.x, KEY.y)], [PRESS - 2, v3(KEY.x, KEY.y), SNAP], [PRESS + 1, v3(KEY.x, KEY.y + 2.5)], [PRESS + 8, v3(KEY.x, KEY.y), IN_OUT]]);
scene.add({ ...base("key.well", { outTick: END, x: KEY.x, y: KEY.y + 2, rotation: -14 }), type: "ellipse", size: constant({ width: 58, height: 50 }), style: { fill: fill(hex("#15171A")) } });
scene.add({
    ...base("key", { outTick: END, position: press, rotation: -14 }),
    type: "ellipse",
    size: constant({ width: 54, height: 46 }),
    style: { gradientFill: linear([[0, hex("#565A5F")], [0.4, hex("#3C3F44")], [1, hex("#2A2D31")]], { x: 0, y: -23 }, { x: 0, y: 23 }), stroke: stroke(hex("#121315"), 1.2) },
});
scene.add({
    ...base("key.glyph", { outTick: END, position: keyed<Vec3>("key.glyph.press", [[0, v3(KEY.x + 2, KEY.y)], [PRESS - 2, v3(KEY.x + 2, KEY.y), SNAP], [PRESS + 1, v3(KEY.x + 2, KEY.y + 2.5)], [PRESS + 8, v3(KEY.x + 2, KEY.y), IN_OUT]]) }),
    type: "polystar",
    variant: "polygon",
    points: constant(3),
    innerRadius: constant(0),
    outerRadius: constant(10),
    innerRoundness: constant(0),
    outerRoundness: constant(0),
    rotationOffset: constant(90),
    style: { fill: fill(INK) },
});
scene.add({ ...base("key.led", { outTick: END, x: KEY.x + 24, y: KEY.y - 26 }), type: "ellipse", size: constant({ width: 7, height: 7 }), style: { fill: fill(OFF), stroke: stroke(hex("#000000"), 1, { opacity: 0.5 }) } });
scene.add({ ...base("key.led.glow", { outTick: END, x: KEY.x + 24, y: KEY.y - 26, opacity: between("key.led.on", PRESS + 1, RESET) }), type: "ellipse", size: constant({ width: 18, height: 18 }), style: { gradientFill: radial([[0, ACCENT], [0.32, ACCENT], [0.4, hex("#8B95FF66")], [1, hex("#8B95FF00")]], 9) } });

// The level columns: dark, lighting in a moving pattern while it runs.
const LEVELS = 7;
for (let i = 0; i < LEVELS; i += 1) {
    const h = 14 + i * 3.4;
    const x = 980 + i * 11;
    const y = 270 - h / 2;
    scene.add({ ...base(`level-${i}`, { outTick: END, x, y }), type: "rect", size: constant({ width: 7, height: h }), cornerRadius: constant(3.5), style: { fill: fill(hex("#121315")), stroke: stroke(hex("#FFFFFF"), 0.6, { opacity: 0.06 }) } });
    // A deterministic flicker, louder toward the start of the run.
    const keys: Array<Key<number>> = [[0, 0], [PRESS + 4, 0]];
    for (let t = PRESS + 6, k = 0; t < DONE; t += 6, k += 1) {
        const level = (Math.sin(k * 1.7 + i * 0.9) * 0.5 + 0.5) * (1 - (t - PRESS) / (DONE - PRESS) * 0.5);
        keys.push([t, level > i / LEVELS * 0.9 ? 1 : 0]);
    }
    keys.push([DONE, i < 4 ? 1 : 0], [RESET - 1, i < 4 ? 1 : 0], [RESET, 0]);
    scene.add({ ...base(`level-${i}.on`, { outTick: END, x, y, opacity: keyed(`level-${i}.lit`, keys) }), type: "rect", size: constant({ width: 7, height: h }), cornerRadius: constant(3.5), style: { gradientFill: linear([[0, ACCENT], [1, ACCENT_DEEP]], { x: 0, y: -h / 2 }, { x: 0, y: h / 2 }) } });
}

// The vent: a hex-perforated mesh, where the module breathes.
{
    const VENT = { x: 1072, y: 222, w: 106, h: 54 };
    scene.add({ ...base("vent", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(rounded(VENT.x, VENT.y, VENT.w, VENT.h, [14, 6, 6, 14]))), style: { gradientFill: linear([[0, hex("#3E4246")], [1, hex("#2A2D31")]], { x: 0, y: VENT.y }, { x: 0, y: VENT.y + VENT.h }), stroke: stroke(hex("#121315"), 1) } });
    const holes: PathContour[] = [];
    const step = 6.4;
    for (let row = 0, y = VENT.y + 7; y < VENT.y + VENT.h - 5; row += 1, y += step * 0.866) {
        for (let x = VENT.x + 9 + (row % 2) * (step / 2); x < VENT.x + VENT.w - 6; x += step) {
            holes.push(circleContour({ x, y }, 1.7));
        }
    }
    scene.add({ ...base("vent.holes", { outTick: END, x: 0, y: 0 }), type: "path", path: constant({ contours: holes } as PathData), style: { fill: fill(hex("#0B0C0D")) } });
}

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
        main: { id: "main", name: "Banner", width: WIDTH, height: HEIGHT, durationTicks: END, nodes: scene.nodes, rootNodeIds: scene.order },
    },
    rootCompositionId: "main",
    components: {},
    markers: [
        marker("ready", 0, { name: "READY", durationTicks: PRESS }),
        marker("run", PRESS, { name: "Key pressed, RUN, progress fills", durationTicks: DONE - PRESS }),
        marker("ok", DONE, { name: "OK, sheen crosses the plate", durationTicks: RESET - DONE }),
        marker("reset", RESET, { name: "Back to READY", durationTicks: END - RESET }),
    ],
    design: {
        description:
            "discord-mcp banner as late-90s industrial kit: a brushed-titanium plate with the name engraved, and a molded-rubber module (LCD, pebble key, levels, mesh vent) running one cycle.",
        accessibilityLabel: "discord-mcp. One tool runs your code; tokens stay in the agent.",
        tokens: { looping: true },
    },
    capabilities: { required: [], optional: [], unsupportedPolicy: "error" },
});

assertValidAnimationDocument(document);
writeFileSync(new URL("./banner.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
console.log(`banner.json: ${Object.keys(scene.nodes).length} nodes, ${END} ticks at ${FPS} fps, revision ${document.revision}`);
