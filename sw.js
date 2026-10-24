/*
 * Brotli shim for the rehosted Lumosity builds.
 *
 * Unity ships its WebGL payload brotli-compressed, but GitHub Pages will not
 * send `Content-Encoding: br` for a `.br` file, and both `WebAssembly.instantiate`
 * and Unity's asset loader need the decompressed bytes. So we keep only the
 * compressed files on disk and decompress them here, on the way out.
 *
 * Any request under /games/ for a .wasm, .data, .bundle or .framework.js is
 * answered from the matching "<path>.br" file, decompressed with a small
 * vendored brotli WASM decoder. Everything else falls through to the network,
 * and a missing ".br" falls back to the original path, so a mixed tree (some
 * games compressed, some not) just works.
 */
import init, { decompress } from "./vendor/brotli/brotli_dec_wasm.js";

const BIG_BINARY = /\.(wasm|data|bundle)$|\.framework\.js$/;

let ready = null;
const ensure = () => (ready ||= init());

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes("/games/")) return;
  if (!BIG_BINARY.test(url.pathname)) return;

  event.respondWith(respond(request, url));
});

async function respond(request, url) {
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
