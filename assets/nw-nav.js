// Navbar height, measured live rather than hard-coded: the hero (and every
// page's title band) pulls itself up by exactly this amount so its
// background/dot-grid always reaches y=0 behind the transparent navbar, even
// as the navbar's real height shifts (webfont swap reflow, breakpoint change,
// mobile menu open/close). ResizeObserver keeps --nw-navbar-h correct through
// all of those without a resize-event poll.
(function () {
  var nav = document.querySelector(".navbar");
  if (!nav) return;
  var root = document.documentElement;
  var set = function () {
    var h = nav.getBoundingClientRect().height;
    if (h > 0) root.style.setProperty("--nw-navbar-h", h + "px");
  };
  set();
  if ("ResizeObserver" in window) {
    new ResizeObserver(set).observe(nav);
  } else {
    window.addEventListener("resize", set);
  }
})();

// The residual gap above #title-block-header (--nw-band-lift) used to be
// measured here, from the band's position after layout. It isn't any more:
// the gap is derived in CSS from --nw-navbar-h instead — see "page-title
// band" in theme.scss. Measuring it was a race the band kept losing. Every
// reading had to happen after the last thing that could still move the band
// (the webfont swap resizing the navbar, images, JS-injected content), and a
// reading taken a frame too early stuck, leaving the band's background
// stranded a few pixels below y=0 with a hairline of page showing through
// above it — which is exactly the bug this replaced.

// Nav bar reads as part of the page's top "hero" band until the visitor
// scrolls: transparent and borderless over the hero/dot-grid art, then the
// site's normal solid navbar once scrolled past it. CSS does the actual look
// (see "hero navbar: transparent until scroll" in site.css) — this just flips
// the class scroll position decides. Runs on every page (not just the
// landing page), since every page now carries the same top band.
(function () {
  var SCROLLED_AT = 40;
  var onNavScroll = function () {
    document.body.classList.toggle("nw-scrolled", window.scrollY > SCROLLED_AT);
  };
  window.addEventListener("scroll", onNavScroll, { passive: true });
  onNavScroll();
})();

// Shared by the scroll, view-transition and nav IIFEs below, so it is an
// explicit property of `window` rather than an implicit global.
window.nwReducedMotion = function () {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

// The section-matching regexes below key off `location.pathname` starting
// with e.g. "/blog/", which only holds when the site sits at its domain's
// root. Deriving the deploy path from this very script's own URL — rather
// than hard-coding it — means it keeps working through the next rename too
// (see scripts/site-output.ts's `basePath`, the same fix on the build side).
window.nwSitePath = function () {
  var script = document.currentScript;
  if (!script) {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (/\/nw-nav\.js(?:[?#]|$)/.test(scripts[i].src)) {
        script = scripts[i];
        break;
      }
    }
  }
  var src = script && script.src;
  if (!src) return "";
  try {
    return new URL(src, location.href).pathname.replace(/\/assets\/nw-nav\.js$/, "");
  } catch {
    return "";
  }
};

// A pathname with the site's deploy path (if any) stripped off, so the
// section-matching regexes below can stay anchored to "/blog/" etc.
// regardless of where the site is actually served from.
window.nwStripSitePath = function (pathname) {
  var base = window.nwSitePath();
  return base && pathname.indexOf(base) === 0 ? pathname.slice(base.length) || "/" : pathname;
};

window.nwPagePath = function () {
  return window.nwStripSitePath(location.pathname);
};

// scripts/optimize-output.ts parks the alternate (dark) stylesheets behind
// `media="not all"` so they don't block first paint in light mode, and a
// pre-paint script in <head> re-arms them for visitors who load straight into
// dark. A *toggle* into dark has to do the same, and Quarto's own
// `toggleColorMode` only ever flips `rel` — a sheet left at `media="not all"`
// would be enabled and still apply nothing. Wrapping the exported entry point
// covers both callers: Quarto's inline `onclick` and the wipe below, which
// reads `window.quartoToggleColorScheme` at click time.
//
// Setting `media` on the way in (rather than trying to match the new state
// afterwards) keeps this correct in both directions: enabling dark needs the
// sheet armed, and disabling it leaves `rel="disabled-stylesheet"`, which
// already applies nothing whatever `media` says.
(function () {
  var original = window.quartoToggleColorScheme;
  if (typeof original !== "function") return;
  window.quartoToggleColorScheme = function () {
    document
      .querySelectorAll("link.quarto-color-scheme.quarto-color-alternate")
      .forEach(function (sheet) {
        sheet.media = "all";
      });
    var result = original.apply(this, arguments);
    // The <meta name="theme-color"> tag tints the browser chrome (Android
    // Chrome's address + status bars, iOS Safari's top and bottom bars, an
    // installed PWA's title bar). It carries no `media` attribute — the theme
    // is the toggle's choice, not the OS preference — so it has to be
    // rewritten here, or the chrome keeps the color of the theme the visitor
    // just left (#234). Quarto has already flipped body.quarto-dark by now,
    // and both values match --nw-bg in the theme files.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        document.body.classList.contains("quarto-dark") ? "#0b0d12" : "#fcfcfb",
      );
    }
    return result;
  };
})();

