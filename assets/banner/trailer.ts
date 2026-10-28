// A 25-second teaser trailer in the banner's style, authored with Clayzo.
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
// The cut follows 2000s product spots: a slow build out of darkness, macro
// hardware and light raking across metal, parts sliding and locking with
// white hits, one- or two-word cards held about a second, a fast montage, a
// beat of black, then an impact on the end card, which holds.
//
// Shots (30 fps ticks):
//   1    0– 75  dark bunker, a streak of light rakes along a riveted seam
//   2   75–150  macro: a chrome hex bolt turns and seats          ONE TOOL.
//   3  150–240  two chrome blades slide in and lock into the X    RUN
//   4  240–345  schematic: the X drawn as wireframe, spec labels  YOUR CODE. LIVE API.
//   5  345–435  chrome plates (helpers) drop and lock in a stack  KEPT ACROSS RESTARTS
//   6  435–540  blast doors slam over a glowing key, bolts drive  TOKENS NEVER LEAVE
//   7  540–630  montage with white hits, a card, then black      ENCRYPTED AT REST
//   8  630–750  impact: the end card, one light sweep, hold

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
    trim,
    withComputedRevision,
    type Animatable,
    type Color,
    type Vec3,
} from "@clayzo/animation";
import {
    BLACK,
    BLURPLE_CHROME,
    CHROME,
    EMBLEM_BLADES,
    EMBLEM_CROSSING,
    IN_OUT,
    MICROTYPE,
    SLOW,
    SNAP,
    Scene,
    WHITE,
    chamfered,
    chrome,
    emblem,
    hexagon,
    lettering,
    letteringWidth,
    linear,
    openPath,
    radial,
    rivet,
    seam,
    shape,
    sheenBand,
    steelPlate,
    sweep,
    type Key,
    type Point,
} from "./kit.ts";

const W = 1920;
const H = 1080;
const FPS = 30;
const END = 25 * FPS;
const CENTRE = { x: W / 2, y: H / 2 };
const ACCENT = hex("#5865F2");
const ACCENT_LIGHT = hex("#A9B1FF");

const scene = new Scene(END);
const v3 = (x: number, y = x): Vec3 => ({ x, y, z: 1 });

// Hard cuts: visible (1) only inside the windows, switching in one frame.
const windows = (id: string, spans: Array<[number, number]>): Animatable<number> => {
    const keys: Array<Key<number>> = [[0, 0]];
    for (const [start, end] of spans) {
        keys.push([Math.max(start - 1, keys[keys.length - 1][0] + 1), 0], [start, 1], [end - 1, 1], [end, 0]);
    }
    return keyed(id, keys.filter((key, i) => i === 0 || key[0] > 0));
};
// A camera that holds a scale and cuts between values: [tick, scale].
const camera = (id: string, cuts: Array<[number, number]>): Animatable<Vec3> => {
    const keys: Array<Key<Vec3>> = [[0, v3(cuts[0][1])]];
    for (const [tick, scale] of cuts.slice(1)) {
        keys.push([tick - 1, keys[keys.length - 1][1]], [tick, v3(scale)]);
    }
    return keyed(id, keys);
};
// A shot: a group about the frame's centre, shown in its windows.
const shot = (id: string, spans: Array<[number, number]>, children: string[], scale: Animatable<Vec3> = constant(v3(1)), anchor: Point = CENTRE) =>
    scene.add({
        ...base(id, { outTick: END, x: CENTRE.x, y: CENTRE.y, anchor, scale, opacity: windows(`${id}.cut`, spans) }),
        type: "group",
        children,
    });
// Pixel microtype, centred on (x, y).
const microtype = (id: string, text: string, x: number, y: number, cell: number, color: Color, opacity: Animatable<number> = constant(1)) => {
    const label = cellWordmark(text, { cell, gap: cell * 0.2, face: "3x5" });
    return scene.child({ ...base(id, { outTick: END, x, y, opacity }), type: "path", path: constant(label.path), style: { fill: fill(color) } });
};
// A card: one line of chrome block letters, centred, cut in with a flicker
// and cut out hard, with one reflection passing while it holds.
const card = (id: string, text: string, start: number, end: number, cap: number, y: number, stops = CHROME) => {
    const width = letteringWidth(text, cap);
    lettering(scene, id, text, (W - width) / 2 + cap * 0.12, y, cap, {
        stops,
        passes: [{ start: start + 3, span: Math.min(28, end - start - 5) }],
        opacity: (index) => keyed(`${id}.${index}.opacity`, [[0, 0], [start - 1, 0], [start, 1], [start + 2, 0.3], [start + 3, 1], [end - 1, 1], [end, 0]]),
    });
};

// --- The bunker: always behind, framed differently per shot ---

