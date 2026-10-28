# README banner

The animated banner at the top of the main README, authored with [Clayzo](https://www.npmjs.com/package/clayzo). This folder is its own project, so Clayzo's packages never become dependencies of the server.

```bash
cd assets/banner
bun install                 # or npm install
node banner.ts              # writes banner.json and validates it (no account needed)
npx clayzo login            # once per machine; rendering needs a Clayzo account
npx clayzo export banner.json ../img/banner.svg --format svg
```

- Style: the design language of 2000s performance gear rather than any product or mark: accelerating curves (two Euler-spiral blades whose bend tightens along their length), offset geometry, exposed structure (veins, hex rivets, turning hex bolts and a bolted hinge where the blades meet), machined surfaces (a chamfered plate with a bevel and engraved line, a chrome wordmark with a horizon band), and restraint (matte black, gunmetal and titanium with one blurple accent). A spine of screwed armour plates (after the era's plate-on-strap watch bands) runs along the main blade. Catalog-style microtype callouts name the three things the server does.
- Motion: long eased sweeps cut with sharp snaps. A blurple pulse runs down the spine, sheens travel along the blades (animated gradient endpoints), a specular flash crosses the wordmark letter by letter, a scan line crosses the plate inside a clip group, and the bolts turn one hex step per loop. Everything that moves starts and ends hidden or in the same place, so the 8-second loop is seamless.
- `banner.ts` is the source of truth. `banner.json` is generated and not committed.
- The banner is pure geometry (monoline and pixel wordmarks, shapes) so the animated SVG export draws it exactly. It animates with CSS only, which GitHub renders in an `<img>`.
- The SVG export can't yet trim a dashed stroke, so the dotted request track fades in instead of drawing on. If an export reports a node it can't draw exactly, it writes nothing and names the node.
- The SVG export doesn't paint the canvas colour, so the dark card is drawn as the first shape; without it the light ink disappears on GitHub's light theme.
- In CI, use a revocable `CLAYZO_TOKEN` (`npx clayzo token create "readme banner"`) instead of `login`.