// The theme toggle is an <a href="">; stop it from navigating (which jumps to
// the top). When view transitions are available the swap is also wrapped in a
// circular wipe that grows from the toggle itself, so the new theme reads as
// spreading out from the button the visitor just pressed rather than flipping
// the whole page at once.
//
// `window.quartoToggleColorScheme` is the seam Quarto exposes for exactly this
// — it swaps the stylesheets, updates the sentinel in storage, and retints
// giscus, all synchronously. Calling it directly is what makes the wipe
// possible: a view transition's update callback must finish its DOM work
// before the browser is allowed to paint again, so anything deferred to a
// timer or requestAnimationFrame inside it would deadlock (rendering is
// suspended for the duration, so those callbacks never run).
//
// If Quarto ever stops exporting it, the guard below simply falls through to
// the plain toggle with no wipe.
document.addEventListener(
  "click",
  function (e) {
    var toggle = e.target.closest && e.target.closest(".quarto-color-scheme-toggle");
    if (!toggle) return;
    e.preventDefault();

    if (
      !document.startViewTransition ||
      typeof window.quartoToggleColorScheme !== "function" ||
      window.nwReducedMotion()
    ) {
      return;
    }
    // Quarto's own handler must not also fire, or the theme would flip twice
    // and land back where it started.
    e.stopPropagation();

    var root = document.documentElement;
    var box = toggle.getBoundingClientRect();
    root.style.setProperty("--nw-wipe-x", box.left + box.width / 2 + "px");
    root.style.setProperty("--nw-wipe-y", box.top + box.height / 2 + "px");
    // Set before the transition starts so the "before" snapshot is taken with
    // the persistent-chrome names already suppressed — during a theme wipe the
    // navbar and footer have to travel inside the root snapshot, or they would
    // flip to the new theme instantly while the body is still being revealed.
    root.classList.add("nw-theme-wipe");

    var vt = document.startViewTransition(function () {
      window.quartoToggleColorScheme();
    });

    vt.finished
      .catch(function () {})
      .then(function () {
        root.classList.remove("nw-theme-wipe");
      });
  },
  true,
);

// Blog detail pages get a scroll-linked reading-progress bar. The bar and its
// animation are entirely CSS (see "reading progress bar" in site.css) — all
// that is needed here is the hook to scope them to article pages.
if (/^\/blog\/[^/]+\//.test(window.nwPagePath())) {
  document.documentElement.classList.add("nw-post-page");
}

// Shared-element morph across a navigation: the image on a listing card and
// the hero image on the detail page it opens are the same picture, so the
// browser should move the one box rather than cross-fade two copies of it.
//
// Cross-document transitions make this a two-sided handshake — the outgoing
// document names its element during `pageswap`, the incoming one names its
// element during `pagereveal`, and a matching `view-transition-name` on both
// ends is what pairs them up. The name is cleared once the transition
// finishes so a second navigation never inherits a stale one.
(function () {
  if (!("startViewTransition" in document)) return;

  var DETAIL = /^\/(projects|publications|awards|blog)\/[^/]+\//;
  var NAME = "nw-hero-img";
  var CARD = ".nw-proj-wrap, .nw-card, .nw-cite, .nw-post, .nw-award";

  function detailImage() {
    return document.querySelector("img.nw-detail-hero") || document.querySelector("main img");
  }

  // The card in *this* document that links to `path` — i.e. the other end of
  // the navigation. Matching on resolved pathname rather than the raw href
  // keeps this working whether listings emit relative or absolute links.
  function cardImage(path) {
    if (!path) return null;
    var links = document.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var href;
      try {
        href = new URL(links[i].href).pathname;
      } catch {
        continue;
      }
      if (href !== path) continue;
      var img = (links[i].closest(CARD) || links[i]).querySelector("img");
      if (img) return img;
    }
    return null;
  }

  // If this document is the detail page, its hero is the shared element;
  // otherwise it is whichever card points at the detail page on the other
  // side. One rule, and it holds in both directions — forward into a detail
  // page and back out of one.
  function tag(otherPath) {
    var el = DETAIL.test(window.nwPagePath()) ? detailImage() : cardImage(otherPath);
    if (el) el.style.viewTransitionName = NAME;
    return el;
  }

  function pathOf(url) {
    try {
      return new URL(url, location.href).pathname;
    } catch {
      return null;
    }
  }

  window.addEventListener("pageswap", function (e) {
    if (!e.viewTransition || window.nwReducedMotion()) return;
    var to = e.activation && e.activation.entry && e.activation.entry.url;
    // Only the listing↔detail pair morphs. Anything else (nav links, the CV)
    // keeps the plain page cross-fade.
    var path = pathOf(to);
    if (!path || (!DETAIL.test(window.nwStripSitePath(path)) && !DETAIL.test(window.nwPagePath())))
      return;
    tag(path);
  });

  window.addEventListener("pagereveal", function (e) {
    if (!e.viewTransition || window.nwReducedMotion()) return;
    var from =
      window.navigation &&
      window.navigation.activation &&
      window.navigation.activation.from &&
      window.navigation.activation.from.url;
    var path = pathOf(from);
    if (!path || (!DETAIL.test(window.nwStripSitePath(path)) && !DETAIL.test(window.nwPagePath())))
      return;
    var el = tag(path);
    if (!el) return;
    e.viewTransition.finished
      .catch(function () {})
      .then(function () {
        el.style.viewTransitionName = "";
      });
  });
})();

