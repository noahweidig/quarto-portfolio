// Lighthouse against the live site, run weekly by
// .github/workflows/production-audit.yml. Same assertions as the PR config
// (lighthouserc.js) — the point is that production is held to the bar a PR
// is held to, and that there is a trend line for Core Web Vitals over time
// rather than only per-PR snapshots (#256).
const { ASSERTIONS } = require("./lighthouserc.js");

const SITE = process.env.SITE_URL || "https://noahweidig.com/quarto-portfolio";

module.exports = {
  ci: {
    collect: {
      url: [
        `${SITE}/`,
        `${SITE}/cv`,
        `${SITE}/projects`,
        `${SITE}/publications`,
        `${SITE}/blog`,
        `${SITE}/styleguide`,
      ],
    },
    upload: {
      target: "temporary-public-storage",
    },
    assert: {
      assertions: ASSERTIONS,
    },
  },
};
