/*
 * Service worker for the rehosted Lumosity mirror.
 *
 * Two jobs:
 *  1. Decompress Unity's brotli payloads on the way out. GitHub Pages will not
 *     send `Content-Encoding: br` for a `.br` file, and both
 *     `WebAssembly.instantiate` and Unity's asset loader need plain bytes. Any
 *     request under /games/ for a .wasm, .data, .bundle or .framework.js is
 *     answered from the matching "<path>.br" file, decompressed with the
 *     vendored brotli WASM decoder.
 *  2. Cache the app shell so the installed PWA opens offline on every platform.
 *     Navigations are network-first with a cached fallback; shell files are
 *     stale-while-revalidate. Large Unity payloads are never cached.
 */
import init, { decompress } from "./vendor/brotli/brotli_dec_wasm.js";

const BIG_BINARY = /\.(wasm|data|bundle)$|\.framework\.js$/;

// Bump this when the shell assets change, so installed copies pick up the update.
const SHELL_CACHE = "l2-shell-v1";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./brain.html",
  "./styles.css",
  "./l2.css",
  "./l2-theme.js",
  "./l2-pwa.js",
  "./l2.js",
  "./l2-games.js",
  "./manifest.json",
  "./assets/favicon.ico",
  "./assets/favicon-16x16.png",
  "./assets/favicon-32x32.png",
  "./assets/favicon-48x48.png",
  "./assets/icons/icon-96.png",
  "./assets/icons/icon-144.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-192.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon-120.png",
  "./assets/icons/apple-touch-icon-152.png",
  "./assets/icons/apple-touch-icon-167.png",
  "./assets/icons/apple-touch-icon-180.png",
  "./assets/fonts/MuseoSans_100.woff",
  "./assets/fonts/MuseoSans_300.woff",
  "./assets/fonts/MuseoSans_500.woff",
  "./assets/fonts/MuseoSans_700.woff",
  "./assets/fonts/MuseoSans_900.woff",
];

const toUrl = (asset) => new URL(asset, self.location.href);
const SHELL_URLS = new Set(SHELL_ASSETS.map((asset) => toUrl(asset).href));
const SHELL_PATHS = new Set(SHELL_ASSETS.map((asset) => toUrl(asset).pathname));
const APP_ROOT = toUrl("./").href;

let ready = null;
const ensure = () => (ready ||= init());

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort: one missing asset must not stop the worker from activating
      // (the Unity pages wait on navigator.serviceWorker.ready before starting).
      await Promise.all(SHELL_ASSETS.map((asset) => cache.add(asset).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("l2-shell-") && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Unity payloads: decompress on the fly (and never cache them).
  if (url.pathname.includes("/games/") && BIG_BINARY.test(url.pathname)) {
    event.respondWith(respondCompressed(request, url));
    return;
  }
  if (url.pathname.includes("/games/")) return;

  // App pages: network first so updates land, cached shell as the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }

  // Local art and fonts are cached as they are browsed, so the shell gets more
  // useful offline without precaching every game asset.
  if (SHELL_PATHS.has(url.pathname) || request.destination === "image" || request.destination === "font") {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function navigate(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok && SHELL_URLS.has(new URL(request.url).href)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (new URL(request.url).pathname.endsWith("/brain.html")) {
      const brain = await cache.match(toUrl("./brain.html").href);
      if (brain) return brain;
    }
    return (await cache.match(toUrl("./index.html").href)) || (await cache.match(APP_ROOT)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const update = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await update) || Response.error();
}

async function respondCompressed(request, url) {
  let compressed;
  try {
    compressed = await fetch(url.pathname + ".br", { credentials: "same-origin" });
  } catch {
    return fetch(request);
  }
  if (!compressed.ok) return fetch(request);

  try {
    await ensure();
    const body = decompress(new Uint8Array(await compressed.arrayBuffer()));
    return new Response(body, {
      status: 200,
      statusText: "OK",
      headers: {
        "Content-Type": contentType(url.pathname),
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return fetch(request);
  }
}

function contentType(path) {
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
