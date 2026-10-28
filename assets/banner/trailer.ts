// A 25-second teaser trailer, authored with Clayzo: a product film of the
// device in the README banner (device.ts), in the Y2K design spec's language.
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
// One device, filmed by one camera: macro framings of real parts (the
// engraved name, a screw seating, the key being pressed, the LCD running,
// the module, the engraved pitch), a quick run of details, then a pull back
// to the whole device, as the banner shows it. The device acts out the
// story on its LCD and status light: READY, RUN, OK, KEPT 05, SEALED, OK.
// The plate wears the v5 kit's brushed-titanium texture (textures/). Short
// bone cards carry the copy; a HUD names the state in Ion Blue, the one
// accent. Motion is the spec's: light revealing material, slow camera
// drifts, cuts on the beat, a faint light on each lock instead of white
// flashes, no flicker and no permanent pulsing.
//
// Shots (30 fps ticks), timed to the soundtrack in trailer-audio.py:
//   1    0– 75  STANDBY  light rakes across the engraved name
//   2   75–150  ARMED    a screw turns and seats                        ONE TOOL.
//   3  150–240  RUN      the key is pressed; its light comes on          RUN
//   4  240–345  LIVE     the LCD runs: RUN, progress, levels, OK         YOUR CODE. LIVE API.
//   5  345–435  KEPT     the module: KEPT 05, the bar fills in steps     KEPT ACROSS RESTARTS
//   6  435–540  SEALED   light reveals "TOKENS STAY IN THE AGENT."
//   7  540–630  SEALED   five quick details, a card, then black          ENCRYPTED AT REST
//   8  630–750  OK       pull back to the whole device; the line; hold

import { readFileSync, writeFileSync } from "node:fs";
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
    trim,
    withComputedRevision,
    type Animatable,
    type Color,
    type SceneNode,
    type Vec3,
} from "@clayzo/animation";
import { BONE, CHROME, GRAPHITE, ION, OBSIDIAN, PARTS, TITANIUM, device } from "./device.ts";
import { IN_OUT, SLOW, Scene, glyph, linear, openPath, radial, type Cut, type Ease, type Key, type Point } from "./kit.ts";

const W = 1920;
const H = 1080;
const FPS = 30;
const END = 25 * FPS;
const CENTRE = { x: W / 2, y: H / 2 };
const EDGE = hex("#4B555C");

const scene = new Scene(END);
const at = (x: number, y: number): Vec3 => ({ x, y, z: 0 });

// The ticks the soundtrack hits: the seat, the lock, the impact.
const SEAT = 130;
const LOCK = 198;
const IMPACT = 630;

// --- Helpers ---

