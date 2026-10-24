/*
 * l2.js — the local "account" layer for the static Lumosity mirror.
 *
 * The games are Lumosity's own Unity builds. Everything the real web app would
 * normally do around them (save a score, remember a level, compute an LPI,
 * show a results screen, build the My Brain page) lives here instead, backed by
 * localStorage. It is intentionally dependency-free and works from any static
 * host, including GitHub Pages.
 */

import { AREAS, GAMES, GAME_SLUGS, getGame, getSkill } from "./l2-games.js";

const KEY = "lumosity.local.v1";
const MAX_SESSIONS = 600;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function formatDate(timestamp) {
  if (!timestamp) return "—";
  const d = new Date(Number(timestamp));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatShortDate(timestamp) {
  if (!timestamp) return "—";
  const d = new Date(Number(timestamp));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatRelative(timestamp) {
  if (!timestamp) return "never";
  const diff = Date.now() - Number(timestamp);
  if (!Number.isFinite(diff) || diff < 0) return formatDate(timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return formatDate(timestamp);
}

export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const secs = Math.round(n / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rest = secs % 60;
  return rest ? `${mins}m ${rest}s` : `${mins}m`;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function round(n) {
  return Math.round(Number(n) || 0);
}

function parseMaybeJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

function blankStore() {
  return {
    version: 1,
    createdAt: Date.now(),
    profile: { firstName: "You" },
    settings: { music: true, sfx: true },
    sessions: [],
    games: {},
    lpiHistory: [],
  };
}

let cache = null;

// Another tab may save a score or reset the data while this page is open.
// Drop the in-memory copy so the next read/write uses the current store.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) cache = null;
  });
}

function normalizeStore(raw) {
  const store = blankStore();
  if (!raw || typeof raw !== "object") return store;
  store.version = 1;
  store.createdAt = Number(raw.createdAt) || Date.now();
  store.profile = { ...store.profile, ...(raw.profile || {}) };
  store.settings = { ...store.settings, ...(raw.settings || {}) };
  store.sessions = Array.isArray(raw.sessions) ? raw.sessions.filter(Boolean) : [];
  store.games = raw.games && typeof raw.games === "object" ? raw.games : {};
  store.lpiHistory = Array.isArray(raw.lpiHistory) ? raw.lpiHistory.filter(Boolean) : [];

  // Repair per-game records from older or hand-edited data.
  for (const [slug, stat] of Object.entries(store.games)) {
    if (!stat || typeof stat !== "object") {
      delete store.games[slug];
      continue;
    }
    stat.plays = Math.max(0, Number(stat.plays) || 0);
    stat.bestScore = Math.max(0, Number(stat.bestScore) || 0);
    stat.bestStat = Math.max(0, Number(stat.bestStat) || 0);
    stat.bestLevel = Math.max(0, Number(stat.bestLevel) || 0);
    stat.levelNext = Math.max(0, Number(stat.levelNext) || 0);
    stat.levelPrevious = Math.max(0, Number(stat.levelPrevious) || 0);
    stat.scoreHistory = Array.isArray(stat.scoreHistory) ? stat.scoreHistory.filter(Boolean) : [];
    stat.tutorialDone = Boolean(stat.tutorialDone);
  }
  return store;
}

export function loadStore() {
  if (cache) return cache;
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    raw = null;
  }
  cache = normalizeStore(raw);
  // Keep first/best LPI meaningful if an old store had games but no history.
  if (!cache.lpiHistory.length) {
    const lpi = computeLpi(cache);
    if (lpi.overall > 0) {
      cache.lpiHistory.push({
        t: Number(cache.sessions[0]?.t) || Date.now(),
        overall: lpi.overall,
        areas: lpi.areas,
        seeded: true,
      });
      persist();
    }
  }
  return cache;
}

function persist() {
  if (!cache) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage can be unavailable in private mode. The in-memory store still
    // works for the current page, so the UI never breaks.
  }
  try {
    window.dispatchEvent(new CustomEvent("l2:store", { detail: { store: cache } }));
  } catch {
    /* not in a browser */
  }
}

export function saveStore() {
  persist();
}

export function resetStore() {
  cache = blankStore();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  persist();
  return cache;
}

export function getSettings() {
  return loadStore().settings;
}

export function updateSettings(patch) {
  const store = loadStore();
  store.settings = { ...store.settings, ...(patch || {}) };
  persist();
  return store.settings;
}

/* ------------------------------------------------------------------ *
 * LPI model
 *
 * Lumosity's production LPI is a proprietary standardised score. This mirror
 * cannot call that service, so it uses a transparent local estimate on the
 * same 0–2000 scale:
 *
 *   game LPI = 400 + 1600 * (1 - e^(-bestScore / par))
 *   ...raised to a floor from the highest level reached.
 *   area LPI = mean of the game LPIs played in that area.
 *   overall  = mean of the area LPIs that have been played.
 *
 * Each game's `par` is the score an average adult typically reaches in a
 * session. It makes the curve comparable across games whose scores are in
 * completely different units (30 matches vs 46,000 points).
 * ------------------------------------------------------------------ */

export function gameLpiFromStats(stat, slug) {
  if (!stat || !stat.plays) return 0;
  const meta = getGame(slug);
  const par = Math.max(1, Number(meta?.par) || 1500);
  const score = Math.max(0, Number(stat.bestScore) || 0, Number(stat.bestStat) || 0);
  const scoreLpi = 400 + 1600 * (1 - Math.exp(-score / par));
  const levelLpi = stat.bestLevel ? 600 + (Number(stat.bestLevel) - 1) * 10 : 0;
  return clamp(round(Math.max(scoreLpi, levelLpi)), 200, 2000);
}

export function computeLpi(store = loadStore()) {
  const areaTotals = Object.fromEntries(AREAS.map((area) => [area, { sum: 0, n: 0 }]));
  const gameLpis = {};

  for (const [slug, stat] of Object.entries(store.games || {})) {
    if (!stat || !stat.plays) continue;
    const meta = getGame(slug);
    if (!meta) continue;
    const lpi = gameLpiFromStats(stat, slug);
    if (!lpi) continue;
    gameLpis[slug] = lpi;
    const bucket = areaTotals[meta.area];
    if (bucket) {
      bucket.sum += lpi;
      bucket.n += 1;
    }
  }

  const areas = {};
  for (const area of AREAS) {
    areas[area] = areaTotals[area].n ? round(areaTotals[area].sum / areaTotals[area].n) : 0;
  }
  const playedAreas = AREAS.map((area) => areas[area]).filter((v) => v > 0);
  const overall = playedAreas.length
    ? round(playedAreas.reduce((a, b) => a + b, 0) / playedAreas.length)
    : 0;

  return { overall, areas, gameLpis };
}