// Detail pages: Quarto points title-block category tags at whichever listing
// the visitor came from (often the home page, where they do nothing). Send
// them to the section listing's filter instead. quarto.js injects its links
// asynchronously after fetching listings.json, so retarget on every DOM
// change to the title block rather than just once at load.
(function () {
  var m = window.nwPagePath().match(/^\/(projects|publications|awards|blog)\//);
  if (!m) return;
  var retarget = function () {
    document.querySelectorAll(".quarto-title .quarto-category").forEach(function (el) {
      var cat = el.textContent.trim();
      var href = window.nwSitePath() + "/" + m[1] + "/#category=" + encodeURIComponent(cat);
      var parent = el.closest("a");
      if (parent) parent.href = href;
      el.querySelectorAll("a").forEach(function (a) {
        a.href = href;
      });
      if (!parent && !el.querySelector("a")) {
        var a = document.createElement("a");
        a.href = href;
        while (el.firstChild) a.appendChild(el.firstChild);
        el.appendChild(a);
      }
    });
  };
  retarget();
  var header = document.getElementById("title-block-header");
  if (header) {
    new MutationObserver(retarget).observe(header, { childList: true, subtree: true });
  }
})();

// CV page: trigger the browser print dialog from the "Print / Save as PDF"
// button. Bound in JS (capture phase) rather than an inline onclick so it
// fires reliably and beats any ancestor <a> that might otherwise navigate.
document.addEventListener(
  "click",
  function (e) {
    var btn = e.target.closest && e.target.closest(".nw-cv-print");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    window.print();
  },
  true,
);

// CV page: defensively unwrap any anchor that ends up wrapping the CV header
// or body, so the top section (name, contact, Print/Résumé buttons) is never
// turned into one giant link.
(function () {
  var cv = document.querySelector(".nw-cv");
  if (!cv) return;
  [cv, cv.querySelector(".nw-cv-header")].forEach(function (el) {
    if (!el) return;
    var a = el.closest("a");
    if (a && a.parentNode) {
      while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a);
      a.parentNode.removeChild(a);
    }
  });
})();

// Skip link: the first tab stop on the page, so a keyboard visitor can jump
// the navbar's nine links, the search button and the theme toggle instead of
// tabbing through all of them on every page.
//
// Injected here rather than written into the templates because Quarto's
// `include-before-body` hook lands *inside* the content wrapper — after the
// header in DOM order, which is exactly where a skip link is useless. This
// runs at the end of the body, early enough that the link is in place well
// before anyone can reach it.
//
// The target is `#quarto-content`, the one content wrapper Quarto emits on
// every layout (the `<main>` element only exists on article and listing
// pages, not on the custom-layout landing page or CV). Focus is moved
// explicitly, with a temporary `tabindex`, because following a fragment link
// to a non-focusable element leaves the keyboard focus behind in several
// browsers — the page scrolls but the next Tab returns to the navbar.
(function () {
  var target = document.getElementById("quarto-content");
  if (!target) return;

  var link = document.createElement("a");
  link.className = "nw-skip";
  link.href = "#quarto-content";
  link.textContent = "Skip to content";
  link.addEventListener("click", function (e) {
    e.preventDefault();
    target.setAttribute("tabindex", "-1");
    target.focus();
    target.addEventListener("blur", function handler() {
      target.removeAttribute("tabindex");
      target.removeEventListener("blur", handler);
    });
  });
  document.body.insertBefore(link, document.body.firstChild);
})();