const bunker: string[] = [];
{
    const inner = new Scene(END);
    steelPlate(inner, "bunker.plate", [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], 0, H);
    for (const [index, x] of [260, 900, 1500].entries()) {
        sheenBand(inner, `bunker.sheen-${index}`, x, H, 240);
    }
    const top = 150;
    const bottom = H - 150;
    seam(inner, "bunker.seam.top", { x: 0, y: top }, { x: W, y: top }, 6);
    seam(inner, "bunker.seam.bottom", { x: 0, y: bottom }, { x: W, y: bottom }, 6);
    for (const x of [480, 1440]) {
        seam(inner, `bunker.seam.${x}`, { x, y: top }, { x, y: bottom }, 6);
    }
    for (let x = 45; x < W; x += 90) {
        rivet(inner, `bunker.rivet.top-${x}`, x, top / 2, 20);
        rivet(inner, `bunker.rivet.bottom-${x}`, x, H - top / 2, 20);
    }
    for (const x of [480, 1440]) {
        for (let y = top + 60; y < bottom; y += 120) {
            rivet(inner, `bunker.rivet.${x}-${y}`, x + 26, y, 16);
        }
    }
    for (const id of inner.order) {
        bunker.push(scene.child(inner.nodes[id]));
    }
    for (const [id, node] of Object.entries(inner.nodes)) {
        scene.nodes[id] ??= node;
    }
}
// Macro on the top seam for shot 1 and its montage cut; wider elsewhere.
scene.add({
    ...base("bunker", {
        outTick: END,
        anchor: { x: 960, y: 150 },
        scale: keyed<Vec3>("bunker.scale", [
            [0, v3(2.6)], [74, v3(2.9), "linear"], [75, v3(1.5)], [149, v3(1.6), "linear"], [150, v3(1.25)], [579, v3(1.25)], [580, v3(2.8)], [589, v3(2.8)], [590, v3(1.25)], [629, v3(1.25)], [630, v3(1)],
        ]),
        // The top seam sits at this height on screen; chosen per scale so the
        // plate always fills the frame.
        position: keyed<Vec3>("bunker.position", [
            [0, { x: 960, y: 380, z: 0 }], [74, { x: 960, y: 380, z: 0 }], [75, { x: 960, y: 200, z: 0 }], [149, { x: 960, y: 200, z: 0 }], [150, { x: 960, y: 150, z: 0 }],
            [579, { x: 960, y: 150, z: 0 }], [580, { x: 960, y: 400, z: 0 }], [589, { x: 960, y: 400, z: 0 }], [590, { x: 960, y: 150, z: 0 }],
        ]),
    }),
    type: "group",
    children: bunker,
});
// The streak of light raking along the seam in shot 1 (and its montage cut).
scene.add({
    ...base("streak", {
        outTick: END,
        position: keyed<Vec3>("streak.position", [[0, { x: -500, y: 380, z: 0 }], [12, { x: -500, y: 380, z: 0 }, SLOW], [72, { x: 2400, y: 380, z: 0 }], [579, { x: -500, y: 400, z: 0 }], [580, { x: 300, y: 400, z: 0 }, "linear"], [590, { x: 1700, y: 400, z: 0 }]]),
        opacity: windows("streak.cut", [[0, 75], [580, 590]]),
    }),
    type: "ellipse",
    size: constant({ width: 1100, height: 46 }),
    style: { gradientFill: radial([[0, hex("#FFFFFFFF")], [0.25, hex("#E6ECFFCC")], [1, hex("#A9B1FF00")]], 550) },
});
// Darkness over the bunker, per shot: shots are lit low; the end card more.
scene.add({
    ...base("dark", { outTick: END, x: CENTRE.x, y: CENTRE.y }),
    type: "rect",
    size: constant({ width: W, height: H }),
    cornerRadius: constant(0),
    style: {
        fill: fill(BLACK, keyed("dark.opacity", [
            [0, 1], [6, 1, SLOW], [60, 0.2], [74, 0.2], [75, 0.55], [239, 0.55], [240, 0.82], [344, 0.82], [345, 0.6],
            [408, 0.6], [409, 0.95], [411, 0.6], [413, 0.9], [415, 0.6], [434, 0.6], [435, 0.5], [539, 0.5], [540, 0.55],
            [593, 0.55], [594, 0.8], [617, 0.8], [618, 1], [629, 1], [630, 0.3, SLOW], [680, 0.22],
        ])),
    },
});

// --- Shot 2: macro of a chrome hex bolt that turns and seats ---