// Visible inside the windows, with short (3-tick) transitions.
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
const appear = (id: string, from: number, length = 8): Animatable<number> => keyed(id, [[0, 0], [from, 0, SLOW], [from + length, 1]]);
// Pixel microtype, from its left edge.
const micro = (id: string, text: string, x: number, y: number, cell: number, color: Color, opacity: Animatable<number> = constant(1)) => {
    const label = cellWordmark(text, { cell, gap: cell * 0.2, face: "3x5" });
    return scene.child({ ...base(id, { outTick: END, x: x + label.width / 2, y, opacity }), type: "path", path: constant(label.path), style: { fill: fill(color) } });
};
// Bone lettering in the device's wide, upright cut.
const LIGHT: Cut = { weight: 0.18, chamfer: 0.06 };
const STRETCH = 1.3;
const measure = (text: string, cap: number) => [...text].reduce((sum, letter) => sum + glyph(letter, cap, LIGHT).width * STRETCH, 0) + cap * 0.16 * (text.length - 1);
const words = (id: string, text: string, cap: number, color: Color = BONE) => {
    const letters: string[] = [];
    let cursor = 0;
    for (const [index, letter] of [...text].entries()) {
        const { width, path } = glyph(letter, cap, LIGHT);
        if (path.contours.length > 0) {
            letters.push(scene.child({ ...base(`${id}.${index}`, { outTick: END, x: cursor, y: 0, scale: { x: STRETCH, y: 1 } }), type: "path", path: constant(path), style: { fill: fill(color) } }));
        }
        cursor += width * STRETCH + cap * 0.16;
    }
    return letters;
};
// A card: an index label and a line of lettering, centred, sliding in a
// little over a short transition, then out. A dark band behind it keeps it
// legible over the metal.
const card = (id: string, index: string, text: string, start: number, end: number, cap: number, y: number) => {
    const width = measure(text, cap);
    const x = (W - width) / 2;
    const fade = (name: string) => keyed(name, [[0, 0], [start, 0, SLOW], [start + 8, 1], [end - 5, 1], [end, 0]]);
    scene.add({
        ...base(`${id}.band`, { outTick: END, x: CENTRE.x, y: y + cap / 2 - 6, opacity: fade(`${id}.band.fade`) }),
        type: "rect",
        size: constant({ width: W, height: cap + 130 }),
        cornerRadius: constant(0),
        style: { gradientFill: linear([[0, hex("#10121400")], [0.3, hex("#101214C0")], [0.7, hex("#101214C0")], [1, hex("#10121400")]], { x: 0, y: -(cap + 130) / 2 }, { x: 0, y: (cap + 130) / 2 }) },
    });
    scene.add({
        ...base(id, { outTick: END, position: keyed<Vec3>(`${id}.slide`, [[0, at(x + 18, y)], [start, at(x + 18, y), SLOW], [start + 10, at(x, y)]]), opacity: fade(`${id}.fade`) }),
        type: "group",
        children: [...words(`${id}.words`, text, cap), micro(`${id}.index`, index, 0, -26, 3, TITANIUM)],
    });
};

// --- The studio: obsidian, a faint technical grid, a soft graphite glow ---

scene.add({ ...base("studio", { outTick: END, x: CENTRE.x, y: CENTRE.y }), type: "rect", size: constant({ width: W, height: H }), cornerRadius: constant(0), style: { fill: fill(OBSIDIAN) } });
scene.add({ ...base("studio.glow", { outTick: END, x: 980, y: 520 }), type: "ellipse", size: constant({ width: 2000, height: 1300 }), style: { gradientFill: radial([[0, hex("#2A2F35")], [0.55, hex("#1A1D21")], [1, hex("#10121400")]], 1000) } });
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

// --- The device, acting out the story ---

const textureData = readFileSync(new URL("./textures/brushed-titanium.jpg", import.meta.url)).toString("base64");
const assets = { "brushed-titanium": { id: "brushed-titanium", type: "image" as const, uri: `data:image/jpeg;base64,${textureData}`, width: 512, height: 512, mimeType: "image/jpeg" } };
const parts = device(scene, (node: SceneNode) => scene.child(node), {
    lcd: [
        { text: "READY", from: 0, to: LOCK },
        { text: "RUN", from: LOCK, to: 330 },
        { text: "OK 0.42S", from: 330, to: 352 },
        { text: "KEPT 05", from: 352, to: 435 },
        { text: "SEALED", from: 435, to: IMPACT },
        { text: "OK 0.42S", from: IMPACT, to: END },
    ],
    cursor: [[LOCK, 326]],
    progress: [{ from: 246, to: 322, off: 352 }, { from: 360, to: 424, off: 435 }],
    presses: [LOCK],
    light: [[LOCK + 1, END]],
    levels: [{ from: LOCK, to: 330, hold: 352 }, { from: 356, to: 424, hold: 435 }],
    sheen: [{ start: 10, span: 58 }, { start: 462, span: 54 }, { start: IMPACT + 18, span: 44 }],
    seat: SEAT,
    texture: { id: "brushed-titanium", tile: 128 },
}, "device.");

// --- The camera: framings of the device, drifting within each shot ---

