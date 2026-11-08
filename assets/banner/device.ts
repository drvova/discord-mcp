// The device: the hardware in the README banner, built once and shared by
// the banner (which shows it whole) and the trailer (which films it).
//
// A brushed-titanium plate with an aerodynamic nose tapering to the right,
// screws only where it is fixed, the name and pitch engraved into it, one
// continuous biomorphic channel from the nose into a molded-elastomer
// module: a smoked-polymer LCD, a pebble key with a status light, level
// columns and a hex-mesh vent. The spec's palette, with Ion Blue for state
// only. Drawn in a 1280 × 400 space; callers place, scale and frame it.
//
// What the device does over time (its LCD, key, light, levels and the light
// across the plate) comes from a script, so the banner can loop one cycle
// and the trailer can run its whole story.

import { base, cellWordmark, circleContour, constant, fill, hex, keyed, stroke, type Animatable, type Color, type PathContour, type PathData, type SceneNode, type Vec3 } from "@clayzo/animation";
import { IN_OUT, SNAP, glyph, hexagon, linear, openPath, radial, shape, sweep, type Cut, type Key, type Pass, type Point, type Scene } from "./kit.ts";

export const DEVICE = { width: 1280, height: 400 };

// The spec's palette tokens.
export const OBSIDIAN = hex("#101214");
export const GRAPHITE = hex("#25292D");
export const TITANIUM = hex("#A6ABB1");
export const CHROME = hex("#D4DCE1");
export const BONE = hex("#E4E1D8");
export const ION = hex("#65B8D6");
const ION_DEEP = hex("#3E8FAE");
const ENGRAVE = GRAPHITE;
const OFF = hex("#3A3F44");

export type Span = [number, number];
export type DeviceScript = {
    // What the LCD reads, and when.
    lcd: Array<{ text: string; from: number; to: number }>;
    // When a block cursor blinks after the LCD text.
    cursor: Span[];
    // The progress bar: segments light in turn across [from, to), all off at `off`.
    progress: Array<{ from: number; to: number; off: number }>;
    // Ticks at which the key is pressed.
    presses: number[];
    // When the key's status light is on.
    light: Span[];
    // When the level columns move, holding a level until `hold`.
    levels: Array<{ from: number; to: number; hold: number }>;
    // Passes of light across the plate.
    sheen: Pass[];
    // If set, the screws turn and seat, finishing at this tick.
    seat?: number;
    // An image asset of brushed titanium to tile on the plate, with the tile
    // size in device units; without it, the brushing is drawn as fine lines.
    texture?: { id: string; tile: number };
};

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

// Where the parts are, for framing shots.
export const PARTS = {
    name: { x: 420, y: 130 },
    mcp: { x: 300, y: 218 },
    pitch: { x: 640, y: 216 },
    channel: { x: 470, y: 268 },
    model: { x: 400, y: 302 },
    screw: { x: 104, y: 110 },
    lcd: { x: 1037, y: 157 },
    key: { x: 930, y: 250 },
    levels: { x: 1013, y: 266 },
    vent: { x: 1125, y: 249 },
    module: { x: 1033, y: 200 },
    whole: { x: 640, y: 200 },
};

