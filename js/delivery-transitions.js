/* delivery-transitions.js
   Makes bottom-nav (and any link marked data-transition) feel like in-app
   navigation instead of a hard page reload: fades the current view out,
   navigates, and the next page fades in on load. Pure CSS + rAF, no
   framework — works with the existing multi-page structure.
*/

(function () {
  const FADE_MS = 160;

  function fadeInOnLoad() {
    const app = document.getElementById("app");
    if (!app) return;
    app.classList.add("page-enter");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => app.classList.add("page-enter-active"));
    });
  }

  function interceptNavClicks() {
    document.addEventListener("click", (e) => {
      const link = e.target.closest("a[data-transition], .nav-btn");
      if (!link) return;
      if (link.target === "_blank") return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("tel:") || href.startsWith("mailto:")) return;

      // let modifier-clicks (open in new tab etc.) behave normally
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;

      e.preventDefault();

      // Instant tab-highlight swap so the nav itself feels responsive
      if (link.classList.contains("nav-btn")) {
        document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
        link.classList.add("active");
      }

      const app = document.getElementById("app");
      if (app) {
        app.classList.add("page-leave");
        setTimeout(() => (window.location.href = href), FADE_MS);
      } else {
        window.location.href = href;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    fadeInOnLoad();
    interceptNavClicks();
  });

  // Exposed helper so page scripts can do a faded, app-like navigation
  // instead of a hard `location.href = ...` jump.
  window.appNavigate = function (href) {
    const app = document.getElementById("app");
    if (app) {
      app.classList.add("page-leave");
      setTimeout(() => (window.location.href = href), FADE_MS);
    } else {
      window.location.href = href;
    }
  };
})();