// Subtle back-to-top button, shown after scrolling down a bit.
(function () {
  var btn = document.createElement("button");
  btn.className = "nw-top";
  btn.type = "button";
  btn.setAttribute("aria-label", "Back to top");
  // The ring is drawn with `pathLength="1"`, so the dash offset is just
  // `1 - progress` and the geometry can change without touching the maths.
  btn.innerHTML =
    '<svg class="nw-top-ring" viewBox="0 0 44 44" aria-hidden="true">' +
    '<circle class="nw-top-ring-bar" cx="22" cy="22" r="21" pathLength="1"/>' +
    "</svg>" +
    '<svg class="nw-top-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  // An explicit `behavior: "smooth"` overrides the CSS `scroll-behavior: auto`
  // set under reduced motion, so check the preference here too (live, rather
  // than cached, so a mid-session change to the setting is respected).
  btn.addEventListener("click", function () {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
  document.body.appendChild(btn);
  // Read scrollY inside rAF so the toggle doesn't force a synchronous reflow
  // mid-scroll (headroom.js invalidates layout in the same scroll events).
  var ticking = false;
  var onScroll = function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - doc.clientHeight;
      var progress = scrollable > 0 ? window.scrollY / scrollable : 0;
      // Clamp: elastic overscroll on iOS reports values outside 0..1.
      progress = Math.max(0, Math.min(1, progress));
      btn.style.setProperty("--nw-top-progress", progress);
      // Short pages (contact, 404) never scroll the flat 600px the long ones
      // did, so the button never appeared there at all. Scale the trigger to
      // whatever scrolling the page actually has instead: a third of the way
      // down on a short page, still 600px on anything long enough for that to
      // be the smaller number.
      var threshold = Math.min(600, scrollable * 0.35);
      btn.classList.toggle("show", scrollable > 0 && window.scrollY > threshold);
      ticking = false;
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  // A resize changes the scrollable distance, so the ring has to be redrawn
  // even when the scroll position itself hasn't moved.
  window.addEventListener("resize", onScroll, { passive: true });
  onScroll();
})();

// Mobile hamburger menu: close after clicking a nav item, when clicking
// outside it, or on Escape — the same dismiss affordance the search overlay
// already has. Escape also returns focus to the toggler, so a keyboard
// visitor lands back on the control they opened the menu with rather than at
// the top of the document.
(function () {
  var collapseEl = document.querySelector(".navbar-collapse");
  var toggler = document.querySelector(".navbar-toggler");
  if (!collapseEl) return;

  function closeMenu(refocus) {
    if (!collapseEl.classList.contains("show")) return;
    if (window.bootstrap && window.bootstrap.Collapse) {
      window.bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false }).hide();
    } else {
      collapseEl.classList.remove("show");
    }
    if (refocus && toggler) toggler.focus();
  }

  collapseEl.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("a")) closeMenu();
  });

  document.addEventListener(
    "click",
    function (e) {
      if (!collapseEl.classList.contains("show")) return;
      if (collapseEl.contains(e.target)) return;
      if (toggler && toggler.contains(e.target)) return;
      closeMenu();
    },
    true,
  );

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    if (!collapseEl.classList.contains("show")) return;
    closeMenu(true);
  });
})();

// Publication detail pages: the auto-generated `description` (a truncated
// abstract, used for SEO/share meta) also renders as the visible subtitle,
// duplicating the "Abstract" section further down the page. Drop it.
(function () {
  if (!/^\/publications\/[^/]+\/(index\.html)?$/.test(window.nwPagePath())) return;
  var sub = document.querySelector("#title-block-header .subtitle");
  if (sub) sub.remove();
})();

// Two accessibility defects in Quarto's own navbar markup, patched here rather
// than by forking the template.
//
//  * The brand logo link is named only by its <img alt>, and the site's CSS
//    hides that image at narrow widths — leaving the link with no accessible
//    name at all on mobile ("Links do not have a discernible name").
//  * The hamburger button carries role="menu", which is not a role a <button>
//    is allowed to take and which overrides its implicit button semantics.
//
// Neither change is visible; both are removed the moment Quarto fixes them
// upstream and this block is deleted.
(function () {
  var brand = document.querySelector("a.navbar-brand-logo");
  if (brand && !brand.getAttribute("aria-label")) {
    var img = brand.querySelector("img[alt]");
    brand.setAttribute("aria-label", (img && img.getAttribute("alt")) || "Home");
  }

  var toggler = document.querySelector("button.navbar-toggler[role='menu']");
  if (toggler) toggler.removeAttribute("role");
})();
