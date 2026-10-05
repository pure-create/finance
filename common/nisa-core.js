"use strict";

/* NISAの投資枠。資産運用・iDeCoの各シミュレーターで共通利用する。
   金額の単位は万円（簿価）。制度改正時はこのファイルだけを更新する。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.NisaRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const NISA_ANNUAL = 360;
  const NISA_LIFETIME = 1800;
  const MINOR_NISA_START_YEAR = 2027;
  const MINOR_NISA_MAX_AGE = 17;
  const MINOR_NISA_ANNUAL = 60;
  const MINOR_NISA_LIFETIME = 600;

  /* 2026年までは18歳未満に新規のNISA枠はない。2027年からは年初時点で
     18歳未満なら未成年者向けのつみたて投資枠を使い、18歳以後は成人向けの
     枠へ自動移行する。 */
  function nisaLimits(year, age) {
    if (age > MINOR_NISA_MAX_AGE) {
      return { annual: NISA_ANNUAL, lifetime: NISA_LIFETIME };
    }
    if (year >= MINOR_NISA_START_YEAR) {
      return { annual: MINOR_NISA_ANNUAL, lifetime: MINOR_NISA_LIFETIME };
    }
    return { annual: 0, lifetime: 0 };
  }

  return {
    NISA_ANNUAL: NISA_ANNUAL,
    NISA_LIFETIME: NISA_LIFETIME,
    MINOR_NISA_START_YEAR: MINOR_NISA_START_YEAR,
    MINOR_NISA_MAX_AGE: MINOR_NISA_MAX_AGE,
    MINOR_NISA_ANNUAL: MINOR_NISA_ANNUAL,
    MINOR_NISA_LIFETIME: MINOR_NISA_LIFETIME,
    nisaLimits: nisaLimits,
  };
});