// Builds the device. `place` adds each node (as a root or into a group) and
// returns its id; `prefix` keeps ids unique when needed.
export const device = (scene: Scene, place: (node: SceneNode) => string, script: DeviceScript, prefix = "") => {
    const END = scene.end;
    const ids: string[] = [];
    const put = (node: SceneNode) => {
        ids.push(place(node));
        return node.id;
    };
    const id = (name: string) => `${prefix}${name}`;
    // On inside the spans, switching in about a frame.
    const during = (name: string, spans: Span[], level = 1): Animatable<number> => {
        const keys: Array<Key<number>> = [[0, spans.some(([from]) => from <= 0) ? level : 0]];
        for (const [from, to] of spans) {
            if (from > 0) {
                keys.push([from - 1, 0], [from, level]);
            }
            if (to < END) {
                keys.push([to - 1, level], [to, 0]);
            }
        }
        return keyed(id(name), keys);
    };
    const v3 = (x: number, y: number): Vec3 => ({ x, y, z: 0 });

    // --- The plate ---

    const NOSE = { x: 186, y: 200, rx: 150, ry: 152 };
    const plate: Point[] = [
        ...arc(NOSE.x, NOSE.y, NOSE.rx, NOSE.ry, 90, 270, 28),
        ...arc(1222, 90, 22, 22, 270, 360, 8).map((p, i) => (i === 0 ? { x: p.x, y: 68 } : p)),
        ...arc(1222, 310, 22, 22, 0, 90, 8).map((p, i, all) => (i === all.length - 1 ? { x: p.x, y: 332 } : p)),
    ];
    // A soft shadow under it: two offset, faint copies.
    for (const [index, [dy, alpha]] of [[14, 0.22], [7, 0.3]].entries()) {
        put({ ...base(id(`plate.shadow-${index}`), { outTick: END, x: 0, y: dy }), type: "path", path: constant(shape(plate)), style: { fill: fill(hex("#000000"), alpha) } });
    }
    put({
        ...base(id("plate"), { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant(shape(plate)),
        style: { gradientFill: linear([[0, CHROME], [0.38, TITANIUM], [1, hex("#7F858B")]], { x: 0, y: 48 }, { x: 0, y: 352 }), stroke: stroke(hex("#4B555C"), 1.5) },
    });
    // The brushing, clipped to the plate: the kit's texture, or fine lines.
    scene.child({ ...base(id("plate.clip"), { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(plate)), style: {} });
    if (script.texture) {
        const { id: tex, tile } = script.texture;
        const tiles: string[] = [];
        for (let ty = 40; ty < 360; ty += tile) {
            for (let tx = 30; tx < 1250; tx += tile) {
                tiles.push(scene.child({ ...base(id(`plate.tile-${tiles.length}`), { outTick: END, x: tx + tile / 2, y: ty + tile / 2 }), type: "image", assetId: tex, size: constant({ width: tile + 0.5, height: tile + 0.5 }), fit: "fill" } as SceneNode));
            }
        }
        put({ ...base(id("plate.grain"), { outTick: END, x: 0, y: 0 }), type: "group", clipPathId: id("plate.clip"), children: tiles });
        // Shade the texture top to bottom, like the drawn plate.
        put({ ...base(id("plate.shade"), { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(plate)), style: { gradientFill: linear([[0, hex("#FFFFFF38")], [0.4, hex("#FFFFFF00")], [1, hex("#00000066")]], { x: 0, y: 48 }, { x: 0, y: 352 }) } });
    } else {
        const grain = (name: string, start: number, step: number, color: Color, alpha: number) => {
            const lines: PathContour[] = [];
            for (let y = start; y < 356; y += step) {
                lines.push(openPath({ x: 30, y }, { x: 1250, y }).contours[0]);
            }
            return scene.child({ ...base(id(name), { outTick: END, x: 0, y: 0 }), type: "path", path: constant({ contours: lines }), style: { stroke: stroke(color, 0.7, { opacity: alpha, cap: "butt" }) } });
        };
        put({
            ...base(id("plate.grain"), { outTick: END, x: 0, y: 0 }),
            type: "group",
            clipPathId: id("plate.clip"),
            children: [grain("plate.grain.light", 49, 3, hex("#FFFFFF"), 0.16), grain("plate.grain.dark", 50.5, 4, hex("#000000"), 0.07), grain("plate.grain.long", 52, 13, hex("#FFFFFF"), 0.12)],
        });
    }
    // The lit top edge.
    put({
        ...base(id("plate.edge"), { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant(openPath(...arc(NOSE.x, NOSE.y, NOSE.rx - 2, NOSE.ry - 2, 200, 270, 10), { x: 1220, y: 70 })),
        style: { stroke: stroke(hex("#FFFFFF"), 1.4, { opacity: 0.7 }) },
    });
    // Light crossing the plate.
    put({ ...base(id("plate.sheen"), { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(plate)), style: { gradientFill: sweep(id("plate.sheen"), script.sheen, -260, 1500, 280, "80") } });

    // Screws only where the plate is fixed: a hex head with a six-point socket.
    const turn = script.seat === undefined ? undefined : keyed<Vec3>(id("screw.turn"), [[0, { x: 0, y: 0, z: -120 }], [script.seat - 44, { x: 0, y: 0, z: -120 }, SNAP], [script.seat, { x: 0, y: 0, z: 0 }]]);
    const screw = (name: string, x: number, y: number) => {
        put({ ...base(id(name), { outTick: END, x, y, rotation: turn }), ...hexagon(7.5, 0), style: { gradientFill: radial([[0, hex("#F2F3F5")], [0.6, hex("#9AA0A6")], [1, hex("#6B7077")]], 8), stroke: stroke(hex("#4A4E54"), 1) } });
        put({
            ...base(id(`${name}.socket`), { outTick: END, x, y, rotation: turn }),
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

    // --- The engraving: the name, the pitch, the channel and the model line ---

    const LIGHT: Cut = { weight: 0.18, chamfer: 0.06 };
    const STRETCH = 1.3;
    // Engraved: dark letters with a lit lower lip, as if cut into the metal.
    const engrave = (name: string, text: string, x: number, y: number, H: number) => {
        const gap = H * 0.16;
        let cursor = x;
        for (const [index, letter] of [...text].entries()) {
            const { width, path } = glyph(letter, H, LIGHT);
            if (path.contours.length > 0) {
                for (const [layer, dy, color, alpha] of [["lip", 1.6, hex("#FFFFFF"), 0.6], ["cut", 0, ENGRAVE, 1]] as const) {
                    put({
                        ...base(id(`${name}.${index}.${layer}`), { outTick: END, x: cursor, y: y + dy, scale: { x: STRETCH, y: 1 } }),
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
    const microtype = (name: string, text: string, x: number, y: number, cell: number, color: Color, opacity: Animatable<number> = constant(1), lip = false) => {
        const label = cellWordmark(text, { cell, gap: cell * 0.2, face: "3x5" });
        if (lip) {
            put({ ...base(id(`${name}.lip`), { outTick: END, x: x + label.width / 2, y: y + 1 }), type: "path", path: constant(label.path), style: { fill: fill(hex("#FFFFFF"), 0.5) } });
        }
        put({ ...base(id(name), { outTick: END, x: x + label.width / 2, y, opacity }), type: "path", path: constant(label.path), style: { fill: fill(color) } });
        return label.width;
    };

    const NAME_X = 196;
    engrave("name.discord", "DISCORD", NAME_X, 96, 68);
    const mcpRight = engrave("name.mcp", "MCP", NAME_X, 184, 68);
    microtype("pitch.0", "ONE TOOL. RUNS YOUR CODE.", mcpRight + 30, 205, 2.6, ENGRAVE, constant(1), true);
    microtype("pitch.1", "TOKENS STAY IN THE AGENT.", mcpRight + 30, 228, 2.6, ENGRAVE, constant(1), true);
    // The channel: one continuous biomorphic groove from the nose into the
    // module, a dark cut with a lit lower lip, and faint contour lines either
    // side, like the kit's aero-cutline study.
    {
        const cubic = (p0: Point, c0: Point, c1: Point, p1: Point, steps = 40): Point[] =>
            Array.from({ length: steps + 1 }, (_, i) => {
                const t = i / steps;
                const u = 1 - t;
                return {
                    x: u * u * u * p0.x + 3 * u * u * t * c0.x + 3 * u * t * t * c1.x + t * t * t * p1.x,
                    y: u * u * u * p0.y + 3 * u * u * t * c0.y + 3 * u * t * t * c1.y + t * t * t * p1.y,
                };
            });
        const groove = [
            ...cubic({ x: 70, y: 236 }, { x: 150, y: 292 }, { x: 380, y: 262 }, { x: 560, y: 276 }),
            ...cubic({ x: 560, y: 276 }, { x: 700, y: 287 }, { x: 790, y: 286 }, { x: 866, y: 262 }).slice(1),
        ];
        put({ ...base(id("channel.lip"), { outTick: END, x: 0, y: 2.2 }), type: "path", path: constant(openPath(...groove)), style: { stroke: stroke(hex("#FFFFFF"), 1.6, { opacity: 0.6 }) } });
        put({ ...base(id("channel.cut"), { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath(...groove)), style: { stroke: stroke(ENGRAVE, 8) } });
        for (const [index, dy] of [-11, 13].entries()) {
            put({ ...base(id(`channel.contour-${index}`), { outTick: END, x: 0, y: dy }), type: "path", path: constant(openPath(...groove)), style: { stroke: stroke(ENGRAVE, 1, { opacity: 0.32 }) } });
        }
    }
    microtype("model", "MODEL TX-01 / DISCORD.JS 14 / NODE 22 / 1 TOOL", NAME_X, 302, 2.2, ENGRAVE, constant(0.85), true);

    // --- The module: molded elastomer, where the hand goes ---

    const MOD = { x: 868, y: 102, w: 330, h: 196 };
    const moduleOutline = rounded(MOD.x, MOD.y, MOD.w, MOD.h, [44, 16, 16, 44]);
    put({ ...base(id("module.shadow"), { outTick: END, x: 0, y: 4 }), type: "path", path: constant(shape(moduleOutline)), style: { fill: fill(hex("#000000"), 0.35) } });
    put({
        ...base(id("module"), { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant(shape(moduleOutline)),
        style: { gradientFill: linear([[0, hex("#4A4E52")], [0.12, hex("#3A3D41")], [1, hex("#25282C")]], { x: 0, y: MOD.y }, { x: 0, y: MOD.y + MOD.h }), stroke: stroke(hex("#15171A"), 1.5) },
    });
    put({
        ...base(id("module.lip"), { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant(openPath(...arc(MOD.x + 44, MOD.y + 44, 42, 42, 200, 270, 8), { x: MOD.x + MOD.w - 16, y: MOD.y + 2 })),
        style: { stroke: stroke(hex("#FFFFFF"), 1, { opacity: 0.16 }) },
    });

    // The LCD: smoked polymer, unlit segments faintly visible.
    const WIN = { x: 896, y: 122, w: 282, h: 70 };
    put({
        ...base(id("lcd"), { outTick: END, x: 0, y: 0 }),
        type: "path",
        path: constant(shape(rounded(WIN.x, WIN.y, WIN.w, WIN.h, [10, 6, 6, 10]))),
        style: { gradientFill: linear([[0, hex("#13191D")], [0.55, hex("#28333A")], [1, OBSIDIAN]], { x: WIN.x, y: WIN.y }, { x: WIN.x + WIN.w, y: WIN.y + WIN.h }), stroke: stroke(hex("#000000"), 1.5) },
    });
    put({ ...base(id("lcd.lip"), { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath({ x: WIN.x + 10, y: WIN.y + WIN.h + 1 }, { x: WIN.x + WIN.w - 6, y: WIN.y + WIN.h + 1 })), style: { stroke: stroke(hex("#FFFFFF"), 1, { opacity: 0.1 }) } });
    const LCD_TEXT = { x: WIN.x + 16, y: WIN.y + 26, cell: 4.4 };
    microtype("lcd.ghost", "88888888", LCD_TEXT.x, LCD_TEXT.y, LCD_TEXT.cell, BONE, constant(0.06));
    microtype("lcd.label", "T-01", WIN.x + WIN.w - 46, WIN.y + 14, 1.8, BONE, constant(0.45));
    // The LCD's lines: each text once, shown in all its spans.
    const texts = new Map<string, Span[]>();
    for (const { text, from, to } of script.lcd) {
        texts.set(text, [...(texts.get(text) ?? []), [from, to]]);
    }
    for (const [index, [text, spans]] of [...texts.entries()].entries()) {
        const name = index < 3 ? ["lcd.ready", "lcd.run", "lcd.ok"][index] : `lcd.text-${index}`;
        microtype(name, text, LCD_TEXT.x, LCD_TEXT.y, LCD_TEXT.cell, BONE, during(`${name}.on`, spans));
    }
    // A block cursor that blinks while it runs.
    {
        const keys: Array<Key<number>> = [[0, 0]];
        for (const [from, to] of script.cursor) {
            keys.push([from - 1, 0]);
            for (let t = from; t + 16 <= to; t += 16) {
                keys.push([t, 1], [t + 7, 1], [t + 8, 0], [t + 15, 0]);
            }
            keys.push([to, 0]);
        }
        put({ ...base(id("lcd.cursor"), { outTick: END, x: LCD_TEXT.x + 66, y: LCD_TEXT.y, opacity: keyed(id("lcd.cursor.on"), keys) }), type: "rect", size: constant({ width: 13, height: 22 }), cornerRadius: constant(1), style: { fill: fill(BONE) } });
    }
    // The progress bar along the window's foot: segments light in turn.
    const SEGMENTS = 16;
    for (let i = 0; i < SEGMENTS; i += 1) {
        const x = WIN.x + 16 + i * 15.5;
        put({ ...base(id(`lcd.seg-${i}`), { outTick: END, x: x + 6, y: WIN.y + 56 }), type: "rect", size: constant({ width: 12, height: 5 }), cornerRadius: constant(1), style: { fill: fill(BONE, 0.07) } });
        const spans = script.progress.map(({ from, to, off }): Span => [from + Math.round((i / SEGMENTS) * (to - from)), off]);
        put({ ...base(id(`lcd.seg-${i}.on`), { outTick: END, x: x + 6, y: WIN.y + 56, opacity: during(`lcd.seg-${i}.lit`, spans) }), type: "rect", size: constant({ width: 12, height: 5 }), cornerRadius: constant(1), style: { fill: fill(ION) } });
    }

    // The pebble key, which sinks when pressed; its light shows the state.
    const KEY = { x: 930, y: 250 };
    const pressKeys = (dx: number): Array<Key<Vec3>> => {
        const keys: Array<Key<Vec3>> = [[0, v3(KEY.x + dx, KEY.y)]];
        for (const t of script.presses) {
            keys.push([t - 2, v3(KEY.x + dx, KEY.y), SNAP], [t + 1, v3(KEY.x + dx, KEY.y + 2.5)], [t + 8, v3(KEY.x + dx, KEY.y), IN_OUT]);
        }
        return keys;
    };
    put({ ...base(id("key.well"), { outTick: END, x: KEY.x, y: KEY.y + 2, rotation: -14 }), type: "ellipse", size: constant({ width: 58, height: 50 }), style: { fill: fill(hex("#15171A")) } });
    put({
        ...base(id("key"), { outTick: END, position: keyed<Vec3>(id("key.press"), pressKeys(0)), rotation: -14 }),
        type: "ellipse",
        size: constant({ width: 54, height: 46 }),
        style: { gradientFill: linear([[0, hex("#565A5F")], [0.4, hex("#3C3F44")], [1, hex("#2A2D31")]], { x: 0, y: -23 }, { x: 0, y: 23 }), stroke: stroke(hex("#121315"), 1.2) },
    });
    put({
        ...base(id("key.glyph"), { outTick: END, position: keyed<Vec3>(id("key.glyph.press"), pressKeys(2)) }),
        type: "polystar",
        variant: "polygon",
        points: constant(3),
        innerRadius: constant(0),
        outerRadius: constant(10),
        innerRoundness: constant(0),
        outerRoundness: constant(0),
        rotationOffset: constant(90),
        style: { fill: fill(BONE) },
    });
    put({ ...base(id("key.led"), { outTick: END, x: KEY.x + 24, y: KEY.y - 26 }), type: "ellipse", size: constant({ width: 7, height: 7 }), style: { fill: fill(OFF), stroke: stroke(hex("#000000"), 1, { opacity: 0.5 }) } });
    put({ ...base(id("key.led.glow"), { outTick: END, x: KEY.x + 24, y: KEY.y - 26, opacity: during("key.led.on", script.light) }), type: "ellipse", size: constant({ width: 18, height: 18 }), style: { gradientFill: radial([[0, ION], [0.32, ION], [0.4, hex("#65B8D666")], [1, hex("#65B8D600")]], 9) } });

    // The level columns: dark, lighting in a moving pattern while it runs.
    const LEVELS = 7;
    for (let i = 0; i < LEVELS; i += 1) {
        const h = 14 + i * 3.4;
        const x = 980 + i * 11;
        const y = 270 - h / 2;
        put({ ...base(id(`level-${i}`), { outTick: END, x, y }), type: "rect", size: constant({ width: 7, height: h }), cornerRadius: constant(3.5), style: { fill: fill(hex("#121315")), stroke: stroke(hex("#FFFFFF"), 0.6, { opacity: 0.06 }) } });
        // A deterministic flicker, louder toward the start of each run.
        const keys: Array<Key<number>> = [[0, 0]];
        for (const { from, to, hold } of script.levels) {
            keys.push([from + 4, 0]);
            for (let t = from + 6, k = 0; t < to; t += 6, k += 1) {
                const level = (Math.sin(k * 1.7 + i * 0.9) * 0.5 + 0.5) * (1 - ((t - from) / (to - from)) * 0.5);
                keys.push([t, level > (i / LEVELS) * 0.9 ? 1 : 0]);
            }
            keys.push([to, i < 4 ? 1 : 0], [hold - 1, i < 4 ? 1 : 0], [hold, 0]);
        }
        put({ ...base(id(`level-${i}.on`), { outTick: END, x, y, opacity: keyed(id(`level-${i}.lit`), keys) }), type: "rect", size: constant({ width: 7, height: h }), cornerRadius: constant(3.5), style: { gradientFill: linear([[0, ION], [1, ION_DEEP]], { x: 0, y: -h / 2 }, { x: 0, y: h / 2 }) } });
    }

    // The vent: a hex-perforated mesh, where the module breathes.
    {
        const VENT = { x: 1072, y: 222, w: 106, h: 54 };
        put({ ...base(id("vent"), { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(rounded(VENT.x, VENT.y, VENT.w, VENT.h, [14, 6, 6, 14]))), style: { gradientFill: linear([[0, hex("#3E4246")], [1, hex("#2A2D31")]], { x: 0, y: VENT.y }, { x: 0, y: VENT.y + VENT.h }), stroke: stroke(hex("#121315"), 1) } });
        const holes: PathContour[] = [];
        const step = 6.4;
        for (let row = 0, y = VENT.y + 7; y < VENT.y + VENT.h - 5; row += 1, y += step * 0.866) {
            for (let x = VENT.x + 9 + (row % 2) * (step / 2); x < VENT.x + VENT.w - 6; x += step) {
                holes.push(circleContour({ x, y }, 1.7));
            }
        }
        put({ ...base(id("vent.holes"), { outTick: END, x: 0, y: 0 }), type: "path", path: constant({ contours: holes } as PathData), style: { fill: fill(hex("#0B0C0D")) } });
    }
    return ids;
};