type Framing = { from: number; to: number; focus: [Point, Point]; scale: [number, number]; turn: [number, number] };
const P = PARTS;
const shift = (p: Point, dx: number, dy = 0): Point => ({ x: p.x + dx, y: p.y + dy });
const FRAMINGS: Framing[] = [
    { from: 0, to: 75, focus: [shift(P.name, -90, 4), shift(P.name, 60, 4)], scale: [3.5, 3.7], turn: [-6, -4] },
    { from: 75, to: 150, focus: [shift(P.screw, 26, 22), shift(P.screw, 8, 6)], scale: [11, 12.5], turn: [6, 2] },
    { from: 150, to: 240, focus: [shift(P.module, -30, 10), shift(P.module, -20, 12)], scale: [4.3, 4.6], turn: [-3, -1] },
    { from: 240, to: 345, focus: [shift(P.lcd, -10, 4), shift(P.lcd, 10, 6)], scale: [5.4, 5.7], turn: [2, 0] },
    { from: 345, to: 435, focus: [shift(P.module, -10, 0), shift(P.module, 10, 4)], scale: [3.5, 3.7], turn: [-2, -1] },
    { from: 435, to: 540, focus: [shift(P.pitch, -80, 0), shift(P.pitch, 60, 0)], scale: [4.6, 4.8], turn: [3, 1] },
    { from: 540, to: 550, focus: [P.vent, shift(P.vent, 6)], scale: [7, 7.2], turn: [-4, -4] },
    { from: 550, to: 560, focus: [P.channel, shift(P.channel, 14)], scale: [5, 5.2], turn: [5, 5] },
    { from: 560, to: 570, focus: [P.levels, shift(P.levels, 4)], scale: [8, 8.2], turn: [-2, -2] },
    { from: 570, to: 580, focus: [{ x: 1224, y: 92 }, { x: 1220, y: 96 }], scale: [11, 11.4], turn: [4, 4] },
    { from: 580, to: IMPACT, focus: [P.model, shift(P.model, 12)], scale: [5.4, 5.6], turn: [-3, -3] },
    { from: IMPACT, to: END, focus: [shift(P.whole, 0, 30), shift(P.whole, 0, 30)], scale: [1.56, 1.46], turn: [-1.5, 0] },
];
// One key per framing's start and end: drifts within a shot, cuts between.
const track = <T>(id: string, value: (f: Framing, end: boolean) => T): Animatable<T> => {
    const keys: Array<Key<T>> = [];
    for (const f of FRAMINGS) {
        const ease: Ease | "linear" = f.from === IMPACT ? SLOW : "linear";
        keys.push([f.from, value(f, false), ease], [f.to - 1, value(f, true)]);
    }
    return keyed(id, keys);
};
scene.add({
    ...base("camera", {
        outTick: END,
        x: CENTRE.x,
        y: CENTRE.y - 20,
        anchor: track<Vec3>("camera.focus", (f, end) => at(f.focus[end ? 1 : 0].x, f.focus[end ? 1 : 0].y)),
        scale: track<Vec3>("camera.scale", (f, end) => ({ x: f.scale[end ? 1 : 0], y: f.scale[end ? 1 : 0], z: 1 })),
        rotation: track<Vec3>("camera.turn", (f, end) => ({ x: 0, y: 0, z: f.turn[end ? 1 : 0] })),
        opacity: windows("camera.cut", [[0, 594], [IMPACT, END]], 2),
    }),
    type: "group",
    children: parts,
});

// --- Cards ---

card("card.one-tool", "01 / ONE TOOL", "ONE TOOL.", 100, 147, 72, 880);
card("card.run", "02 / RUN", "RUN", 206, 238, 120, 830);
card("card.code", "03 / LIVE", "YOUR CODE. LIVE API.", 300, 343, 48, 900);
card("card.kept", "04 / KEPT", "KEPT ACROSS RESTARTS", 404, 433, 46, 900);
card("card.sealed", "06 / AT REST", "ENCRYPTED AT REST", 594, 618, 64, 500);

// --- The end card: under the whole device, the line and the address ---

