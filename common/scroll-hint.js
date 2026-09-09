(function () {
  "use strict";

  function initScrollHints() {
    var pairs = Array.from(document.querySelectorAll(".scroll-hint"))
      .map(function (hint) {
        return { hint: hint, scroller: hint.nextElementSibling };
      })
      .filter(function (pair) {
        return !!pair.scroller;
      });

    if (!pairs.length) return;

    var scheduled = false;
    function update() {
      scheduled = false;
      pairs.forEach(function (pair) {
        var hasOverflow =
          pair.scroller.scrollWidth > pair.scroller.clientWidth + 1;
        pair.hint.classList.toggle("is-overflowing", hasOverflow);
      });
    }
    function scheduleUpdate() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(update);
    }

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("load", scheduleUpdate);

    if (window.ResizeObserver) {
      var resizeObserver = new ResizeObserver(scheduleUpdate);
      pairs.forEach(function (pair) {
        resizeObserver.observe(pair.scroller);
        var table = pair.scroller.querySelector("table");
        if (table) resizeObserver.observe(table);
      });
    }

    if (window.MutationObserver) {
      var mutationObserver = new MutationObserver(scheduleUpdate);
      pairs.forEach(function (pair) {
        mutationObserver.observe(pair.scroller, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
    }

    scheduleUpdate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScrollHints);
  } else {
    initScrollHints();
  }
})();
