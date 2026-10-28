# README banner and trailer

The animated banner at the top of the main README and the teaser trailer under it, authored with [Clayzo](https://www.npmjs.com/package/clayzo). This folder is its own project, so Clayzo's packages never become dependencies of the server. `kit.ts` holds the parts they share: the block lettering (A–Z, `.`, `-`, in a heavy or a light cut), the trailer's liquid chrome, crossed-blade emblem and steel bunker, and the shape helpers.

```bash
cd assets/banner
bun install                 # or npm install
node banner.ts              # writes banner.json and validates it (no account needed)
npx clayzo login            # once per machine; rendering needs a Clayzo account
npx clayzo export banner.json ../img/banner.svg --format svg
```

The trailer (`trailer.ts`, 25 s at 1920×1080) is exported three ways. GitHub won't play a video in a README, so the README shows a silent, looping SVG of it with a play badge in the same titanium and elastomer as the player (`--preview`), linked to a player page. The page ([`site/`](../../site), published to GitHub Pages by `.github/workflows/pages.yml`) is a custom player built like a piece of late-90s / early-2000s kit (a brushed-titanium plate, molded-rubber controls, a mesh grille, an LCD readout and a sewn-in spec tag) that plays the video with sound: a WebM (VP9/Opus), with the MP4 (H.264/AAC) as the fallback. `trailer-audio.py` synthesises the soundtrack (Python 3 with NumPy, no samples), and ffmpeg muxes it in:

```bash
node trailer.ts --preview && npx clayzo export trailer-preview.json ../img/trailer.svg --format svg   # the README preview
node trailer.ts             # writes trailer.json and validates it
python3 trailer-audio.py    # writes trailer.wav
npx clayzo export trailer.json trailer.mp4 --format mp4 --tier final   # slow: ~20 min on a CPU
ffmpeg -i trailer.mp4 -i trailer.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart ../video/trailer.mp4
ffmpeg -i ../video/trailer.mp4 -c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -c:a libopus -b:a 128k ../video/trailer.webm
ffmpeg -ss 1.4 -i ../video/trailer.mp4 -frames:v 1 -vf scale=1280:720 -q:v 3 ../../site/poster.jpg
```

- Style: late-90s / early-2000s industrial kit and technical sportswear, following the Y2K Universal Design Spec (v3), the same language as the player page: one brushed-titanium plate with an aerodynamic nose that tapers to the right, screws only at its corners, one continuous biomorphic channel pressed into it from the nose to the module, the name engraved in a wide, upright industrial cut with an engraved spec line, and a molded-elastomer module (smoked-polymer LCD, pebble key with a status light, level columns, mesh vent). Spec palette (obsidian, graphite, titanium, chrome highlight, bone) and one accent, Ion Blue `#65B8D6`, used for state only.
- Motion: the module runs one cycle, like hardware: READY; the key sinks and its light comes on; RUN while a progress bar fills and the levels move; OK; back to READY. A soft sheen crosses the titanium once. The first and last frames match, so the 8-second loop is seamless.
- `banner.ts` is the source of truth. `banner.json` is generated and not committed.
- The banner is pure geometry (polygon letters, a pixel-font microtype line, shapes) so the animated SVG export draws it exactly. It animates with CSS and SMIL (for the gradient sweeps), both of which GitHub plays in an `<img>`.
- If an export reports a node it can't draw exactly, it writes nothing and names the node.
- The SVG export doesn't paint the canvas colour, so the graphite field is drawn as the first shape; without it the light ink disappears on GitHub's light theme.
- In CI, use a revocable `CLAYZO_TOKEN` (`npx clayzo token create "readme banner"`) instead of `login`.
