# Lumosity clone

A static rebuild of Lumosity's Training Games page, plus a playable Disillusion and a My Brain LPI card.

- **Original stylesheet** — `styles.css` is Lumosity's compiled CSS with the Museo Sans webfonts bundled locally, so type, spacing and colors match.
- **Training Games** (`index.html`) — logo-only header (no sidebar, no top-bar controls), no lock icons, working search and category filters. Disillusion is playable; the rest open a detail sheet.
- **Disillusion** (`games/disillusion/`) — the real rule set, per Lumosity's instructions: you place the held tile into a gap in the mosaic. A **Tall** tile must match the **color** of every tile it touches; a **Wide** tile must match the **symbol**; the tile must also physically interlock with the gap; a wrong drop locks that space for 3 seconds. A level is 4 boards, and the milestones are 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72. Includes the 60-second timer, 1,000 per placed tile, time bonus, level unlocks, pause, how-to-play, Zen mode, synthesized sound and animated tiles.
- **My Brain** (`brain.html`) — the Lumosity Performance Index card: overall LPI bars per area, first/best LPI.

## Run

Open `index.html`, or serve the folder:

```
python3 -m http.server 8000
```

## Layout

```
index.html                 Training Games grid
brain.html                 My Brain / LPI
styles.css                 Lumosity compiled stylesheet
games/disillusion/         game shell, styles and engine
assets/fonts/              Museo Sans woff files
assets/games/              game thumbnails
```

Progress (unlocked levels, best scores, sound preference) is stored in `localStorage`.