{
    const turn = keyed<Vec3>("s2.turn", [[0, { x: 0, y: 0, z: -150 }], [76, { x: 0, y: 0, z: -150 }, SLOW], [126, { x: 0, y: 0, z: -4 }], [130, { x: 0, y: 0, z: 0 }]]);
    const seat = keyed<Vec3>("s2.seat", [[0, v3(1.08)], [126, v3(1.08), SNAP], [130, v3(1)]]);
    const parts = [
        scene.child({ ...base("s2.washer", { outTick: END, x: 0, y: 0 }), type: "ellipse", size: constant({ width: 720, height: 720 }), style: { gradientFill: linear([[0, hex("#4A5262")], [0.5, hex("#15181E")], [1, hex("#3A414F")]], { x: -300, y: -300 }, { x: 300, y: 300 }), stroke: stroke(BLACK, 6) } }),
        scene.child({ ...base("s2.depth", { outTick: END, x: 22, y: 28, rotation: turn }), ...hexagon(300, 0), style: { fill: fill(BLACK, 0.9) } }),
        scene.child({ ...base("s2.head", { outTick: END, x: 0, y: 0, rotation: turn }), ...hexagon(300, 0), style: { gradientFill: chrome(CHROME, -300, 300), stroke: stroke(BLACK, 6) } }),
        scene.child({ ...base("s2.chamfer", { outTick: END, x: 0, y: 0, rotation: turn }), ...hexagon(250, 0), style: { stroke: stroke(WHITE, 3, { opacity: 0.35 }) } }),
        scene.child({ ...base("s2.socket", { outTick: END, x: 0, y: 0, rotation: turn }), ...hexagon(120, 30), style: { gradientFill: linear([[0, BLACK], [1, hex("#1C2027")]], { x: 0, y: -120 }, { x: 0, y: 120 }), stroke: stroke(hex("#5B6373"), 3) } }),
        scene.child({ ...base("s2.glint", { outTick: END, x: 0, y: 0, rotation: turn }), ...hexagon(300, 0), style: { gradientFill: sweep("s2.glint", [{ start: 96, span: 30 }, { start: 541, span: 9 }], -420, 420, 220) } }),
    ];
    const bolt = scene.child({ ...base("s2.bolt", { outTick: END, x: 0, y: 0, scale: seat }), type: "group", children: parts });
    shot("s2", [[75, 150], [540, 550]], [scene.child({ ...base("s2.frame", { outTick: END, x: 960, y: 520 }), type: "group", children: [bolt] })], camera("s2.camera", [[0, 1], [540, 1.5]]), { x: 960, y: 520 });
}

// --- Shot 3: two chrome blades slide in and lock into the X ---

const LOCK = 198;
const sparks: string[] = [];
{
    const blade = (index: number, fromX: number) => {
        const outline = EMBLEM_BLADES[index];
        const path = constant(shape(outline));
        const slide = keyed<Vec3>(`s3.blade-${index}.slide`, [[0, { x: fromX, y: 0, z: 0 }], [152, { x: fromX, y: 0, z: 0 }, SLOW], [LOCK - 2, { x: 0, y: 0, z: 0 }]]);
        return scene.child({
            ...base(`s3.blade-${index}`, { outTick: END, position: slide }),
            type: "group",
            children: [
                scene.child({ ...base(`s3.blade-${index}.depth`, { outTick: END, x: 7, y: 9 }), type: "path", path, style: { fill: fill(BLACK, 0.9) } }),
                scene.child({ ...base(`s3.blade-${index}.body`, { outTick: END, x: 0, y: 0 }), type: "path", path, style: { gradientFill: chrome(CHROME, -130, 130), stroke: stroke(BLACK, 2) } }),
                scene.child({ ...base(`s3.blade-${index}.sweep`, { outTick: END, x: 0, y: 0 }), type: "path", path, style: { gradientFill: sweep(`s3.blade-${index}.sweep`, [{ start: 160, span: 30 }, { start: 212, span: 24 }], -170, 170, 90) } }),
            ],
        });
    };
    const { x, y } = EMBLEM_CROSSING;
    const drop = keyed<Vec3>("s3.bolt.drop", [[0, v3(2.4)], [LOCK, v3(2.4), SNAP], [LOCK + 6, v3(1)]]);
    const spin = keyed<Vec3>("s3.bolt.spin", [[0, { x: 0, y: 0, z: -120 }], [LOCK, { x: 0, y: 0, z: -120 }, SNAP], [LOCK + 6, { x: 0, y: 0, z: 0 }]]);
    const boltOn = keyed("s3.bolt.on", [[0, 0], [LOCK - 1, 0], [LOCK, 1]]);
    const bolt = scene.child({
        ...base("s3.bolt", { outTick: END, x, y, scale: drop, rotation: spin, opacity: boltOn }),
        type: "group",
        children: [
            scene.child({ ...base("s3.bolt.head", { outTick: END, x: 0, y: 0 }), ...hexagon(19, 0), style: { gradientFill: chrome(CHROME, -19, 19), stroke: stroke(BLACK, 2) } }),
            scene.child({ ...base("s3.bolt.socket", { outTick: END, x: 0, y: 0 }), ...hexagon(8, 30), style: { fill: fill(BLACK) } }),
        ],
    });
    // Sparks thrown from the crossing as the blades lock.
    for (let i = 0; i < 14; i += 1) {
        const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.21;
        const reach = 90 + (i % 4) * 40;
        sparks.push(scene.child({
            ...base(`s3.spark-${i}`, {
                outTick: END,
                rotation: (angle * 180) / Math.PI,
                position: keyed<Vec3>(`s3.spark-${i}.position`, [[0, { x, y, z: 0 }], [LOCK, { x, y, z: 0 }, SLOW], [LOCK + 16, { x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach, z: 0 }]]),
                opacity: keyed(`s3.spark-${i}.opacity`, [[0, 0], [LOCK - 1, 0], [LOCK, 1], [LOCK + 16, 0]]),
            }),
            type: "rect",
            size: constant({ width: 18, height: 2 }),
            cornerRadius: constant(1),
            style: { fill: fill(hex("#FFF4D6")) },
        }));
    }
    const x2 = scene.child({ ...base("s3.emblem", { outTick: END, x: 960, y: 500, anchor: EMBLEM_CROSSING, scale: 2.1 }), type: "group", children: [blade(0, -900), blade(1, 900), bolt, ...sparks] });
    shot("s3", [[150, 240], [550, 560], [590, 594]], [x2], camera("s3.camera", [[0, 1], [550, 1.9], [590, 1]]), { x: 960, y: 500 });
}

