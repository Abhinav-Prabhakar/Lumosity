/*
 * Theme switch for the local Lumosity pages.
 * Applies the saved theme before first paint, then wires every [data-theme-toggle]
 * button. With no saved choice it follows the operating-system preference.
 */
(function () {
  var KEY = "l2-theme";
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function saved() {
    try {
      var value = localStorage.getItem(KEY);
      return value === "dark" || value === "light" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function preferred() {
    return saved() || (media && media.matches ? "dark" : "light");
  }

  function paint(theme) {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    var dark = theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      button.setAttribute("aria-pressed", dark ? "true" : "false");
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      button.setAttribute("title", dark ? "Switch to light mode" : "Switch to dark mode");
    });
  }

  function toggle() {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch (_) {}
    paint(next);
  }

  paint(preferred());

  document.addEventListener("DOMContentLoaded", function () {
    paint(root.getAttribute("data-theme") || preferred());
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      button.addEventListener("click", toggle);
    });
  });

  if (media) {
    var sync = function (event) {
      if (!saved()) paint(event.matches ? "dark" : "light");
    };
    if (media.addEventListener) media.addEventListener("change", sync);
    else if (media.addListener) media.addListener(sync);
  }
})();
