/* Redactabit landing — progressive enhancements (local-only, no network).
 * Progressive enhancement: relabel the primary download button to the visitor's OS.
 * Pure local navigator sniffing — no network, no third parties. The page is fully
 * functional (and defaults to Windows) with JS disabled.
 */
(function () {
  "use strict";
  var btn = document.querySelector("[data-download]");
  if (!btn) return;

  var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  p = p.toLowerCase();

  var os = "Windows"; // default — the primary target
  if (p.indexOf("mac") > -1) os = "macOS";
  else if (p.indexOf("linux") > -1 && p.indexOf("android") === -1) os = "Linux";

  if (os !== "Windows") btn.textContent = "Download for " + os;
  // href is intentionally unchanged: it points at the releases page for every OS.
})();

/* Theme toggle: System (follow OS) -> Light -> Dark, remembered in localStorage.
 * "System" removes the data-theme attribute so the prefers-color-scheme CSS takes over;
 * Light/Dark set it explicitly. Local-only: just reads/writes localStorage, no network. */
(function () {
  "use strict";
  var root = document.documentElement;
  var btn = document.querySelector("[data-theme-toggle]");
  if (!btn) return;

  var ICONS = {
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>'
  };
  var ORDER = ["system", "light", "dark"];

  function read() {
    try { var t = localStorage.getItem("theme"); if (t === "light" || t === "dark" || t === "system") return t; } catch (e) {}
    return "system";
  }
  function apply(mode) {
    if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme");        // System -> let prefers-color-scheme decide
    try { localStorage.setItem("theme", mode); } catch (e) {}
    btn.innerHTML = ICONS[mode];
    var label = mode.charAt(0).toUpperCase() + mode.slice(1);
    btn.setAttribute("aria-label", "Color theme: " + label + " (click to change)");
    btn.title = "Theme: " + label;
  }

  apply(read());
  btn.addEventListener("click", function () {
    apply(ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length]);
  });
})();
