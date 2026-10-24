/*
 * Registers the service worker that makes this site installable and lets it
 * open offline. Works from the root pages and from /game/<slug>/ pages: the
 * worker always lives at the site root, next to this script.
 */
(function () {
  if (!("serviceWorker" in navigator)) return;

  var el = document.currentScript || document.querySelector('script[src$="l2-pwa.js"]');
  var root = new URL("./", el ? el.src : window.location.href);

  function register() {
    navigator.serviceWorker
      .register(new URL("sw.js", root).href, { scope: root.href, type: "module" })
      .catch(function () {});
  }

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
})();
