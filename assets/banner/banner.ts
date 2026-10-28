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
//   chamfered corners, drawn as polygons (no font);
// - a bold emblem: two crossed accelerating-curve blades in chrome, held by
//   a hex bolt;
// - a dark industrial bunker: heavy steel plates, grooved seams and
//   oversized domed rivets.
// The parts live in kit.ts, shared with the trailer.
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
    type Vec3,
} from "@clayzo/animation";
import {
    BLACK,
    BLURPLE_CHROME,
    CHROME,
    EMBLEM_CROSSING,
    IN_OUT,
    MICROTYPE,
    SLOW,
    Scene,
    chamfered,
    emblem,
    lettering,
    linear,
    pts,
    radial,
    rivet,
    seam,
    shape,
    sheenBand,
    steelPlate,
    type Pass,
} from "./kit.ts";

const WIDTH = 1280;
const HEIGHT = 400;
const FPS = 30;
const END = 8 * FPS; // 8 s loop

const scene = new Scene(END);
// In, then hold, then back out before the loop point.
const reveal = (at: number, length = 16) => keyed(`reveal.${at}.${length}.${scene.order.length}`, [[0, 0], [at, 0, SLOW], [at + length, 1], [204, 1, IN_OUT], [232, 0]]);

// --- The bunker ---

const plateOutline = chamfered(0, 0, WIDTH, HEIGHT, 26);
steelPlate(scene, "plate", plateOutline, 0, HEIGHT);
for (const [index, x] of [180, 620, 1010].entries()) {
    sheenBand(scene, `plate.sheen-${index}`, x, HEIGHT);
}
const SEAM_TOP = 46;
const SEAM_BOTTOM = HEIGHT - 46;
const BAY = 368;
seam(scene, "seam.top", { x: 0, y: SEAM_TOP }, { x: WIDTH, y: SEAM_TOP });
seam(scene, "seam.bottom", { x: 0, y: SEAM_BOTTOM }, { x: WIDTH, y: SEAM_BOTTOM });
seam(scene, "seam.bay", { x: BAY, y: SEAM_TOP }, { x: BAY, y: SEAM_BOTTOM });
for (let x = 40; x < WIDTH; x += 80) {
    rivet(scene, `rivet.top-${x}`, x, SEAM_TOP / 2);
    rivet(scene, `rivet.bottom-${x}`, x, HEIGHT - SEAM_TOP / 2);
}
for (const y of [SEAM_TOP + 34, SEAM_BOTTOM - 34]) {
    rivet(scene, `rivet.bay-${y}`, BAY + 18, y);
}

// --- The light: a soft glow sweeps the bunker as the scene comes up ---

scene.add({
    ...base("light", {
        outTick: END,
        position: keyed<Vec3>("light.position", [[0, { x: -300, y: 170, z: 0 }], [8, { x: -300, y: 170, z: 0 }, SLOW], [96, { x: 1500, y: 170, z: 0 }]]),
    }),
    type: "ellipse",
    size: constant({ width: 760, height: 520 }),
    style: { gradientFill: radial([[0, hex("#C9D2E633")], [0.45, hex("#8E9AB514")], [1, hex("#8E9AB500")]], 380) },
});

// --- Darkness: the scene starts and ends unlit ---

scene.add({
    ...base("dark", { outTick: END, x: 0, y: 0 }),
    type: "path",
    path: constant(shape(plateOutline)),
    style: { fill: fill(BLACK, keyed("dark.opacity", [[0, 0.72], [8, 0.72, SLOW], [70, 0], [200, 0, IN_OUT], [234, 0.72]])) },
});

// --- The emblem settles in: from slightly large and unlit to its place ---

scene.add({
    ...base("emblem", {
        outTick: END,
        x: BAY / 2,
        y: HEIGHT / 2,
        anchor: EMBLEM_CROSSING,
        scale: keyed<Vec3>("emblem.scale", [[0, { x: 1.12, y: 1.12, z: 1 }], [14, { x: 1.12, y: 1.12, z: 1 }, SLOW], [74, { x: 1, y: 1, z: 1 }], [200, { x: 1, y: 1, z: 1 }, IN_OUT], [236, { x: 1.06, y: 1.06, z: 1 }], [END, { x: 1.12, y: 1.12, z: 1 }]]),
        opacity: keyed("emblem.opacity", [[0, 0], [14, 0, SLOW], [58, 1], [204, 1, IN_OUT], [234, 0]]),
    }),
    type: "group",
    children: emblem(scene, "emblem", [{ start: 26, span: 44 }, { start: 168, span: 30 }]),
});

// --- The wordmark, revealed letter by letter as the reflection reaches it ---

const line = (id: string, text: string, x: number, y: number, H: number, stops: typeof CHROME, passes: Pass[]) =>
    lettering(scene, id, text, x, y, H, {
        stops,
        passes,
        opacity: (index, along) => {
            const at = passes[0].start + Math.round(along * passes[0].span * 0.8);
            return keyed(`${id}.${index}.opacity`, [[0, 0], [at, 0, SLOW], [at + 16, 1], [204, 1, IN_OUT], [232, 0]]);
        },
    });
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
scene.add({
    ...base("bar", { outTick: END, x: BAR_X, y: BAR_Y, opacity: reveal(96, 22) }),
    type: "path",
    path: constant(shape(pts(0, -7, 560, -7, 552, 7, 8, 7))),
    style: { gradientFill: linear([[0, hex("#6A7384")], [0.5, hex("#1C2027")], [1, hex("#4A5262")]], { x: 0, y: -7 }, { x: 0, y: 7 }), stroke: stroke(BLACK, 1.5) },
});
const pitch = cellWordmark("ONE TOOL. RUNS YOUR CODE. TOKENS STAY IN THE AGENT.", { cell: 2.5, gap: 0.5, face: "3x5" });
scene.add({
    ...base("pitch", { outTick: END, x: BAR_X + 24 + pitch.width / 2, y: BAR_Y + 26, opacity: reveal(104, 22) }),
    type: "path",
    path: constant(pitch.path),
    style: { fill: fill(MICROTYPE) },
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
        main: { id: "main", name: "Banner", width: WIDTH, height: HEIGHT, durationTicks: END, nodes: scene.nodes, rootNodeIds: scene.order },
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
console.log(`banner.json: ${Object.keys(scene.nodes).length} nodes, ${END} ticks at ${FPS} fps, revision ${document.revision}`);
