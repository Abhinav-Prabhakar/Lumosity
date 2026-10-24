# Lumosity

The real Lumosity training games, running locally — not remakes, not rebuilds, not lookalikes.
Every game in `games/` is the vendor's own Unity WebGL build, served byte-for-byte from this
repository with its player, data file and asset bundles all local.

**No account. No server. No network calls back to Lumosity.**

```
python3 -m http.server 8000     # then open http://localhost:8000
```

---

## What's here

| | |
| :--- | :--- |
| **Training Games** | `index.html` — the games grid: logo and My Brain header, working search, category filters, no lock icons. Played games show their current level and best score. |
| **Game pages** | `game/<slug>/` — a page for every playable game, modelled on `app.lumosity.com/game/<slug>`: hero, skill explainer, Play, How to Play, Game LPI, total plays, best score, level and a local leaderboard. |
| **Playable games** | One shell per game under `games/<slug>/` — a 4:3 stage, a Lumosity-style loader and an Exit button wrapped around the real build. |
| **My Brain** | `brain.html` — a live Lumosity Performance Index card with per-area bars, first/best LPI, history, training log, collections and insights, all computed from the scores saved in your browser. |
| **Results** | When a session ends, a results screen shows the score, personal best, level progress, LPI change and your top runs. Scores and levels persist between visits. |
| **Original CSS** | `styles.css` is Lumosity's compiled stylesheet with Museo Sans bundled locally, so type, spacing and colour match the product. |

## Progress, scores and LPI

There is no account and no server, but the local build keeps the parts of the
Lumosity loop that make the games feel like training rather than demos:

- **Scores are saved** after every completed session, in `localStorage` under
  `lumosity.local.v1`. The results screen confirms the save and shows your
  personal best and a local leaderboard of your top runs.
- **Levels are remembered.** The next launch passes the saved level back to the
  Unity build through `AppInterface.LoadGame`, so games resume at the level you
  reached instead of starting over. A replay of an older level never throws
  away progress.
- **My Brain is live.** Overall LPI, area LPIs, first/best LPI, history, game
  rankings and most-improved games are all derived from the same saved
  sessions. Nothing on the page is hard-coded; with no sessions it shows an
  empty state instead of a fake number.
- **The LPI is a local estimate.** Lumosity's production LPI is a proprietary
  standardised score computed by its backend. This mirror uses a transparent
  0–2000 estimate: each game score is mapped through a saturating curve using
  that game's typical score, with a floor from the highest level reached. Area
  LPI is the mean of the played games in that area; overall LPI is the mean of
  the played areas. It is consistent and useful for tracking your own progress,
  but it is not Lumosity's official number.
- **Reset when you want.** My Brain has a “Reset local data” link that clears
  scores, levels and LPI history for the browser.


## The games

**45 of Lumosity's 53 training games**, each one the real build with its own versioned payload.

### Speed

| Game | Skill | Build |
| :--- | :--- | :--- |
| **Highway Hazards** | Information Processing | Unity 4.21.4 |
| **Penguin Rally** | Spatial Orientation | Unity 4.19.2 |
| **River Ranger** | Information Processing | Unity 4.21.4 |
| **Speed Match** | Information Processing | Unity 4.24.2 |
| **Speed Pack** | Visualization | Unity 4.17.3 |
| **Splitting Seeds** | Visualization | Unity 4.20.3 |

### Memory

| Game | Skill | Build |
| :--- | :--- | :--- |
| **Cognition Kitchen** | Short-Term Memory | Unity 4.22.2 |
| **Follow That Frog** | Working Memory | Unity 4.33.2 |
| **Memory Match** | Working Memory | Unity 4.23.2 |
| **Memory Matrix** | Spatial Recall | Unity 4.22.2 |
| **Memory Serves** | Working Memory | Unity 4.22.2 |
| **Pinball Recall** | Working Memory | Unity 4.21.3 |
| **Tidal Treasures** | Short-Term Memory | Unity 4.19.2 |
| **What's My Name?** | Face-Name Recall | Unity 4.29.3 |

### Attention