// --- Shot 4: the schematic, drawn as wireframe with spec labels ---

{
    const parts: string[] = [];
    const grid: Point[][] = [];
    for (let gx = 0; gx <= W; gx += 60) {
        grid.push([{ x: gx, y: 0 }, { x: gx, y: H }]);
    }
    for (let gy = 0; gy <= H; gy += 60) {
        grid.push([{ x: 0, y: gy }, { x: W, y: gy }]);
    }
    parts.push(scene.child({ ...base("s4.grid", { outTick: END, x: 0, y: 0 }), type: "path", path: constant({ contours: grid.map((line) => openPath(...line).contours[0]) }), style: { stroke: stroke(ACCENT_LIGHT, 1, { opacity: 0.08 }) } }));
    const draw = (id: string, start: number, length: number) => [trim(`${id}.trim`, { end: keyed(`${id}.end`, [[0, 0], [start, 0, SLOW], [start + length, 1]]) })];
    const wire: string[] = [];
    for (const [index, outline] of EMBLEM_BLADES.entries()) {
        wire.push(scene.child({ ...base(`s4.wire-${index}`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(outline)), style: { stroke: stroke(ACCENT_LIGHT, 1.2) }, operators: draw(`s4.wire-${index}`, 244 + index * 8, 40) }));
        // The blade's spine, dashed.
        wire.push(scene.child({ ...base(`s4.axis-${index}`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath(outline[0], outline[Math.floor(outline.length / 4)], outline[Math.floor(outline.length / 2) - 1])), style: { stroke: stroke(ACCENT_LIGHT, 0.6, { opacity: 0.5, dash: [4, 4] }) } }));
    }
    const { x, y } = EMBLEM_CROSSING;
    wire.push(scene.child({ ...base("s4.bolt", { outTick: END, x, y }), ...hexagon(19, 0), style: { stroke: stroke(ACCENT_LIGHT, 1.2) } }));
    wire.push(scene.child({ ...base("s4.bolt.socket", { outTick: END, x, y }), ...hexagon(8, 30), style: { stroke: stroke(ACCENT_LIGHT, 1) } }));
    const tilt = keyed<Vec3>("s4.tilt", [[0, { x: 0, y: 0, z: -3 }], [240, { x: 0, y: 0, z: -3 }, "linear"], [345, { x: 0, y: 0, z: 3 }]]);
    parts.push(scene.child({ ...base("s4.x", { outTick: END, x: 700, y: 520, anchor: EMBLEM_CROSSING, scale: 2.3, rotation: tilt }), type: "group", children: wire }));
    // Leaders out to spec labels.
    const specs: Array<[string, Point, number]> = [
        ["TOOL 01 / RUN", { x: 1180, y: 300 }, 262],
        ["TARGET / DISCORD.JS", { x: 1180, y: 480 }, 272],
        ["MODE / LIVE API", { x: 1180, y: 660 }, 282],
    ];
    const anchors: Point[] = [{ x: 860, y: 330 }, { x: 760, y: 520 }, { x: 880, y: 700 }];
    for (const [index, [text, at, start]] of specs.entries()) {
        const from = anchors[index];
        parts.push(scene.child({ ...base(`s4.leader-${index}`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(openPath(from, { x: at.x - 60, y: at.y }, { x: at.x - 16, y: at.y })), style: { stroke: stroke(ACCENT_LIGHT, 1.2, { opacity: 0.8 }) }, operators: draw(`s4.leader-${index}`, start, 14) }));
        parts.push(scene.child({ ...base(`s4.dot-${index}`, { outTick: END, x: from.x, y: from.y, opacity: keyed(`s4.dot-${index}.on`, [[0, 0], [start - 1, 0], [start, 1]]) }), type: "ellipse", size: constant({ width: 9, height: 9 }), style: { fill: fill(ACCENT_LIGHT) } }));
        const label = cellWordmark(text, { cell: 5, gap: 1, face: "3x5" });
        parts.push(microtype(`s4.label-${index}`, text, at.x + label.width / 2, at.y, 5, WHITE, keyed(`s4.label-${index}.on`, [[0, 0], [start + 10, 0], [start + 11, 1], [start + 13, 0.2], [start + 14, 1]])));
    }
    parts.push(microtype("s4.title", "FIG. 01 / ONE TOOL, THE WHOLE API", 960, 110, 4, MICROTYPE));
    shot("s4", [[240, 345]], parts);
}

// --- Shot 5: chrome plates, the model's helpers, drop and lock in a stack ---

{
    const parts: string[] = [];
    const names = ["HELPER 01 / FIND CHANNEL", "HELPER 02 / PURGE SPAM", "HELPER 03 / ROLE AUDIT", "HELPER 04 / WEEKLY DIGEST", "HELPER 05 / MOD QUEUE"];
    const PLATE_W = 960;
    const PLATE_H = 84;
    for (const [index, name] of names.entries()) {
        const lock = 352 + index * 11;
        const restY = 680 - index * 100;
        const drop = keyed<Vec3>(`s5.plate-${index}.drop`, [[0, { x: 960, y: -200, z: 0 }], [lock - 9, { x: 960, y: -200, z: 0 }, SNAP], [lock, { x: 960, y: restY, z: 0 }]]);
        const outline = chamfered(-PLATE_W / 2, -PLATE_H / 2, PLATE_W, PLATE_H, 18);
        const plateParts = [
            scene.child({ ...base(`s5.plate-${index}.depth`, { outTick: END, x: 8, y: 10 }), type: "path", path: constant(shape(outline)), style: { fill: fill(BLACK, 0.9) } }),
            scene.child({ ...base(`s5.plate-${index}.body`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(outline)), style: { gradientFill: chrome(CHROME, -PLATE_H / 2, PLATE_H / 2), stroke: stroke(BLACK, 3) } }),
            scene.child({ ...base(`s5.plate-${index}.sweep`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(outline)), style: { gradientFill: sweep(`s5.plate-${index}.sweep`, [{ start: lock + 2, span: 18 }], -600, 600, 260) } }),
            // An engraved name panel.
            scene.child({ ...base(`s5.plate-${index}.panel`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(chamfered(-330, -20, 660, 40, 10))), style: { fill: fill(hex("#0B0D11")), stroke: stroke(hex("#5B6373"), 1.5) } }),
            microtype(`s5.plate-${index}.name`, name, 0, 0, 4, ACCENT_LIGHT),
        ];
        for (const side of [-1, 1]) {
            plateParts.push(scene.child({ ...base(`s5.plate-${index}.screw-${side}`, { outTick: END, x: side * (PLATE_W / 2 - 52), y: 0 }), ...hexagon(14, 0), style: { gradientFill: chrome(CHROME, -14, 14), stroke: stroke(BLACK, 2) } }));
            plateParts.push(scene.child({ ...base(`s5.plate-${index}.socket-${side}`, { outTick: END, x: side * (PLATE_W / 2 - 52), y: 0 }), ...hexagon(6, 30), style: { fill: fill(BLACK) } }));
        }
        parts.push(scene.child({ ...base(`s5.plate-${index}`, { outTick: END, position: drop, opacity: keyed(`s5.plate-${index}.flicker`, [[0, 1], [408, 1], [409, 0.2], [411, 1], [413, 0.3], [415, 1]]) }), type: "group", children: plateParts }));
    }
    shot("s5", [[345, 435], [570, 580]], parts, camera("s5.camera", [[0, 1], [570, 1.6]]), { x: 960, y: 480 });
}

// --- Shot 6: blast doors slam over a glowing key; bolts drive in ---

const SLAM = 488;
{
    const parts: string[] = [];
    // The key, glowing, which never leaves the chamber.
    parts.push(scene.child({ ...base("s6.glow", { outTick: END, x: 960, y: 500 }), type: "ellipse", size: constant({ width: 900, height: 900 }), style: { gradientFill: radial([[0, hex("#5865F2AA")], [0.35, hex("#5865F244")], [1, hex("#5865F200")]], 450) } }));
    const keyShape = [
        scene.child({ ...base("s6.key.bow", { outTick: END, x: -150, y: 0 }), type: "ellipse", size: constant({ width: 190, height: 190 }), style: { stroke: stroke(ACCENT_LIGHT, 34) } }),
        scene.child({ ...base("s6.key.shaft", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(chamfered(-60, -18, 330, 36, 6))), style: { fill: fill(ACCENT_LIGHT) } }),
        scene.child({ ...base("s6.key.bit-0", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(chamfered(200, 10, 34, 70, 6))), style: { fill: fill(ACCENT_LIGHT) } }),
        scene.child({ ...base("s6.key.bit-1", { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(chamfered(140, 10, 28, 50, 6))), style: { fill: fill(ACCENT_LIGHT) } }),
    ];
    parts.push(scene.child({ ...base("s6.key", { outTick: END, x: 960, y: 500, rotation: -18, scale: keyed<Vec3>("s6.key.breathe", [[0, v3(0.98)], [436, v3(0.98), IN_OUT], [486, v3(1.03)]]) }), type: "group", children: keyShape }));
    // The doors: heavy plates with a chrome edge, sliding shut.
    for (const side of [-1, 1]) {
        const outline = side < 0 ? [{ x: -980, y: -560 }, { x: 0, y: -560 }, { x: 0, y: 560 }, { x: -980, y: 560 }] : [{ x: 0, y: -560 }, { x: 980, y: -560 }, { x: 980, y: 560 }, { x: 0, y: 560 }];
        const open = side * 1000;
        const slide = keyed<Vec3>(`s6.door-${side}.slide`, [[0, { x: 960 + open, y: 540, z: 0 }], [462, { x: 960 + open, y: 540, z: 0 }, SNAP], [SLAM, { x: 960, y: 540, z: 0 }], [SLAM + 3, { x: 960 - side * 6, y: 540, z: 0 }], [SLAM + 6, { x: 960, y: 540, z: 0 }]]);
        const edgeX = side * 26;
        const doorParts = [
            scene.child({ ...base(`s6.door-${side}.plate`, { outTick: END, x: 0, y: 0 }), type: "path", path: constant(shape(outline)), style: { gradientFill: linear([[0, hex("#2E333D")], [0.4, hex("#1A1D24")], [1, hex("#0E1014")]], { x: 0, y: -560 }, { x: 0, y: 560 }), stroke: stroke(BLACK, 4) } }),
            scene.child({ ...base(`s6.door-${side}.edge`, { outTick: END, x: edgeX, y: 0 }), type: "rect", size: constant({ width: 52, height: 1120 }), cornerRadius: constant(0), style: { gradientFill: linear([[0, hex("#E9EDF4")], [0.5, hex("#5B6373")], [1, hex("#C9D0DB")]], { x: -26, y: 0 }, { x: 26, y: 0 }), stroke: stroke(BLACK, 3) } }),
        ];
        for (let ry = -460; ry <= 460; ry += 115) {
            doorParts.push(scene.child({ ...base(`s6.door-${side}.rivet-${ry}`, { outTick: END, x: side * 130, y: ry }), type: "ellipse", size: constant({ width: 22, height: 22 }), style: { gradientFill: linear([[0, hex("#5B6373")], [0.5, hex("#262A33")], [1, BLACK]], { x: -7, y: -8 }, { x: 7, y: 8 }), stroke: stroke(BLACK, 2) } }));
        }
        parts.push(scene.child({ ...base(`s6.door-${side}`, { outTick: END, position: slide }), type: "group", children: doorParts }));
    }
    // Blurple light leaking through the closed seam.
    parts.push(scene.child({ ...base("s6.leak", { outTick: END, x: 960, y: 540, opacity: keyed("s6.leak.on", [[0, 0], [SLAM, 0], [SLAM + 1, 1], [SLAM + 30, 0.5]]) }), type: "rect", size: constant({ width: 4, height: 1080 }), cornerRadius: constant(0), style: { fill: fill(ACCENT_LIGHT) } }));
    // Bolts driving in along the seam.
    for (const [index, by] of [-330, -110, 110, 330].entries()) {
        const at = SLAM + 7 + index * 6;
        const bolt = [
            scene.child({ ...base(`s6.bolt-${index}.head`, { outTick: END, x: 0, y: 0 }), ...hexagon(34, 0), style: { gradientFill: chrome(CHROME, -34, 34), stroke: stroke(BLACK, 3) } }),
            scene.child({ ...base(`s6.bolt-${index}.socket`, { outTick: END, x: 0, y: 0 }), ...hexagon(14, 30), style: { fill: fill(BLACK) } }),
        ];
        parts.push(scene.child({
            ...base(`s6.bolt-${index}`, {
                outTick: END,
                x: 960,
                y: 540 + by,
                scale: keyed<Vec3>(`s6.bolt-${index}.drive`, [[0, v3(2.2)], [at, v3(2.2), SNAP], [at + 5, v3(1)]]),
                rotation: keyed<Vec3>(`s6.bolt-${index}.turn`, [[0, { x: 0, y: 0, z: -90 }], [at, { x: 0, y: 0, z: -90 }, SNAP], [at + 5, { x: 0, y: 0, z: 0 }]]),
                opacity: keyed(`s6.bolt-${index}.on`, [[0, 0], [at - 1, 0], [at, 1]]),
            }),
            type: "group",
            children: bolt,
        }));
    }
    shot("s6", [[435, 540], [560, 570]], parts, camera("s6.camera", [[0, 1], [560, 1.7]]), { x: 960, y: 540 });
}

// --- Shot 8: the end card ---

const IMPACT = 630;
{
    const parts: string[] = [];
    parts.push(scene.child({
        ...base("end.emblem", { outTick: END, x: 470, y: 520, anchor: EMBLEM_CROSSING, scale: keyed<Vec3>("end.emblem.scale", [[0, v3(1.75)], [IMPACT, v3(1.75), SLOW], [IMPACT + 40, v3(1.55)]]) }),
        type: "group",
        children: emblem(scene, "end.x", [{ start: IMPACT + 18, span: 40 }], keyed<Vec3>("end.x.turn", [[0, { x: 0, y: 0, z: 0 }], [IMPACT, { x: 0, y: 0, z: 0 }, "linear"], [END, { x: 0, y: 0, z: 30 }]])),
    }));
    shot("end", [[IMPACT, END]], parts);
    const WORD_X = 760;
    const on = (id: string) => keyed(id, [[0, 0], [IMPACT - 1, 0], [IMPACT, 1]]);
    const word = lettering(scene, "end.discord", "DISCORD", WORD_X, 380, 132, { stops: CHROME, passes: [{ start: IMPACT + 22, span: 40 }], opacity: (index) => on(`end.discord.${index}.on`) });
    const mcp = lettering(scene, "end.mcp", "MCP", WORD_X - 18, 560, 76, { stops: BLURPLE_CHROME, passes: [{ start: IMPACT + 40, span: 26 }], opacity: (index) => on(`end.mcp.${index}.on`) });
    // A machined bar after "MCP", and the pitch on its own line below.
    const barX = mcp.right + 36;
    const barW = word.right - barX;
    const barOn = keyed("end.bar.on", [[0, 0], [IMPACT + 26, 0, SLOW], [IMPACT + 46, 1]]);
    scene.add({ ...base("end.bar", { outTick: END, x: barX, y: 598, opacity: barOn }), type: "path", path: constant(shape([{ x: 0, y: -10 }, { x: barW, y: -10 }, { x: barW - 12, y: 10 }, { x: 12, y: 10 }])), style: { gradientFill: linear([[0, hex("#6A7384")], [0.5, hex("#1C2027")], [1, hex("#4A5262")]], { x: 0, y: -10 }, { x: 0, y: 10 }), stroke: stroke(BLACK, 2) } });
    const pitch = cellWordmark("ONE TOOL. YOUR CODE. THE LIVE DISCORD API.", { cell: 5.5, gap: 1, face: "3x5" });
    scene.add({ ...base("end.pitch", { outTick: END, x: WORD_X + pitch.width / 2, y: 700, opacity: keyed("end.pitch.on", [[0, 0], [IMPACT + 40, 0, SLOW], [IMPACT + 60, 1]]) }), type: "path", path: constant(pitch.path), style: { fill: fill(MICROTYPE) } });
    const url = cellWordmark("GITHUB.COM/DRVOVA/DISCORD-MCP", { cell: 6, gap: 1.2, face: "3x5" });
    scene.add({ ...base("end.url", { outTick: END, x: W / 2, y: 890, opacity: keyed("end.url.on", [[0, 0], [IMPACT + 56, 0, SLOW], [IMPACT + 76, 1]]) }), type: "path", path: constant(url.path), style: { fill: fill(ACCENT_LIGHT) } });
}

// --- Cards ---

card("card.one-tool", "ONE TOOL.", 100, 147, 76, 880);
card("card.run", "RUN", 206, 238, 124, 800, BLURPLE_CHROME);
card("card.code", "YOUR CODE. LIVE API.", 300, 343, 58, 900);
card("card.kept", "KEPT ACROSS RESTARTS", 404, 433, 56, 900);
card("card.tokens", "TOKENS NEVER LEAVE", 500, 538, 58, 900, BLURPLE_CHROME);
card("card.sealed", "ENCRYPTED AT REST", 594, 618, 70, 505);

// --- White hits: on each lock, slam, montage cut and the impact ---

const HITS = [130, LOCK, SLAM, 540, 550, 560, 570, 580, 590, IMPACT];
const hitKeys: Array<Key<number>> = [[0, 0]];
for (const tick of HITS) {
    const strength = tick === IMPACT || tick === LOCK ? 1 : 0.7;
    hitKeys.push([tick - 1, 0], [tick, strength], [tick + 3, 0]);
}
scene.add({
    ...base("hit", { outTick: END, x: CENTRE.x, y: CENTRE.y }),
    type: "rect",
    size: constant({ width: W, height: H }),
    cornerRadius: constant(0),
    style: { fill: fill(WHITE, keyed("hit.opacity", hitKeys)) },
});
// Black for the beat before the impact.
scene.add({
    ...base("black", { outTick: END, x: CENTRE.x, y: CENTRE.y, opacity: windows("black.cut", [[618, IMPACT]]) }),
    type: "rect",
    size: constant({ width: W, height: H }),
    cornerRadius: constant(0),
    style: { fill: fill(BLACK) },
});

// --- The README preview: the trailer with a chrome play badge on top ---

// `node trailer.ts --preview` adds the badge and writes trailer-preview.json,
// exported as the silent, looping SVG the README shows; the badge links to
// the player page, which plays the MP4 with sound.
const PREVIEW = process.argv.includes("--preview");
if (PREVIEW) {
    // In the design spec's language: a satin titanium bezel, a molded
    // elastomer face and an Ion Blue glyph; no pulsing (the spec asks for
    // minimal idle motion).
    const badge = { x: 1736, y: 896 };
    const R = 92;
    const ION = hex("#65B8D6");
    scene.add({ ...base("play.shadow", { outTick: END, x: badge.x + 8, y: badge.y + 12 }), type: "ellipse", size: constant({ width: R * 2 + 10, height: R * 2 + 10 }), style: { gradientFill: radial([[0, hex("#000000CC")], [0.75, hex("#00000088")], [1, hex("#00000000")]], R + 5) } });
    scene.add({ ...base("play.bezel", { outTick: END, x: badge.x, y: badge.y }), type: "ellipse", size: constant({ width: R * 2, height: R * 2 }), style: { gradientFill: linear([[0, hex("#D4DCE1")], [0.4, hex("#A6ABB1")], [1, hex("#7F858B")]], { x: 0, y: -R }, { x: 0, y: R }), stroke: stroke(hex("#4B555C"), 2) } });
    scene.add({ ...base("play.face", { outTick: END, x: badge.x, y: badge.y }), type: "ellipse", size: constant({ width: R * 2 - 30, height: R * 2 - 30 }), style: { gradientFill: linear([[0, hex("#3A3F44")], [1, hex("#25292D")]], { x: 0, y: -R }, { x: 0, y: R }), stroke: stroke(hex("#101214"), 3) } });
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
    const label = cellWordmark("PLAY WITH SOUND", { cell: 5, gap: 1, face: "3x5" });
    scene.add({ ...base("play.label", { outTick: END, x: badge.x - R - 28 - label.width / 2, y: badge.y }), type: "path", path: constant(label.path), style: { fill: fill(hex("#E4E1D8"), 0.9) } });
}

const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: "discord-mcp-trailer",
    name: "discord-mcp teaser trailer",
    canvas: { width: W, height: H, pixelAspectRatio: 1, backgroundColor: BLACK },
    timing: {
        ticksPerSecond: FPS,
        frameRate: { numerator: FPS, denominator: 1 },
        durationTicks: END,
        displayStartTick: 0,
    },
    assets: {},
    compositions: {
        main: { id: "main", name: "Trailer", width: W, height: H, durationTicks: END, nodes: scene.nodes, rootNodeIds: scene.order },
    },
    rootCompositionId: "main",
    components: {},
    markers: [
        marker("seam", 0, { name: "Light rakes the seam", durationTicks: 75 }),
        marker("bolt", 75, { name: "Bolt turns and seats", durationTicks: 75 }),
        marker("lock", 150, { name: "Blades lock into the X", durationTicks: 90 }),
        marker("schematic", 240, { name: "Schematic", durationTicks: 105 }),
        marker("helpers", 345, { name: "Helpers stack and lock", durationTicks: 90 }),
        marker("vault", 435, { name: "Doors seal the key", durationTicks: 105 }),
        marker("montage", 540, { name: "Montage, card, black", durationTicks: 90 }),
        marker("end", IMPACT, { name: "Impact and end card", durationTicks: END - IMPACT }),
    ],
    design: {
        description: "A 25-second teaser for discord-mcp, cut like a 2000s product spot: chrome hardware, a steel bunker, hard cuts and white hits.",
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