scene.add({
    ...base("end", { outTick: END, x: 0, y: 0 }),
    type: "group",
    children: [
        micro("end.sub", "ONE TOOL / YOUR CODE / THE LIVE DISCORD API", 300, 900, 4.4, TITANIUM, appear("end.sub.on", IMPACT + 26, 12)),
        scene.child({ ...base("end.rule", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath({ x: 300, y: 944 }, { x: 1620, y: 944 })), style: { stroke: stroke(ION, 3) }, operators: [trim("end.rule.trim", { end: keyed("end.rule.end", [[0, 0], [IMPACT + 22, 0, SLOW], [IMPACT + 52, 1]]) })] }),
        micro("end.url", "GITHUB.COM/DRVOVA/DISCORD-MCP", 300, 984, 4.4, BONE, appear("end.url.on", IMPACT + 36, 12)),
    ],
});

// --- The HUD: system identifier, live status, shot index; hidden in the black ---

// Soft dark bands at the top and bottom keep the HUD legible over metal.
for (const [name, y, flip] of [["hud.band-top", 70, false], ["hud.band-bottom", H - 70, true]] as const) {
    scene.add({
        ...base(name, { outTick: END, x: CENTRE.x, y }),
        type: "rect",
        size: constant({ width: W, height: 140 }),
        cornerRadius: constant(0),
        style: { gradientFill: linear(flip ? [[0, hex("#10121400")], [1, hex("#101214D0")]] : [[0, hex("#101214D0")], [1, hex("#10121400")]], { x: 0, y: -70 }, { x: 0, y: 70 }) },
    });
}

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
    const HITS: Array<[number, number]> = [[SEAT, 0.1], [LOCK, 0.16], [488, 0.1], [IMPACT, 0.22]];
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
    // small, in the corner, clear of the cards and the HUD; no pulsing.
    const badge = { x: 1792, y: 894 };
    const R = 62;
    scene.add({ ...base("play.shadow", { outTick: END, x: badge.x + 8, y: badge.y + 12 }), type: "ellipse", size: constant({ width: R * 2 + 10, height: R * 2 + 10 }), style: { gradientFill: radial([[0, hex("#000000CC")], [0.75, hex("#00000088")], [1, hex("#00000000")]], R + 5) } });
    scene.add({ ...base("play.bezel", { outTick: END, x: badge.x, y: badge.y }), type: "ellipse", size: constant({ width: R * 2, height: R * 2 }), style: { gradientFill: linear([[0, CHROME], [0.4, TITANIUM], [1, hex("#7F858B")]], { x: 0, y: -R }, { x: 0, y: R }), stroke: stroke(EDGE, 2) } });
    scene.add({ ...base("play.face", { outTick: END, x: badge.x, y: badge.y }), type: "ellipse", size: constant({ width: R * 2 - 20, height: R * 2 - 20 }), style: { gradientFill: linear([[0, hex("#3A3F44")], [1, GRAPHITE]], { x: 0, y: -R }, { x: 0, y: R }), stroke: stroke(OBSIDIAN, 3) } });
    scene.add({
        ...base("play.arrow", { outTick: END, x: badge.x + 6, y: badge.y }),
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
        marker("standby", 0, { name: "Light rakes the engraved name", durationTicks: 75 }),
        marker("armed", 75, { name: "A screw seats", durationTicks: 75 }),
        marker("run", 150, { name: "The key is pressed", durationTicks: 90 }),
        marker("live", 240, { name: "The LCD runs", durationTicks: 105 }),
        marker("kept", 345, { name: "KEPT 05", durationTicks: 90 }),
        marker("sealed", 435, { name: "Tokens stay in the agent", durationTicks: 105 }),
        marker("details", 540, { name: "Details, card, black", durationTicks: 90 }),
        marker("ok", IMPACT, { name: "The whole device", durationTicks: END - IMPACT }),
    ],
    design: {
        description: "A 25-second product film of the discord-mcp device: macro shots of the titanium plate, its engraving, screws, key and LCD, then the whole device.",
        accessibilityLabel: "discord-mcp teaser: one tool runs your code against the live Discord API; helpers are kept across restarts; tokens stay in the agent; secrets are encrypted at rest.",
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