| Game | Skill | Build |
| :--- | :--- | :--- |
| **Train of Thought** | Divided Attention | Unity 4.23.2 |
| **Assist Ants** | Divided Attention | Unity 4.23.2 |
| **Feel the Beat** | Timing | Unity 4.21.1 |
| **Lost in Migration** | Selective Attention | Unity 4.19.2 |
| **Playing Koi** | Divided Attention | Unity 4.20.2 |
| **Skyrise** | Field of View | Unity 4.18.2 |
| **Star Search** | Selective Attention | Unity 4.22.3 |
| **Trouble Brewing** | Divided Attention | Unity 4.21.2 |

### Flexibility

| Game | Skill | Build |
| :--- | :--- | :--- |
| **Disillusion** | Task Switching | Unity 4.21.3 |
| **Space Trace** | Spatial Fluency | Unity 4.19.3 |
| **Brain Shift** | Task Switching | Unity 4.23.2 |
| **Color Match** | Response Inhibition | Unity 4.21.2 |
| **Ebb and Flow** | Task Switching | Unity 4.21.2 |

### Reasoning

| Game | Skill | Build |
| :--- | :--- | :--- |
| **Fuse Clues** | Logical Reasoning | Unity 4.21.2 |
| **Masterpiece** | Spatial Reasoning | Unity 4.21.3 |
| **Organic Order** | Logical Reasoning | Unity 4.21.3 |
| **Pet Detective** | Planning | Unity 4.21.3 |
| **Pirate Passage** | Planning | Unity 4.21.2 |
| **Ruled Out** | Logical Reasoning | Unity 4.41.2 |
| **Speedoku** | Logical Reasoning | Unity 4.26.2 |

### Math

| Game | Skill | Build |
| :--- | :--- | :--- |
| **Chalkboard Challenge** | Numerical Estimation | Unity 4.21.3 |
| **Halve Your Cake** | Proportional Reasoning | Unity 4.19.2 |
| **Magic Chance** | Probabilistic Reasoning | Unity 4.20.2 |
| **Raindrops** | Arithmetic | Unity 4.22.1 |
| **Top That** | Numerical Estimation | Unity 4.21.4 |

### Language

| Game | Skill | Build |
| :--- | :--- | :--- |
| **Contextual** | Reading Comprehension | Unity 4.21.2 |
| **Continuum** | Vocabulary | Unity 4.21.2 |
| **Editor's Choice** | Vocabulary | Unity 4.21.2 |
| **Taking Root** | Vocabulary | Unity 4.19.3 |
| **Word Bubbles** | Verbal Fluency | Unity 4.25.2 |
| **Word Snatchers** | Vocabulary | Unity 4.19.4 |

<details>
<summary><strong>The 8 not included</strong></summary>

**Brain Shift Overdrive**, **Eagle Eye**, **Familiar Faces**, **Memory Match Overdrive**, **Robot Factory**, **Rotation Matrix**, **Spatial Speed Match**, **Speed Match Overdrive** are Cocos Creator builds rather than Unity builds. Their launch scene loads, but the
main gameplay scene (`WebScene`) returns `403 Access Denied` from Lumosity's asset host for every
one of them — the payload is not publicly retrievable, so they cannot be mirrored faithfully.
They still appear on the Training Games page, greyed out and marked **Under construction**, and
are not clickable.

</details>

## How it works

Lumosity ships each game as a standard Unity WebGL build. The interesting part is that the
build is *path-sensitive*, so hosting it means reproducing its directory contract exactly.

### 1. The build owns its own asset paths

A Unity WebGL player is four files plus a manifest:

```
game.js                 loader
game.framework.js       engine glue
game.data               initial scene + metadata
game.wasm               compiled runtime
StreamingAssets/runtime_manifest.json
```

That manifest names the asset bundles — shared ones and per-game scenes — by **content hash**.
The build resolves them relative to `streamingAssetsUrl`, which means the number of directories
between the page and the manifest is load-bearing:

```
games/<slug>/index.html
└── unity/
    ├── game.js, game.data, game.wasm, game.framework.js
    ├── rel/<version>/StreamingAssets/runtime_manifest.json
    └── VersionedAssets/<name>/<hash>/<name>.bundle     ← 3 levels above StreamingAssets
games/<slug>/SharedAssets/<name>/<hash>/<name>.bundle  ← 4 levels above StreamingAssets
```

