'use strict';

/* 贈与税・生前贈与の相続税加算・長期試算。金額の単位はすべて万円。
   制度を更新する際は、下の速算表と addBackForGifts の期間判定を見直す。 */
const GIFT_BASIC_DEDUCTION = 110;
const GIFT_GENERAL_BRACKETS = [
  [200, .10, 0], [300, .15, 10], [400, .20, 25], [600, .30, 65],
  [1000, .40, 125], [1500, .45, 175], [3000, .50, 250], [Infinity, .55, 400]
];
const GIFT_SPECIAL_BRACKETS = [
  [200, .10, 0], [400, .15, 10], [600, .20, 30], [1000, .30, 90],
  [1500, .40, 190], [3000, .45, 265], [4500, .50, 415], [Infinity, .55, 640]
];
const SIM_START_YEAR = 2026;
const OLDER_GIFTS_DEDUCTION = 100;

function finite(v, fallback) { v = Number(v); return Number.isFinite(v) ? v : fallback; }
function positive(v) { return Math.max(0, finite(v, 0)); }
function giftCategoryForAge(age) { return Math.floor(finite(age, 18)) >= 18 ? 'special' : 'general'; }

function giftTax(amount, category) {
  const gross = positive(amount);
  const taxable = Math.max(0, gross - GIFT_BASIC_DEDUCTION);
  const brackets = category === 'general' ? GIFT_GENERAL_BRACKETS : GIFT_SPECIAL_BRACKETS;
  let tax = 0;
  for (const b of brackets) if (taxable <= b[0]) { tax = taxable * b[1] - b[2]; break; }
  return { gross: gross, taxable: taxable, tax: Math.max(0, tax), effectiveRate: gross ? Math.max(0, tax) / gross * 100 : 0 };
}

/* 相続開始年に応じた加算対象。年単位モデルでは相続年・前年・前々年を「3年以内」とする。 */
function addBackForGifts(history, deathYear) {
  const h = Array.isArray(history) ? history : [];
  const year = Math.floor(finite(deathYear, SIM_START_YEAR));
  let all = [], recent = [], older = [];
  if (year <= 2026) all = h.filter(x => x.year >= year - 2 && x.year <= year);
  else if (year <= 2030) all = h.filter(x => x.year >= 2024 && x.year <= year);
  else {
    all = h.filter(x => x.year >= year - 6 && x.year <= year);
    recent = all.filter(x => x.year >= year - 2);
    older = all.filter(x => x.year < year - 2);
  }
  if (year <= 2030) recent = all;
  const sum = list => list.reduce((n, x) => n + positive(x.amount), 0);
  const tax = list => list.reduce((n, x) => n + positive(x.tax), 0);
  const recentAmount = sum(recent), olderAmount = sum(older);
  const added = year >= 2031 ? recentAmount + Math.max(0, olderAmount - OLDER_GIFTS_DEDUCTION) : sum(all);
  /* 暦年贈与の加算分に対応する贈与税額。実際の還付は無いため、相続税額を下限に控除する。 */
  return { added: added, credit: tax(all), recent: recentAmount, older: olderAmount, gifts: all };
}

function inheritanceCore() {
  if (typeof InheritanceTaxCore !== 'undefined') return InheritanceTaxCore;
  if (typeof require === 'function') return require('../../inheritance/js/inheritance-core.js');
  throw new Error('InheritanceTaxCore is required');
}

/* 相続予定資産と生前贈与加算を合わせ、子が均等に取得する相続税を出す。 */
function settleInheritance(estate, nChildren, childAddbacks) {
  estate = positive(estate); nChildren = Math.max(1, Math.floor(finite(nChildren, 1)));
  const addbacks = (childAddbacks || []).map(x => ({ added: positive(x.added), credit: positive(x.credit) }));
  while (addbacks.length < nChildren) addbacks.push({ added: 0, credit: 0 });
  const totalAdd = addbacks.slice(0, nChildren).reduce((n, x) => n + x.added, 0);
  const taxable = estate + totalAdd;
  const core = inheritanceCore();
  const total = core.totalTax(taxable, false, nChildren);
  const childAcq = estate / nChildren;
  const childTaxes = addbacks.slice(0, nChildren).map(x => {
    const raw = taxable ? total * (childAcq + x.added) / taxable : 0;
    return Math.max(0, raw - Math.min(raw, x.credit));
  });
  const childTax = childTaxes.reduce((n, x) => n + x, 0);
  return { taxable, totalBeforeCredits: total, childAcq, childTaxes, childTax,
    totalTax: childTax, totalAdd };
}