export function getLpi() {
  const store = loadStore();
  const current = computeLpi(store);
  const history = store.lpiHistory || [];
  const first = history.length ? Number(history[0].overall) || 0 : current.overall;
  const best = history.length
    ? Math.max(current.overall, ...history.map((h) => Number(h.overall) || 0))
    : current.overall;
  const last = history.length ? Number(history[history.length - 1].overall) || 0 : current.overall;
  const previous = history.length > 1 ? Number(history[history.length - 2].overall) || 0 : 0;
  return {
    overall: current.overall,
    areas: current.areas,
    gameLpis: current.gameLpis,
    first,
    best,
    last,
    change: history.length > 1 ? last - previous : current.overall,
    history,
  };
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

function pickNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function firstNonZero(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

function sessionIdentity(slug, play, payload) {
  return (
    play.guid ||
    payload.guid ||
    play.session_id ||
    payload.session_id ||
    (play.time_start ? `${slug}:${play.time_start}` : "") ||
    `${slug}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  );
}

/**
 * Save one finished session.
 *
 * @param {string} slug
 * @param {object|string} rawPayload the JSON from onSessionEnded / onGameExited
 * @param {{final?: boolean}} [opts] final=true for onSessionEnded (assume complete)
 * @returns {object} a summary used by the results screen
 */
export function recordSession(slug, rawPayload, opts = {}) {
  const store = loadStore();
  const meta = getGame(slug);
  const payload = parseMaybeJson(rawPayload);
  if (!payload || !meta) return { saved: false, reason: "invalid" };

  const play = payload.play_data || payload.game_result_data?.play_data || {};
  const app = payload.app_data || payload.game_result_data?.app_data || {};
  const player = payload.player_state || {};

  const explicitlyIncomplete = app.complete === false || play.complete === false;
  const complete =
    !explicitlyIncomplete &&
    (opts.final === true || app.complete === true || play.complete === true);
  if (!complete) {
    return { saved: false, reason: "incomplete", score: pickNumber(app.score, play.score), slug };
  }

  const identity = sessionIdentity(slug, play, payload);
  const existing = store.sessions.find((s) => s.id === identity);
  if (existing) {
    return { ...summarizeExisting(existing, slug), saved: false, duplicate: true };
  }

  const score = Math.max(
    pickNumber(app.score),
    pickNumber(play.score),
    pickNumber(payload.score)
  );
  const stat = Math.max(pickNumber(app.stat), pickNumber(play.stat));
  const level = firstNonZero(
    pickNumber(play.level_selected),
    pickNumber(app.level_selected),
    pickNumber(player.level_next)
  );
  const levelNextRaw = firstNonZero(
    pickNumber(player.level_next),
    pickNumber(play.level_next),
    pickNumber(app.level_next)
  );
  const levelPrevious = firstNonZero(
    pickNumber(play.level_previous),
    pickNumber(app.level_previous)
  );
  const duration = Math.max(
    pickNumber(play.duration),
    pickNumber(app.duration),
    pickNumber(play.duration_active),
    pickNumber(app.duration_active)
  );
  const ts = Date.now();

  const before = computeLpi(store);
  const areaBefore = before.areas[meta.area] || 0;

  const g = store.games[slug] || {
    plays: 0,
    bestScore: 0,
    bestStat: 0,
    bestLevel: 0,
    levelNext: 0,
    levelPrevious: 0,
    firstPlayed: ts,
    lastPlayed: 0,
    tutorialDone: false,
    scoreHistory: [],
  };

  const previousBest = Number(g.bestScore) || 0;
  g.plays = (Number(g.plays) || 0) + 1;
  g.bestScore = Math.max(Number(g.bestScore) || 0, score);
  g.bestStat = Math.max(Number(g.bestStat) || 0, stat);
  g.bestLevel = Math.max(Number(g.bestLevel) || 0, level);
  // The highest unlocked level only moves forward. A replay of an old level
  // must not throw away progress. If a build does not report a level at all,
  // leave it at zero so the game keeps its own default.
  const unlocked = Math.max(level, levelNextRaw);
  if (unlocked > 0) {
    g.levelNext = Math.max(Number(g.levelNext) || 0, unlocked);
    g.levelPrevious = Math.max(0, g.levelNext - 1);
  }
  g.firstPlayed = Number(g.firstPlayed) || ts;
  g.lastPlayed = ts;
  g.tutorialDone = true;
  g.scoreHistory = Array.isArray(g.scoreHistory) ? g.scoreHistory : [];
  g.scoreHistory.push({
    t: ts,
    score,
    stat,
    level,
    levelNext: levelNextRaw,
    lpi: gameLpiFromStats(
      { plays: 1, bestScore: score, bestStat: stat, bestLevel: level },
      slug
    ),
  });
  if (g.scoreHistory.length > 60) g.scoreHistory.splice(0, g.scoreHistory.length - 60);

  store.games[slug] = g;
  store.profile.firstName = store.profile.firstName || "You";

  const session = {
    id: identity,
    slug,
    name: meta.name,
    area: meta.area,
    skill: meta.skill,
    score,
    stat,
    level,
    levelNext: levelNextRaw,
    levelPrevious,
    duration,
    complete: true,
    t: ts,
    mode: play.game_mode || app.game_mode || "default",
  };
  store.sessions.push(session);
  if (store.sessions.length > MAX_SESSIONS) {
    store.sessions.splice(0, store.sessions.length - MAX_SESSIONS);
  }

  const after = computeLpi(store);
  store.lpiHistory.push({
    t: ts,
    overall: after.overall,
    areas: after.areas,
    slug,
    score,
  });
  if (store.lpiHistory.length > 300) {
    store.lpiHistory.splice(0, store.lpiHistory.length - 300);
  }

  persist();

  const leaderboard = getLeaderboard(slug, 5);
  const rank = leaderboard.findIndex((row) => row.id === identity) + 1;
  const areaAfter = after.areas[meta.area] || 0;

  return {
    saved: true,
    duplicate: false,
    slug,
    name: meta.name,
    area: meta.area,
    skill: meta.skill,
    score,
    stat,
    level,
    levelNext: g.levelNext,
    duration,
    plays: g.plays,
    bestScore: g.bestScore,
    previousBest,
    isPB: score > previousBest,
    scoreDelta: score - previousBest,
    gameLpi: gameLpiFromStats(g, slug),
    lpiBefore: before.overall,
    lpiAfter: after.overall,
    lpiChange: after.overall - before.overall,
    areaBefore,
    areaAfter,
    areaChange: areaAfter - areaBefore,
    leaderboard,
    rank,
    session,
  };
}

function summarizeExisting(session, slug) {
  const store = loadStore();
  const g = store.games[slug] || {};
  const lpi = computeLpi(store);
  return {
    slug,
    name: session.name,
    score: session.score,
    stat: session.stat,
    level: session.level,
    levelNext: g.levelNext || session.levelNext || session.level,
    bestScore: g.bestScore || session.score,
    plays: g.plays || 1,
    lpiAfter: lpi.overall,
    areas: lpi.areas,
    leaderboard: getLeaderboard(slug, 5),
  };
}

/* ------------------------------------------------------------------ *
 * Queries used by the pages
 * ------------------------------------------------------------------ */

export function getGameStats(slug) {
  const store = loadStore();
  const stat = store.games[slug] || null;
  const lpi = gameLpiFromStats(stat, slug);
  return {
    slug,
    plays: Number(stat?.plays) || 0,
    bestScore: Number(stat?.bestScore) || 0,
    bestStat: Number(stat?.bestStat) || 0,
    bestLevel: Number(stat?.bestLevel) || 0,
    levelNext: Number(stat?.levelNext) || 0,
    levelPrevious: Number(stat?.levelPrevious) || 0,
    lastPlayed: Number(stat?.lastPlayed) || 0,
    firstPlayed: Number(stat?.firstPlayed) || 0,
    tutorialDone: Boolean(stat?.tutorialDone),
    lpi,
  };
}

export function getAllGameStats() {
  return GAME_SLUGS.map((slug) => ({ ...GAMES[slug], slug, ...getGameStats(slug) }));
}

export function getSessions(slug = null, limit = 20) {
  const store = loadStore();
  const rows = slug
    ? store.sessions.filter((s) => s.slug === slug)
    : store.sessions.slice();
  return rows
    .sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0))
    .slice(0, limit);
}

export function getLeaderboard(slug, limit = 5) {
  return getSessions(slug, 200)
    .sort((a, b) => {
      const diff = (Number(b.score) || 0) - (Number(a.score) || 0);
      if (diff) return diff;
      return (Number(b.t) || 0) - (Number(a.t) || 0);
    })
    .slice(0, limit)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

export function getTotals() {
  const store = loadStore();
  const sessions = store.sessions || [];
  const totals = {
    sessions: sessions.length,
    games: Object.values(store.games).filter((g) => g.plays > 0).length,
    totalPoints: sessions.reduce((sum, s) => sum + (Number(s.score) || 0), 0),
    totalDuration: sessions.reduce((sum, s) => sum + (Number(s.duration) || 0), 0),
    firstPlayed: 0,
    lastPlayed: 0,
    streak: 0,
    activeDays: 0,
    areaCounts: Object.fromEntries(AREAS.map((a) => [a, 0])),
  };

  const days = new Set();
  for (const s of sessions) {
    const t = Number(s.t) || 0;
    if (t) {
      if (!totals.firstPlayed || t < totals.firstPlayed) totals.firstPlayed = t;
      if (t > totals.lastPlayed) totals.lastPlayed = t;
      const d = new Date(t);
      days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    if (s.area) totals.areaCounts[s.area] = (totals.areaCounts[s.area] || 0) + 1;
  }
  totals.activeDays = days.size;

  // A day streak that is still alive if the last session was today or yesterday.
  if (days.size) {
    const cursor = new Date();
    const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!days.has(key(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
      if (!days.has(key(cursor))) {
        totals.streak = 0;
      }
    }
    if (days.has(key(cursor))) {
      while (days.has(key(cursor))) {
        totals.streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
    }
  }

  return totals;
}

export function getGameRankings() {
  const rows = getAllGameStats()
    .filter((g) => g.plays > 0)
    .sort((a, b) => b.lpi - a.lpi || b.plays - a.plays || b.bestScore - a.bestScore);
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function getMostImproved() {
  const rows = [];
  for (const slug of GAME_SLUGS) {
    const stat = loadStore().games[slug];
    if (!stat || !stat.scoreHistory || stat.scoreHistory.length < 2) continue;
    const first = stat.scoreHistory[0];
    const last = stat.scoreHistory[stat.scoreHistory.length - 1];
    const delta = (Number(last.lpi) || 0) - (Number(first.lpi) || 0);
    if (!delta) continue;
    rows.push({
      slug,
      ...GAMES[slug],
      delta,
      firstLpi: Number(first.lpi) || 0,
      lastLpi: Number(last.lpi) || 0,
      plays: stat.plays,
    });
  }
  return rows.sort((a, b) => b.delta - a.delta);
}

/* ------------------------------------------------------------------ *
 * Launch parameters
 * ------------------------------------------------------------------ */

export function buildLaunchParams(slug) {
  const store = loadStore();
  const stat = store.games[slug] || {};
  const zen = new URLSearchParams(window.location.search).get("zen") === "1";
  const levelNext = Math.max(0, Number(stat.levelNext) || 0);
  return {
    player_state: {
      level_previous: levelNext > 0 ? levelNext - 1 : 0,
      level_next: levelNext,
    },
    player_first_name: store.profile.firstName || "You",
    debug_mode: false,
    game_mode: zen ? "noTimePressure" : "default",
    show_tutorial: !stat.tutorialDone,
    how_to_play: false,
    app_music: store.settings.music !== false,
    app_sfx: store.settings.sfx !== false,
    language_variant: "en",
  };
}

/* ------------------------------------------------------------------ *
 * Results overlay for the game shell
 * ------------------------------------------------------------------ */

function injectResultsStyles() {
  if (document.getElementById("l2-results-styles")) return;
  const style = document.createElement("style");
  style.id = "l2-results-styles";
  style.textContent = `
    .l2-results{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-start;justify-content:center;
      padding:clamp(18px,6vh,72px) 24px;overflow:auto;overscroll-behavior:contain;background:rgba(6,26,32,.82);backdrop-filter:blur(10px);
      font-family:"MuseoSans","Helvetica Neue",Arial,sans-serif;color:#0c1f31}
    .l2-results[hidden]{display:none}
    .l2-results-card{width:min(680px,100%);background:#fbfaf6;border-radius:18px;overflow:hidden;
      box-shadow:0 30px 90px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.35);animation:l2-in .32s ease both}
    @keyframes l2-in{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}
    .l2-results-top{position:relative;padding:28px 30px 26px;color:#fff;overflow:hidden;
      background:linear-gradient(135deg,var(--l2-accent,#054450),#061a20 85%)}
    .l2-results-top::after{content:"";position:absolute;right:-40px;top:-60px;width:220px;height:220px;border-radius:50%;
      background:radial-gradient(circle,rgba(255,255,255,.18),transparent 68%)}
    .l2-results-kicker{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.72}
    .l2-results-top h1{margin:6px 0 0;font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-.01em}
    .l2-results-score{display:flex;align-items:baseline;gap:10px;margin-top:18px}
    .l2-results-score b{font-size:52px;line-height:1;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
    .l2-results-score span{font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.7}
    .l2-save-pill{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:6px 11px;border-radius:999px;
      background:rgba(255,255,255,.14);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .l2-results-body{padding:24px 30px 8px}
    .l2-results-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
    .l2-results-stats>div{background:#fff;border:1px solid #e6e2d8;border-radius:10px;padding:12px 13px;min-width:0}
    .l2-results-stats span{display:block;font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#6f6a5e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .l2-results-stats b{display:block;font-size:22px;line-height:1.15;margin-top:4px;font-weight:800;font-variant-numeric:tabular-nums}
    .l2-results-stats em{display:block;font-style:normal;font-size:11px;margin-top:3px;color:#6f6a5e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .l2-results-stats em.up{color:#108950}
    .l2-results-stats em.down{color:#b8475b}
    .l2-progress-block{margin:0 0 20px;padding:14px 15px;background:#fff;border:1px solid #e6e2d8;border-radius:10px}
    .l2-progress-label{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:#6f6a5e;margin-bottom:8px}
    .l2-progress-label b{color:#0c1f31}
    .l2-progress-track{height:10px;border-radius:999px;background:#f0ede6;overflow:hidden}
    .l2-progress-track i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#ffd670,#fd6533);transition:width .7s ease}
    .l2-leaderboard-block h2{margin:0 0 9px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6f6a5e}
    .l2-leaderboard{width:100%;border-collapse:collapse;font-size:12px}
    .l2-leaderboard th{text-align:left;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#9a9ea2;padding:0 8px 6px;font-weight:700}
    .l2-leaderboard th:first-child,.l2-leaderboard td:first-child{padding-left:0}
    .l2-leaderboard td{padding:7px 8px;border-top:1px solid #eeeae1;color:#5c6670;vertical-align:middle}
    .l2-leaderboard tr.me td{background:#fff7f5;color:#0c1f31;font-weight:700}
    .l2-leaderboard .l2-rank{width:26px;color:#9a9ea2;font-variant-numeric:tabular-nums}
    .l2-leaderboard .l2-score{font-weight:700;color:#0c1f31;font-variant-numeric:tabular-nums;text-align:right}
    .l2-results-actions{display:flex;flex-wrap:wrap;gap:10px;padding:18px 30px 26px}
    .l2-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 20px;border-radius:999px;
      border:1px solid #dcd8cd;background:#fff;color:#0c1f31;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer;
      font-family:inherit;transition:background .15s ease,border-color .15s ease,transform .15s ease}
    .l2-btn:hover{background:#f4f2f1;border-color:#c9c3b5}
    .l2-btn:active{transform:translateY(1px)}
    .l2-btn-primary{background:#fa6432;border-color:#fa6432;color:#fff}
    .l2-btn-primary:hover{background:#ee4912;border-color:#ee4912}
    .l2-btn-ghost{background:transparent;border-color:transparent;color:#6f6a5e}
    .l2-btn-ghost:hover{background:#f4f2f1;color:#0c1f31}
    .l2-empty{padding:18px;border:1px dashed #dcd8cd;border-radius:10px;color:#6f6a5e;font-size:13px;text-align:center;background:#fff}
    .l2-results-note{font-size:11px;color:#9a9ea2;margin-top:10px}
    @media(max-width:620px){
      .l2-results{padding:10px;align-items:flex-start}
      .l2-results-top{padding:22px 20px}
      .l2-results-top h1{font-size:24px}
      .l2-results-score b{font-size:40px}
      .l2-results-body{padding:18px 20px 0}
      .l2-results-stats{grid-template-columns:repeat(2,1fr)}
      .l2-results-actions{padding:16px 20px 22px}
      .l2-results-actions .l2-btn{flex:1 1 42%}
    }
  `;
  document.head.appendChild(style);
}

function resultsOverlay() {
  let el = document.getElementById("l2-results");
  if (el) return el;
  el = document.createElement("div");
  el.id = "l2-results";
  el.className = "l2-results";
  el.hidden = true;
  el.innerHTML = '<div class="l2-results-card" role="dialog" aria-modal="true" aria-labelledby="l2-results-title"></div>';
  const host = document.getElementById("game") || document.body;
  host.appendChild(el);
  return el;
}

function leaderboardHtml(rows, currentId, limit = 5) {
  if (!rows.length) return '<div class="l2-empty">No runs yet. Your first score will appear here.</div>';
  const body = rows
    .slice(0, limit)
    .map(
      (row) => `<tr class="${row.id === currentId ? "me" : ""}">
        <td class="l2-rank">${row.rank}</td>
        <td>${formatNumber(row.score)} <span style="color:#9a9ea2;font-weight:400">pts</span></td>
        <td>Level ${row.level || "—"}</td>
        <td>${formatShortDate(row.t)}</td>
      </tr>`
    )
    .join("");
  return `<table class="l2-leaderboard">
    <thead><tr><th>#</th><th>Score</th><th>Level</th><th>When</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function showResultsOverlay(slug, summary) {
  injectResultsStyles();
  const game = getGame(slug);
  const el = resultsOverlay();
  const card = el.querySelector(".l2-results-card");
  if (!card || !game) return;

  if (!summary.saved) {
    card.style.setProperty("--l2-accent", game.color);
    card.innerHTML = `
      <div class="l2-results-top" style="--l2-accent:${escapeHtml(game.color)}">
        <div class="l2-results-kicker">Session ended</div>
        <h1 id="l2-results-title">${escapeHtml(game.name)}</h1>
        <div class="l2-results-score"><b>—</b><span>no score</span></div>
        <div class="l2-save-pill">Not saved — the session was not completed</div>
      </div>
      <div class="l2-results-body">
        <div class="l2-empty">Finish a full session to save points, unlock the next level and update your LPI.</div>
        <div class="l2-results-note">Tip: a session has to reach the end-of-game screen. Quitting early does not count.</div>
      </div>
      <div class="l2-results-actions">
        <button class="l2-btn l2-btn-primary" data-l2-play-again>Try again</button>
        <a class="l2-btn" href="../../game/${encodeURIComponent(slug)}/">Game page</a>
        <a class="l2-btn l2-btn-ghost" href="../../brain.html">My Brain</a>
      </div>`;
    el.hidden = false;
    el.querySelector("[data-l2-play-again]")?.addEventListener("click", () => location.reload());
    return;
  }

  const levelNext = summary.levelNext || summary.level || 1;
  const advanced = levelNext > (summary.level || 0);
  const levelPct = advanced ? 100 : 35;
  const deltaClass = summary.scoreDelta > 0 ? "up" : summary.scoreDelta < 0 ? "down" : "";
  const deltaText = summary.plays > 1
    ? summary.isPB
      ? `+${formatNumber(summary.scoreDelta)} new best`
      : `${formatNumber(summary.scoreDelta)} vs best`
    : "First run saved";
  const lpiClass = summary.lpiChange > 0 ? "up" : summary.lpiChange < 0 ? "down" : "";
  const lpiText = summary.lpiBefore
    ? `${summary.lpiChange >= 0 ? "+" : ""}${formatNumber(summary.lpiChange)} this session`
    : "First LPI";
  const areaText = summary.areaBefore
    ? `${summary.areaChange >= 0 ? "+" : ""}${formatNumber(summary.areaChange)} area LPI`
    : `First ${game.area} LPI`;
  const savedText = summary.isPB ? "✓ New personal best saved" : "✓ Score saved locally";

  card.style.setProperty("--l2-accent", game.color);
  card.innerHTML = `
    <div class="l2-results-top" style="--l2-accent:${escapeHtml(game.color)}">
      <div class="l2-results-kicker">Session complete</div>
      <h1 id="l2-results-title">${escapeHtml(game.name)}</h1>
      <div class="l2-results-score"><b>${formatNumber(summary.score)}</b><span>points</span></div>
      <div class="l2-save-pill">${savedText}</div>
    </div>
    <div class="l2-results-body">
      <div class="l2-results-stats">
        <div>
          <span>Personal best</span>
          <b>${formatNumber(summary.bestScore)}</b>
          <em class="${deltaClass}">${deltaText}</em>
        </div>
        <div>
          <span>Level</span>
          <b>${summary.level || "—"}</b>
          <em>${advanced ? `Unlocked ${levelNext}` : `Next: ${levelNext}`}</em>
        </div>
        <div>
          <span>LPI</span>
          <b>${formatNumber(summary.lpiAfter)}</b>
          <em class="${lpiClass}">${lpiText}</em>
        </div>
        <div>
          <span>${escapeHtml(game.area)}</span>
          <b>${formatNumber(summary.areaAfter)}</b>
          <em>${areaText}</em>
        </div>
      </div>
      <div class="l2-progress-block">
        <div class="l2-progress-label"><span>Level progress</span><b>${summary.level || "—"} → ${levelNext}</b></div>
        <div class="l2-progress-track"><i style="width:${levelPct}%"></i></div>
      </div>
      <div class="l2-leaderboard-block">
        <h2>Your top runs</h2>
        ${leaderboardHtml(summary.leaderboard || [], summary.session?.id, 5)}
      </div>
      <div class="l2-results-note">Stored in this browser. ${summary.plays} session${summary.plays === 1 ? "" : "s"} in ${escapeHtml(game.name)} · ${formatDuration(summary.duration)} this session.</div>
    </div>
    <div class="l2-results-actions">
      <button class="l2-btn l2-btn-primary" data-l2-play-again>Play again</button>
      <a class="l2-btn" href="../../game/${encodeURIComponent(slug)}/">Game page</a>
      <a class="l2-btn l2-btn-ghost" href="../../brain.html">My Brain</a>
    </div>`;

  el.hidden = false;
  el.querySelector("[data-l2-play-again]")?.addEventListener("click", () => location.reload());
  // Make the overlay keyboard-friendly and scroll if the viewport is short.
  el.querySelector(".l2-btn-primary")?.focus({ preventScroll: true });
}

function showCrashOverlay(slug, payload) {
  injectResultsStyles();
  const game = getGame(slug);
  const el = resultsOverlay();
  const card = el.querySelector(".l2-results-card");
  if (!card || !game) return;
  const message =
    payload?.app_data?.game_crash_message || payload?.message || "The game stopped unexpectedly.";
  card.innerHTML = `
    <div class="l2-results-top" style="--l2-accent:${escapeHtml(game.color)}">
      <div class="l2-results-kicker">Game error</div>
      <h1 id="l2-results-title">${escapeHtml(game.name)}</h1>
      <div class="l2-results-score"><b>!</b><span>could not finish</span></div>
      <div class="l2-save-pill">No score was saved</div>
    </div>
    <div class="l2-results-body">
      <div class="l2-empty">${escapeHtml(message)}</div>
      <div class="l2-results-note">Try reloading the game. If it keeps happening, open the browser console for the full error.</div>
    </div>
    <div class="l2-results-actions">
      <button class="l2-btn l2-btn-primary" data-l2-play-again>Reload game</button>
      <a class="l2-btn" href="../../game/${encodeURIComponent(slug)}/">Game page</a>
      <a class="l2-btn l2-btn-ghost" href="../../index.html">Training Games</a>
    </div>`;
  el.hidden = false;
  el.querySelector("[data-l2-play-again]")?.addEventListener("click", () => location.reload());
}

/**
 * Wire a generated game shell into the local store.
 * The shell only has to forward Unity events and use `launchParams`.
 */
export function createGameShell(slug) {
  const game = getGame(slug);
  if (!game) throw new Error(`Unknown game: ${slug}`);
  const launchParams = buildLaunchParams(slug);
  let resultShown = false;

  const hideChrome = () => {
    document.querySelector(".exit")?.style.setProperty("display", "none");
    document.getElementById("loader")?.classList.add("done");
  };

  const handleEvent = (name, data) => {
    if (name === "onSessionStarted") {
      const payload = parseMaybeJson(data);
      if (payload) {
        try {
          const meta = { slug, startedAt: Date.now(), tutorial: Boolean(payload.play_data?.tutorial) };
          window.sessionStorage.setItem("l2-last-session", JSON.stringify(meta));
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (name === "onSessionEnded") {
      if (resultShown) return;
      const summary = recordSession(slug, data, { final: true });
      if (summary.saved || summary.reason === "incomplete") {
        resultShown = true;
        hideChrome();
        showResultsOverlay(slug, summary);
      }
      return;
    }

    if (name === "onGameExited") {
      if (resultShown) return;
      const payload = parseMaybeJson(data) || {};
      const app = payload.app_data || {};
      if (app.game_crash) {
        resultShown = true;
        hideChrome();
        showCrashOverlay(slug, payload);
        return;
      }
      const complete = app.complete === true || payload.play_data?.complete === true;
      if (complete) {
        const summary = recordSession(slug, payload, { final: true });
        if (summary.saved || summary.reason === "incomplete") {
          resultShown = true;
          hideChrome();
          showResultsOverlay(slug, summary);
        }
      } else {
        resultShown = true;
        hideChrome();
        showResultsOverlay(slug, { saved: false, reason: "incomplete", score: 0, slug });
      }
      return;
    }

    if (name === "onGameActionTriggered") {
      // The Unity pause/quit menu can end a run without a completed session.
      // onGameExited will follow with the full payload, so nothing to do here.
      return;
    }
  };

  // Expose a tiny debug handle. It is useful for verifying the local flow
  // without waiting for a full 60-second round.
  try {
    window.__l2 = {
      slug,
      launchParams,
      summary: () => getGameStats(slug),
      lpi: () => getLpi(),
      simulate: (payload) => {
        resultShown = false;
        handleEvent("onSessionEnded", JSON.stringify(payload));
      },
    };
  } catch {
    /* ignore */
  }

  return { slug, game, launchParams, handleEvent };
}

/* ------------------------------------------------------------------ *
 * Game cards on the Training Games page
 * ------------------------------------------------------------------ */

export function decorateGameCards(root = document) {
  const cards = root.querySelectorAll("[data-gameslug]");
  cards.forEach((button) => {
    const slug = button.dataset.gameslug;
    if (!slug || !GAMES[slug] || button.hasAttribute("aria-disabled")) return;
    const stats = getGameStats(slug);
    const host = button.querySelector(".flex.flex-col.text-left");
    if (!host) return;
    let meta = host.querySelector(".l2-card-meta");
    if (!stats.plays) {
      meta?.remove();
      return;
    }
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "l2-card-meta";
      host.appendChild(meta);
    }
    meta.textContent = `Level ${stats.levelNext || stats.bestLevel || 1} · Best ${formatNumber(stats.bestScore)}`;
  });
}

/* ------------------------------------------------------------------ *
 * Game detail page
 * ------------------------------------------------------------------ */

function text(el, value) {
  if (el) el.textContent = value == null ? "—" : String(value);
}

function widthPct(value, max = 2000) {
  return clamp(((Number(value) || 0) / max) * 100, 0, 100).toFixed(1);
}

function renderRunTable(rows, emptyText) {
  if (!rows.length) return `<div class="l2-empty">${escapeHtml(emptyText)}</div>`;
  return `<table class="l2-run-table">
    <thead><tr><th>#</th><th>Score</th><th>Level</th><th>When</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr><td class="l2-rank">${r.rank || ""}</td><td class="l2-score">${formatNumber(r.score)}</td><td>${r.level || "—"}</td><td>${formatRelative(r.t)}</td></tr>`
      )
      .join("")}</tbody>
  </table>`;
}

export function initGamePage() {
  const slug = document.body.dataset.slug || window.location.pathname.split("/").filter(Boolean).pop();
  const game = getGame(slug);
  if (!game) return;

  const skill = getSkill(game.skill);
  const stats = getGameStats(slug);
  const lpi = getLpi();
  const rank = getGameRankings().find((g) => g.slug === slug);
  const topRuns = getLeaderboard(slug, 5);
  const recent = getSessions(slug, 4);

  text(document.getElementById("p-area"), game.area);
  text(document.getElementById("p-skill"), game.skill);
  text(document.getElementById("p-skill-name"), game.skill);
  text(document.getElementById("p-skill-desc"), skill.description);
  text(document.getElementById("p-skill-example"), skill.example);
  text(document.getElementById("p-desc"), game.description);

  const play = document.getElementById("p-play");
  if (play) play.href = `../../games/${slug}/`;
  const zen = document.getElementById("p-zen");
  if (zen) zen.href = `../../games/${slug}/?zen=1`;

  text(document.getElementById("p-lpi"), stats.plays ? formatNumber(stats.lpi) : "—");
  text(document.getElementById("p-lpi-note"), stats.plays ? `Top ${rank ? rank.rank : "—"} of your games` : "Play to establish a game LPI");
  const lpiBar = document.getElementById("p-lpi-bar");
  if (lpiBar) lpiBar.style.width = `${stats.plays ? widthPct(stats.lpi) : 0}%`;

  text(document.getElementById("p-plays"), formatNumber(stats.plays));
  text(document.getElementById("p-plays-note"), stats.plays ? `${getTotals().sessions} total sessions` : "Not played yet");
  text(document.getElementById("p-level"), stats.levelNext || stats.bestLevel || "—");
  text(document.getElementById("p-level-note"), stats.levelNext ? "Highest unlocked" : "Start at level 1");
  text(document.getElementById("p-best-points"), stats.plays ? formatNumber(stats.bestScore) : "—");
  text(document.getElementById("p-best-level"), stats.plays ? stats.bestLevel || stats.levelNext || "—" : "—");

  const topHost = document.getElementById("p-top-runs");
  if (topHost) topHost.innerHTML = renderRunTable(topRuns, "No runs yet — your first score will appear here.");
  const recentHost = document.getElementById("p-recent");
  if (recentHost) {
    recentHost.innerHTML = recent.length
      ? `<div class="l2-recent-list">${recent
          .map(
            (r) =>
              `<div class="l2-recent-row"><span>${formatNumber(r.score)} pts</span><span>Level ${r.level || "—"}</span><span>${formatRelative(r.t)}</span></div>`
          )
          .join("")}</div>`
      : `<div class="l2-empty">Your recent sessions will show up here.</div>`;
  }

  text(document.getElementById("p-total-points"), formatNumber(getTotals().totalPoints));
  text(document.getElementById("p-overall-lpi"), lpi.overall ? formatNumber(lpi.overall) : "—");

  const how = document.getElementById("p-how-dialog");
  const howDesc = document.getElementById("p-how-desc");
  const howSkill = document.getElementById("p-how-skill");
  if (howDesc) howDesc.textContent = game.description;
  if (howSkill) {
    howSkill.innerHTML = `<b>${escapeHtml(game.skill)}</b> is ${escapeHtml(skill.description)}<br><br><b>Example:</b> ${escapeHtml(skill.example)}`;
  }
  document.querySelectorAll("[data-l2-how]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (how && typeof how.showModal === "function") how.showModal();
    });
  });
  document.querySelectorAll("[data-l2-how-close]").forEach((btn) => {
    btn.addEventListener("click", () => how?.close());
  });
  how?.addEventListener("click", (event) => {
    if (event.target === how) how.close();
  });

  // Update the page when another tab saves a score.
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) location.reload();
  });
}

/* ------------------------------------------------------------------ *
 * My Brain page
 * ------------------------------------------------------------------ */

const AREA_COLORS = {
  Speed: "#22ba72",
  Memory: "#11c6ff",
  Attention: "#8a7cf5",
  Flexibility: "#fa6432",
  Reasoning: "#ffcd3d",
  Math: "#36ccc1",
  Language: "#f472b6",
};

function lpiFill(value, height = 18, reserve = 36) {
  const pct = Math.max(0, Math.min(100, (Number(value) || 0) / 2000 * 100));
  const width = value ? `calc(${pct}% - ${reserve}px)` : "0px";
  return `<div data-name="progress-bar" class="min-w-1 rounded-sm bg-yellow-gradient-2 transition-all duration-700" data-progress="${pct.toFixed(0)}" style="height:${height}px;width:${width}"></div>`;
}

function areaRowsHtml(lpi) {
  return AREAS.map((area) => {
    const value = lpi.areas[area] || 0;
    return `<button class="flex flex-row justify-center items-center gap-4 font-normal border-t border-border-subdued pr-5 py-3" data-area-row="${escapeHtml(area)}">
      <div class="flex flex-col w-full">
        <div class="flex flex-row justify-between items-center mb-1 font-normal text-body-text-3">
          <div class="flex flex-row items-baseline flex-wrap gap-1">${escapeHtml(area)}</div>
          <div class="text-caption-2 text-text-subdued">${value ? `${Math.round(value / 20)}%` : "Not played"}</div>
        </div>
        <div data-name="progress-container" class="flex flex-row items-center gap-2 text-body-text-3">
          ${lpiFill(value)}
          <div data-name="progress-value" class="whitespace-nowrap">${value ? formatNumber(value) : "—"}</div>
        </div>
      </div>
      <svg width="1em" height="1em" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" class="h-7 w-7 shrink-0 text-icon-subdued" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M22.4142 16L13.7071 7.29289L12.2929 8.70711L19.5858 16L12.2929 23.2929C11.9024 23.6834 11.9024 24.3166 12.2929 24.7071C12.6834 25.0976 13.3166 25.0976 13.7071 24.7071L22.4142 16Z" fill="currentColor"></path></svg>
    </button>`;
  }).join("");
}

function historyChart(history) {
  const rows = history.slice(-16);
  if (rows.length < 2) {
    return `<div class="l2-empty">Play at least two sessions to see your LPI trend.</div>`;
  }
  const values = rows.map((r) => Number(r.overall) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const W = 640;
  const H = 170;
  const padX = 10;
  const padY = 18;
  const step = (W - padX * 2) / (rows.length - 1);
  const points = values.map((v, i) => {
    const x = padX + i * step;
    const y = H - padY - ((v - min) / span) * (H - padY * 2);
    return [x, y];
  });
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${H - padY} L${points[0][0].toFixed(1)},${H - padY} Z`;
  const dots = points
    .map(
      ([x, y], i) =>
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === points.length - 1 ? 4 : 2.4}" fill="${i === points.length - 1 ? "#fa6432" : "#f5b93f"}"></circle>`
    )
    .join("");
  const first = rows[0];
  const last = rows[rows.length - 1];
  return `<div class="l2-chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" class="l2-chart" role="img" aria-label="LPI history">
      <defs><linearGradient id="l2-chart-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffcd3d" stop-opacity=".38"></stop>
        <stop offset="1" stop-color="#ffcd3d" stop-opacity="0"></stop>
      </linearGradient></defs>
      <path d="${area}" fill="url(#l2-chart-fill)"></path>
      <path d="${line}" fill="none" stroke="#f5b93f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
      <text x="${padX}" y="12" fill="#9a9ea2" font-size="10">${max}</text>
      <text x="${padX}" y="${H - 4}" fill="#9a9ea2" font-size="10">${min}</text>
    </svg>
    <div class="l2-chart-axis"><span>${formatShortDate(first.t)}</span><span>${formatShortDate(last.t)}</span></div>
  </div>`;
}

function rankingRows(rows, limit = 8) {
  if (!rows.length) return `<div class="l2-empty">Play a game to start your rankings.</div>`;
  return rows
    .slice(0, limit)
    .map(
      (row) => `<div class="l2-ranking-row">
        <div class="l2-ranking-name"><span class="l2-rank-badge">${row.rank}</span><a href="game/${row.slug}/">${escapeHtml(row.name)}</a><span class="l2-ranking-area">${escapeHtml(row.area)}</span></div>
        <div class="l2-ranking-bar"><i style="width:${widthPct(row.lpi)}%;background:${AREA_COLORS[row.area] || "#f5b93f"}"></i></div>
        <div class="l2-ranking-val">${formatNumber(row.lpi)}</div>
      </div>`
    )
    .join("");
}

function improvedRows(rows) {
  if (!rows.length) return `<div class="l2-empty">Play a game more than once to see improvement.</div>`;
  return rows
    .slice(0, 5)
    .map(
      (row) => `<div class="l2-improved-row">
        <div><a href="game/${row.slug}/">${escapeHtml(row.name)}</a><span>${row.plays} sessions</span></div>
        <div class="l2-improved-delta">+${formatNumber(row.delta)} <span>LPI</span></div>
      </div>`
    )
    .join("");
}

function trainingRows(rows, area = "All") {
  const list = rows.filter((row) => area === "All" || row.area === area);
  if (!list.length) return `<div class="l2-empty">No games in this area yet.</div>`;
  return `<div class="l2-training-table">
    <div class="l2-training-head"><span>Game</span><span>Area</span><span>Plays</span><span>Best</span><span>Level</span><span>LPI</span><span>Last</span></div>
    ${list
      .map(
        (row) => `<a class="l2-training-row${row.plays ? "" : " is-empty"}" href="game/${row.slug}/">
          <span class="l2-training-game"><b>${escapeHtml(row.name)}</b><em>${escapeHtml(row.skill)}</em></span>
          <span>${escapeHtml(row.area)}</span>
          <span>${row.plays || "—"}</span>
          <span>${row.plays ? formatNumber(row.bestScore) : "—"}</span>
          <span>${row.plays ? row.bestLevel || row.levelNext || "—" : "—"}</span>
          <span>${row.plays ? formatNumber(row.lpi) : "—"}</span>
          <span>${row.lastPlayed ? formatRelative(row.lastPlayed) : "Not played"}</span>
        </a>`
      )
      .join("")}
  </div>`;
}

function collectionsHtml(rows) {
  return `<div class="l2-collections">${AREAS.map((area) => {
    const areaRows = rows.filter((r) => r.area === area);
    const played = areaRows.filter((r) => r.plays);
    const avg = played.length ? Math.round(played.reduce((s, r) => s + r.lpi, 0) / played.length) : 0;
    const best = played.slice().sort((a, b) => b.lpi - a.lpi)[0];
    return `<a class="l2-collection-card" href="game/${best ? best.slug : areaRows[0]?.slug || ""}/" style="--l2-area:${AREA_COLORS[area] || "#f5b93f"}">
      <div class="l2-collection-top"><span>${escapeHtml(area)}</span><b>${avg ? formatNumber(avg) : "—"}</b></div>
      <div class="l2-collection-bar"><i style="width:${avg ? widthPct(avg) : 0}%"></i></div>
      <div class="l2-collection-meta">${played.length} of ${areaRows.length} games played${best ? ` · Best: ${escapeHtml(best.name)}` : ""}</div>
    </a>`;
  }).join("")}</div>`;
}

function insightsHtml(lpi, totals, rankings, improved) {
  if (!totals.sessions) {
    return `<div class="l2-empty">Play your first session and your insights will appear here.</div>`;
  }
  const playedAreas = AREAS.filter((a) => lpi.areas[a] > 0);
  const strongest = playedAreas.slice().sort((a, b) => lpi.areas[b] - lpi.areas[a])[0];
  const weakest = playedAreas.slice().sort((a, b) => lpi.areas[a] - lpi.areas[b])[0];
  const unplayed = AREAS.filter((a) => !lpi.areas[a]);
  const mostPlayed = rankings.slice().sort((a, b) => b.plays - a.plays)[0];
  const bestGame = rankings[0];
  const topImproved = improved[0];
  const cards = [
    {
      label: "Strongest area",
      value: strongest || "—",
      detail: strongest ? `${formatNumber(lpi.areas[strongest])} LPI` : "Play a game to find out",
    },
    {
      label: "Next focus",
      value: unplayed[0] || weakest || "—",
      detail: unplayed[0]
        ? "No sessions in this area yet"
        : weakest
          ? `${formatNumber(lpi.areas[weakest])} LPI — your lowest area`
          : "Keep training",
    },
    {
      label: "Most played",
      value: mostPlayed ? mostPlayed.name : "—",
      detail: mostPlayed ? `${mostPlayed.plays} sessions` : "No games yet",
    },
    {
      label: "Best game",
      value: bestGame ? bestGame.name : "—",
      detail: bestGame ? `${formatNumber(bestGame.lpi)} game LPI` : "No games yet",
    },
    {
      label: "Most improved",
      value: topImproved ? topImproved.name : "—",
      detail: topImproved ? `+${formatNumber(topImproved.delta)} LPI over ${topImproved.plays} sessions` : "Play a game twice to compare",
    },
    {
      label: "Consistency",
      value: totals.streak ? `${totals.streak}-day streak` : "No streak yet",
      detail: `${totals.sessions} sessions across ${totals.activeDays} day${totals.activeDays === 1 ? "" : "s"}`,
    },
  ];
  return `<div class="l2-insights">${cards
    .map(
      (c) => `<div class="l2-insight-card"><span>${escapeHtml(c.label)}</span><b>${escapeHtml(c.value)}</b><em>${escapeHtml(c.detail)}</em></div>`
    )
    .join("")}</div>`;
}

export function initBrainPage() {
  const $ = (id) => document.getElementById(id);
  const tabs = Array.from(document.querySelectorAll("[data-brain-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-brain-panel]"));
  let activeArea = "All";

  const setTab = (name) => {
    tabs.forEach((tab) => {
      const on = tab.dataset.brainTab === name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.className = on
        ? "active px-4 py-[10px] text-caption-1 uppercase cursor-pointer border-b-2 border-border-interactive text-text-subdued font-semibold"
        : "px-4 py-[10px] text-caption-1 uppercase cursor-pointer text-neutral-cool-60 font-normal";
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.brainPanel !== name;
    });
  };

  const render = () => {
    const lpi = getLpi();
    const totals = getTotals();
    const rankings = getGameRankings();
    const improved = getMostImproved();
    const all = getAllGameStats().sort((a, b) => {
      if (a.plays && !b.plays) return -1;
      if (!a.plays && b.plays) return 1;
      if (a.plays && b.plays) return b.lpi - a.lpi || b.plays - a.plays;
      return a.name.localeCompare(b.name);
    });

    // Overall card
    text($("lpi-overall"), lpi.overall ? formatNumber(lpi.overall) : "—");
    text($("lpi-first"), lpi.first ? formatNumber(lpi.first) : "—");
    text($("lpi-best"), lpi.best ? formatNumber(lpi.best) : "—");
    text($("lpi-note"), totals.sessions
      ? `${totals.sessions} session${totals.sessions === 1 ? "" : "s"} across ${totals.games} game${totals.games === 1 ? "" : "s"}. Local estimate, 0–2000.`
      : "Play a game to establish your LPI.");
    const overallBar = $("lpi-overall-bar");
    if (overallBar) overallBar.style.width = lpi.overall ? `calc(${widthPct(lpi.overall)}% - 52px)` : "0px";
    const overallPct = $("lpi-overall-pct");
    if (overallPct) overallPct.textContent = lpi.overall ? `${Math.round(lpi.overall / 20)}%` : "—";

    const areaHost = $("lpi-areas");
    if (areaHost) areaHost.innerHTML = areaRowsHtml(lpi);
    areaHost?.querySelectorAll("[data-area-row]").forEach((row) => {
      row.addEventListener("click", () => {
        setTab("training");
        activeArea = row.dataset.areaRow;
        renderTraining();
      });
    });

    // History
    const chart = $("lpi-chart");
    if (chart) chart.innerHTML = historyChart(lpi.history);
    const historyMeta = $("lpi-history-meta");
    if (historyMeta) {
      historyMeta.textContent = lpi.history.length
        ? `${lpi.history.length} recorded session${lpi.history.length === 1 ? "" : "s"}${lpi.change ? ` · ${lpi.change > 0 ? "+" : ""}${formatNumber(lpi.change)} on your last session` : ""}`
        : "No history yet.";
    }

    // Rankings and improvement
    const rankHost = $("lpi-rankings");
    if (rankHost) rankHost.innerHTML = rankingRows(rankings, 8);
    const improvedHost = $("lpi-improved");
    if (improvedHost) improvedHost.innerHTML = improvedRows(improved);

    // Training
    const areaTabs = $("training-areas");
    if (areaTabs) {
      const areas = ["All", ...AREAS];
      areaTabs.innerHTML = areas
        .map(
          (area) =>
            `<button type="button" data-training-area="${escapeHtml(area)}" class="l2-filter${area === activeArea ? " is-active" : ""}">${escapeHtml(area)}</button>`
        )
        .join("");
      areaTabs.querySelectorAll("[data-training-area]").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeArea = btn.dataset.trainingArea;
          renderTraining();
        });
      });
    }
    const trainingHost = $("training-list");
    if (trainingHost) trainingHost.innerHTML = trainingRows(all, activeArea);

    // Collections & insights
    const collectionsHost = $("collections-list");
    if (collectionsHost) collectionsHost.innerHTML = collectionsHtml(all);
    const insightsHost = $("insights-list");
    if (insightsHost) insightsHost.innerHTML = insightsHtml(lpi, totals, rankings, improved);

    // Header quick stats
    text($("total-sessions"), formatNumber(totals.sessions));
    text($("total-points"), formatNumber(totals.totalPoints));
    text($("total-games"), `${totals.games}/${GAME_SLUGS.length}`);
    text($("streak-days"), totals.streak ? `${totals.streak}d` : "—");
    text($("data-note-text"), totals.sessions
      ? `Stored in this browser · ${formatNumber(totals.sessions)} session${totals.sessions === 1 ? "" : "s"} · ${formatNumber(totals.totalPoints)} points`
      : "Stored in this browser · no sessions yet");
  };

  const renderTraining = () => {
    const all = getAllGameStats().sort((a, b) => {
      if (a.plays && !b.plays) return -1;
      if (!a.plays && b.plays) return 1;
      if (a.plays && b.plays) return b.lpi - a.lpi || b.plays - a.plays;
      return a.name.localeCompare(b.name);
    });
    const trainingHost = $("training-list");
    if (trainingHost) trainingHost.innerHTML = trainingRows(all, activeArea);
    document.querySelectorAll("[data-training-area]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.trainingArea === activeArea);
    });
  };

  tabs.forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.brainTab)));
  const info = document.querySelector(".lpi-head .info");
  info?.addEventListener("click", () => {
    const explainer = $("lpi-explainer");
    if (!explainer) return;
    explainer.hidden = !explainer.hidden;
    info.setAttribute("aria-expanded", explainer.hidden ? "false" : "true");
  });
  document.querySelector(".lpi-row.overall")?.addEventListener("click", () => setTab("insights"));
  $("reset-data")?.addEventListener("click", () => {
    if (!window.confirm("Reset all local scores, levels and LPI history? This cannot be undone.")) return;
    resetStore();
    render();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === KEY) {
      cache = null;
      render();
    }
  });
  window.addEventListener("l2:store", render);

  setTab("lpi");
  render();
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export { AREAS, GAMES, GAME_SLUGS, getGame, getSkill };
export const STORAGE_KEY = KEY;
