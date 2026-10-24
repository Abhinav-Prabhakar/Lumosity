# Lumosity clone

A static rebuild of Lumosity's Training Games page and My Brain LPI card, with the **real Disillusion Unity WebGL build** hosted alongside them.

- **Original stylesheet** — `styles.css` is Lumosity's compiled CSS with the Museo Sans webfonts bundled locally, so type, spacing and colors match.
- **Training Games** (`index.html`) — logo-only header (no sidebar, no top-bar controls), no lock icons, working search and category filters. Disillusion is playable; the rest open a detail sheet.
- **Disillusion** (`games/disillusion/`) — Lumosity's own Disillusion 4.21.3 Unity WebGL build, served from this repo: the same tiles, tile shapes, palette, animations, sounds, levels, tutorial and scoring as the game on app.lumosity.com. The player, its data file and every asset bundle are local; nothing is fetched from Lumosity at runtime.
- **My Brain** (`brain.html`) — the Lumosity Performance Index card: overall LPI bars per area, first/best LPI.

## Run

Open `index.html`, or serve the folder:

```
python3 -m http.server 8000
```

The game needs to be served over HTTP (it uses WebAssembly and fetch), so use the server above or GitHub Pages rather than opening the HTML file directly.

## Layout

```
index.html                     Training Games grid
brain.html                     My Brain / LPI
styles.css                     Lumosity compiled stylesheet
games/disillusion/index.html   game shell (canvas, loader, exit)
games/disillusion/unity/       Unity WebGL player (game.js/data/wasm/framework)
games/disillusion/SharedAssets/     shared Unity asset bundles
games/disillusion/unity/VersionedAssets/   scene bundle
assets/fonts/                  Museo Sans woff files
assets/games/                  game thumbnails
```

The asset-bundle folders mirror the paths the Unity build asks for: shared bundles are resolved four levels above `StreamingAssets`, and the scene bundle three levels above it, so the structure must stay as-is.

## Notes

The extracted reference material used while reverse-engineering the game lives in `.l2ref/`, which is ignored by git and not published.