function simulateScenario(input) {
  const o = input || {}, children = Math.max(1, Math.min(6, Math.floor(finite(o.children, 2))));
  const years = Math.max(1, Math.min(60, Math.floor(finite(o.years, 20))));
  const rate = Math.max(-.99, Math.min(1, finite(o.rate, 5) / 100));
  const annual = positive(o.annualGift);
  const suppliedAges = Array.isArray(o.childAges) ? o.childAges : [];
  const childAges = Array.from({ length: children }, (_, i) => Math.max(0, Math.min(100, Math.floor(finite(suppliedAges[i], 18)))));
  let asset = positive(o.estate), childGift = 0, giftTotal = 0, giftTaxTotal = 0, shortfall = false;
  const history = Array.from({ length: children }, () => []);
  const detail = [];
  function give(year) {
    const wanted = annual * children;
    const actual = Math.min(asset, wanted);
    if (actual + 1e-9 < wanted) shortfall = true;
    const perChild = actual / children;
    asset -= actual;
    let yearTax = 0, generalChildren = 0, specialChildren = 0;
    for (let i = 0; i < children; i++) {
      const age = childAges[i] + year - SIM_START_YEAR;
      const category = giftCategoryForAge(age);
      const gt = giftTax(perChild, category);
      category === 'special' ? specialChildren++ : generalChildren++;
      history[i].push({ year, amount: perChild, tax: gt.tax, age, category });
      childGift += perChild - gt.tax;
      yearTax += gt.tax;
    }
    giftTotal += actual;
    giftTaxTotal += yearTax;
    return { gross: actual, tax: yearTax, generalChildren, specialChildren };
  }
  let inheritance = null;
  for (let step = 1; step <= years; step++) {
    const year = SIM_START_YEAR + step - 1;
    const g = give(year);
    asset *= 1 + rate;
    childGift *= 1 + rate;
    let event = '';
    if (step === years) {
      inheritance = settleInheritance(asset, children, history.map(h => addBackForGifts(h, year)));
      event = '相続';
    }
    detail.push({ year, asset, gift: g.gross, giftTax: g.tax, childGift,
      generalChildren: g.generalChildren, specialChildren: g.specialChildren, event });
  }
  const inheritanceTax = inheritance.totalTax;
  const inherited = Math.max(0, asset - inheritanceTax);
  return { children, childAges, years, detail, shortfall, giftTotal, giftTax: giftTaxTotal,
    inheritanceTax, taxTotal: giftTaxTotal + inheritanceTax,
    childGift, inherited, finalKeep: childGift + inherited, inheritance };
}

function sweep(input, max, step) {
  max = positive(max == null ? 1000 : max); step = Math.max(1, positive(step == null ? 10 : step));
  const out = []; for (let g = 0; g <= max + 1e-8; g += step) out.push(Object.assign({ annual: g }, simulateScenario(Object.assign({}, input, { annualGift: g }))));
  return out;
}

/* 最適値が比較範囲の右端にある間は、次の区切りまで自動で走査する。
   初年度に全資産を贈与できる金額を超えると結果は同じになるため、そこを探索上限とする。 */
function adaptiveSweep(input, initialMax, block, step) {
  const o = input || {};
  initialMax = Math.max(1, positive(initialMax == null ? 1000 : initialMax));
  block = Math.max(1, positive(block == null ? 1000 : block));
  step = Math.max(1, positive(step == null ? 10 : step));
  const children = Math.max(1, Math.min(6, Math.floor(finite(o.children, 2))));
  const allAssetsGiftedAt = positive(o.estate) / children;
  const relevantMax = Math.max(initialMax, Math.ceil(allAssetsGiftedAt / block) * block);
  let max = Math.min(initialMax, relevantMax), out = [], calculatedMax = -step;
  do {
    for (let g = calculatedMax + step; g <= max + 1e-8; g += step) {
      out.push(Object.assign({ annual: g }, simulateScenario(Object.assign({}, o, { annualGift: g }))));
    }
    calculatedMax = max;
    const bestKeep = out.reduce((a, b) => b.finalKeep > a.finalKeep ? b : a);
    const bestTax = out.reduce((a, b) => b.taxTotal < a.taxTotal ? b : a);
    if ((bestKeep.annual < max && bestTax.annual < max) || max >= relevantMax) break;
    max = Math.min(max + block, relevantMax);
  } while (true);
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { GIFT_BASIC_DEDUCTION, GIFT_GENERAL_BRACKETS, GIFT_SPECIAL_BRACKETS, SIM_START_YEAR, giftCategoryForAge, giftTax, addBackForGifts, settleInheritance, simulateScenario, sweep, adaptiveSweep };
