# README banner and trailer

The animated banner at the top of the main README and the teaser trailer linked under it, authored with [Clayzo](https://www.npmjs.com/package/clayzo). This folder is its own project, so Clayzo's packages never become dependencies of the server. `kit.ts` holds the parts both share: the liquid chrome, the block lettering (A–Z, `.`, `-`), the crossed-blade emblem and the steel bunker.

```bash
cd assets/banner
bun install                 # or npm install
node banner.ts              # writes banner.json and validates it (no account needed)
npx clayzo login            # once per machine; rendering needs a Clayzo account
npx clayzo export banner.json ../img/banner.svg --format svg
```

The trailer (`trailer.ts`, 25 s at 1920×1080) renders to MP4; its soundtrack is synthesised by `trailer-audio.py` (Python 3 with NumPy, no samples) and muxed in with ffmpeg:

```bash
node trailer.ts             # writes trailer.json and validates it
python3 trailer-audio.py    # writes trailer.wav
npx clayzo export trailer.json trailer.mp4 --format mp4 --tier final   # slow: ~20 min on a CPU
ffmpeg -i trailer.mp4 -i trailer.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart ../video/trailer.mp4
```

The README links the video through a poster, `../img/trailer-poster.jpg` (a frame of the end card with a play badge), because GitHub doesn't play a video file from the repository inline.

- Style: 2000s performance-gear design language, with no product or mark: sculpted liquid chrome (sky, hard dark horizon, ground reflection, extruded depth), an aggressive wide italic block wordmark drawn as chamfered polygons, a bold emblem of two crossed accelerating-curve blades held by a hex bolt, and a dark industrial bunker (steel plate, grooved seams, oversized domed rivets).
- Motion: a slow product reveal. Dark; a light sweeps the bunker; the emblem settles in; the wordmark is revealed behind a travelling reflection (animated gradient endpoints); a hold with one glint; back to dark. The first and last frames match, so the 8-second loop is seamless.
- `banner.ts` is the source of truth. `banner.json` is generated and not committed.
- The banner is pure geometry (polygon letters, a pixel-font microtype line, shapes) so the animated SVG export draws it exactly. It animates with CSS and SMIL (for the gradient sweeps), both of which GitHub plays in an `<img>`.
- If an export reports a node it can't draw exactly, it writes nothing and names the node.
- The SVG export doesn't paint the canvas colour, so the steel plate is drawn as the first shape; without it the light ink disappears on GitHub's light theme.
- In CI, use a revocable `CLAYZO_TOKEN` (`npx clayzo token create "readme banner"`) instead of `login`.
