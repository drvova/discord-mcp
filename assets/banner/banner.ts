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
// - one continuous biomorphic channel pressed into the plate, from the nose
//   to the module, with faint contour lines either side;
// - obsidian and graphite around it, and one accent (Ion Blue) used for
//   state only.
// It follows the Y2K Universal Design Spec (v3): its palette tokens, one
// aerodynamic primary form with one biomorphic gesture, molded elastomer as
// the soft counter-material and smoked polymer as the one translucent detail.
// The device itself lives in device.ts, shared with the trailer, which films it.
//
// Motion is the module running one cycle, like hardware: READY; the key is
// pressed and its light comes on; RUN while a progress bar fills and the
// levels move; OK; then back to READY. A soft sheen crosses the titanium
// once. Every loop starts and ends at READY, so the 8 seconds are seamless.
//
// Only geometry, no font text, so the animated SVG export draws it exactly.

import { writeFileSync } from "node:fs";
import { ANIMATION_DOCUMENT_VERSION, assertValidAnimationDocument, base, constant, hex, marker, withComputedRevision } from "@clayzo/animation";
import { DEVICE, OBSIDIAN, device } from "./device.ts";
import { Scene, linear } from "./kit.ts";

const WIDTH = DEVICE.width;
const HEIGHT = DEVICE.height;
const FPS = 30;
const END = 8 * FPS; // 8 s loop

const scene = new Scene(END);

// The graphite field.
scene.add({
    ...base("field", { outTick: END, x: WIDTH / 2, y: HEIGHT / 2 }),
    type: "rect",
    size: constant({ width: WIDTH, height: HEIGHT }),
    cornerRadius: constant(26),
    style: { gradientFill: linear([[0, hex("#2A2E33")], [0.5, hex("#1A1D21")], [1, OBSIDIAN]], { x: 0, y: -200 }, { x: 0, y: 200 }) },
});

// The device, running one cycle: READY; the key is pressed and its light
// comes on; RUN while the progress bar fills and the levels move; OK; then
// back to READY, with one pass of light across the plate.
const PRESS = 30;
const DONE = 150;
const RESET = 210;
device(scene, (node) => scene.add(node), {
    lcd: [
        { text: "READY", from: 0, to: PRESS },
        { text: "RUN", from: PRESS, to: DONE },
        { text: "OK 0.42S", from: DONE, to: RESET },
        { text: "READY", from: RESET, to: END },
    ],
    cursor: [[PRESS, DONE]],
    progress: [{ from: PRESS + 10, to: DONE - 12, off: RESET }],
    presses: [PRESS],
    light: [[PRESS + 1, RESET]],
    levels: [{ from: PRESS, to: DONE, hold: RESET }],
    sheen: [{ start: 154, span: 64 }],
});

const document = withComputedRevision({
    version: ANIMATION_DOCUMENT_VERSION,
    id: "discord-mcp-banner",
    name: "discord-mcp README banner",
    canvas: { width: WIDTH, height: HEIGHT, pixelAspectRatio: 1, backgroundColor: OBSIDIAN },
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
