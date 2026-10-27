# README banner

The animated banner at the top of the main README, authored with [Clayzo](https://www.npmjs.com/package/clayzo). This folder is its own project, so Clayzo's packages never become dependencies of the server.

```bash
cd assets/banner
bun install                 # or npm install
node banner.ts              # writes banner.json and validates it (no account needed)
npx clayzo login            # once per machine; rendering needs a Clayzo account
npx clayzo export banner.json ../img/banner.svg --format svg
```

- Style: Y2K retrofuturism (liquid-chrome lettering, sparkles, an orbit ring, iridescent ice, lilac and silver), biomorphic forms (soft glows inside morphing contours) and technical sportswear (ripstop grid, stitched seam, registration marks, spec-label microtype, a volt pull-tab).
- `banner.ts` is the source of truth. `banner.json` is generated and not committed.
- The banner is pure geometry (monoline and pixel wordmarks, shapes) so the animated SVG export draws it exactly. It animates with CSS only, which GitHub renders in an `<img>`.
- The SVG export can't yet trim a dashed stroke, so the dotted request track fades in instead of drawing on. If an export reports a node it can't draw exactly, it writes nothing and names the node.
- The SVG export doesn't paint the canvas colour, so the dark card is drawn as the first shape; without it the light ink disappears on GitHub's light theme.
- In CI, use a revocable `CLAYZO_TOKEN` (`npx clayzo token create "readme banner"`) instead of `login`.