Get that depth wrong and the game boots to a black canvas. Get it right and it is byte-identical
to the game on app.lumosity.com: same art, same animations, same sounds, same levels, same scoring.

Three builds also pull per-round data on demand from a `dynamic` source that no manifest
enumerates — Word Bubbles' 678 word lists, What's My Name's 444 face bundles. Those file names are
recoverable from the builds' own string tables and data files, so the mirror walks them and stores
the complete set rather than only the handful any one play session happens to touch.

### 2. Brotli is decompressed in the browser

Unity stores its payload brotli-compressed, but a static host will not send
`Content-Encoding: br` for a `.br` file — and `WebAssembly.instantiate` needs the raw bytes.
So the repository keeps only the compressed files and decompresses them on the way out:

- `sw.js` is a module service worker that intercepts `.wasm`, `.data`, `.bundle` and
  `.framework.js` requests under `/games/`, fetches the matching `.br` file, and runs it through a
  vendored 208 KB brotli decoder compiled to WebAssembly (`vendor/brotli/`).
- A missing `.br` falls straight through to the original path, so an uncompressed tree still works.
- Wrapper pages wait for `navigator.serviceWorker.ready` before starting the player, so the first
  request is already intercepted — no reload, no race.

That is the difference between roughly 5 GB of game data and 839 MB, which is what makes archiving
the whole catalogue practical. It also means the site works from any plain static file server,
including `python3 -m http.server`.

### 3. The shell and the local account layer are the only things that are ours

Each `games/<slug>/index.html` is generated, not vendored. It provides the stage, the loader, the
Exit link, the results overlay, and the single host hook the build expects
(`AppInterface.LoadGame`) — then hands the canvas to the real player. Everything inside the canvas
is Lumosity's.

`l2.js` is the small local account layer around those builds. It converts the Unity events
(`onSessionStarted`, `onSessionEnded`, `onGameExited`) into saved sessions, remembers the highest
unlocked level, builds the `player_state` the next launch needs, computes the local LPI, and renders
the results screen. The pages under `game/<slug>/`, `brain.html` and the Training Games grid all read
the same store, so a score saved in a game immediately shows up in My Brain and on that game's page.

## Run it

```bash
git clone https://github.com/Abhinav-Prabhakar/Lumosity.git
cd Lumosity
python3 -m http.server 8000
```

Open <http://localhost:8000>. A server is required — the games use WebAssembly, `fetch` and a
service worker, none of which work from a `file://` URL.

## Layout

```
index.html                    Training Games grid
game/<slug>/index.html        Game detail page (hero, Play, local stats, leaderboard)
brain.html                    My Brain / Lumosity Performance Index
l2.js                         Local account layer: saves, levels, LPI, results
l2-games.js                   Game metadata and skill descriptions
l2.css                        Shared styles for the detail, results and My Brain UI
styles.css                    Lumosity's compiled stylesheet
sw.js                         brotli service worker
vendor/brotli/                brotli decoder (WASM)
assets/                       fonts, icons, game thumbnails and hero art
games/<slug>/index.html       generated game shell
games/<slug>/unity/           Unity player + scene bundles (.br)
games/<slug>/SharedAssets/    shared Unity asset bundles (.br)
```

## Notes

- Everything is a static file. There is no build step and no dependency to install.
- Progress lives in the browser's `localStorage` (`lumosity.local.v1`). Clearing site data resets
  scores, levels and LPI. There is no account and no network sync.
- The game-detail pages are generated from `index.html`'s game table and `.l2ref/catalog.json`; the
  checked-in files under `game/<slug>/` are all static.
- The checkout is 839 MB, which sits just under GitHub Pages' 1 GB site limit. If the hosted copy
  ever gets rejected, clone the repo and serve it locally instead — the site is identical.
- Reference material gathered while reverse-engineering the layout lives in `.l2ref/`, which is
  ignored by git and never published.

## Legal

Lumosity, the Lumosity name, and all game builds, artwork, audio and other assets here are the
property of Lumosity (Lumos Labs, Inc.). This repository is a personal archive for offline study
and preservation. It is not affiliated with, endorsed by, or distributed by Lumosity. If you are a
rights holder and want something removed, open an issue and it will be taken down.
