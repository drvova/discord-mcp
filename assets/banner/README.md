# README banner

The animated banner at the top of the main README, authored with [Clayzo](https://www.npmjs.com/package/clayzo). This folder is its own project, so Clayzo's packages never become dependencies of the server.

```bash
cd assets/banner
bun install                 # or npm install
node banner.ts              # writes banner.json and validates it (no account needed)
npx clayzo login            # once per machine; rendering needs a Clayzo account
npx clayzo export banner.json ../img/banner.svg --format svg
```

- Style: 2000s performance-gear design language, with no product or mark: sculpted liquid chrome (sky, hard dark horizon, ground reflection, extruded depth), an aggressive wide italic block wordmark drawn as chamfered polygons, a bold emblem of two crossed accelerating-curve blades held by a hex bolt, and a dark industrial bunker (steel plate, grooved seams, oversized domed rivets).
- Motion: a slow product reveal. Dark; a light sweeps the bunker; the emblem settles in; the wordmark is revealed behind a travelling reflection (animated gradient endpoints); a hold with one glint; back to dark. The first and last frames match, so the 8-second loop is seamless.
- `banner.ts` is the source of truth. `banner.json` is generated and not committed.
- The banner is pure geometry (polygon letters, a pixel-font microtype line, shapes) so the animated SVG export draws it exactly. It animates with CSS and SMIL (for the gradient sweeps), both of which GitHub plays in an `<img>`.
- If an export reports a node it can't draw exactly, it writes nothing and names the node.
- The SVG export doesn't paint the canvas colour, so the steel plate is drawn as the first shape; without it the light ink disappears on GitHub's light theme.
- In CI, use a revocable `CLAYZO_TOKEN` (`npx clayzo token create "readme banner"`) instead of `login`.
