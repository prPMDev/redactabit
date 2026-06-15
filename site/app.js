/* Frisket landing — the only JS on the page.
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
