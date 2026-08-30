"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const gift = require("../gift/js/gift-core.js");
const inheritance = require("../inheritance/js/inheritance-core.js");
const closeTo = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be close to ${expected}`,
  );

test("既定のシミュレーション開始年は実行時の暦年になる", () => {
  const currentYear = new Date().getFullYear();
  assert.equal(gift.SIM_START_YEAR, currentYear);
  const r = gift.simulateScenario({
    estate: 10000,
    children: 1,
    rate: 0,
    years: 1,
    annualGift: 0,
  });
  assert.equal(r.startYear, currentYear);
  assert.equal(r.detail[0].year, currentYear);
});

test("贈与税: 基礎控除と一般・特例税率の早見値", () => {
  for (const [amount, general, special] of [
    [110, 0, 0],
    [200, 9, 9],
    [300, 19, 19],
    [500, 53, 48.5],
    [1000, 231, 177],
  ]) {
    assert.equal(gift.giftTax(amount, "general").tax, general);
    assert.equal(gift.giftTax(amount, "special").tax, special);
  }
});

test("2人から150万円ずつでも、子の年合計300万円に基礎控除を一回だけ使う", () => {
  assert.equal(gift.giftTax(300, "special").tax, 19);
  assert.notEqual(gift.giftTax(150, "special").tax * 2, 19);
});

test("売却益税率は2037年まで20.315%、2038年以後20%", () => {
  assert.equal(gift.capitalGainsTaxRate(2037), 0.20315);
  assert.equal(gift.capitalGainsTaxRate(2038), 0.2);
});

test("贈与税を手取りで用意する売却では譲渡益税分も売却する", () => {
  const r = gift.sellForNetCash(500, 300, 48.5, 2026, true);
  closeTo(r.grossSale - r.capitalGainsTax, 48.5);
  closeTo(r.basisRemaining, 300 * (r.marketRemaining / 500));
  assert.ok(r.capitalGainsTax > 0);
});

test("贈与・相続で取得費を引き継ぎ、最終売却時に全含み益へ課税する", () => {
  const r = gift.simulateScenario({
    startYear: 2037,
    estate: 1000,
    unrealizedGain: 400,
    considerCapitalGainsTax: true,
    children: 1,
    childAges: [20],
    rate: 0,
    years: 1,
    annualGift: 500,
  });
  closeTo(r.capitalGainsTax, 400 * 0.20315);
  closeTo(r.finalKeep + r.taxTotal, 1000);
  closeTo(r.taxTotal, r.giftTax + r.inheritanceTax + r.capitalGainsTax);
});

test("売却益課税を選ばなければ含み益を入力しても従来結果を変えない", () => {
  const input = {
    estate: 10000,
    unrealizedGain: 4000,
    children: 2,
    childAges: [20, 18],
    rate: 5,
    years: 20,
    annualGift: 300,
  };
  const before = gift.simulateScenario(input);
  const unchecked = gift.simulateScenario({
    ...input,
    considerCapitalGainsTax: false,
  });
  assert.equal(unchecked.capitalGainsTax, 0);
  assert.equal(unchecked.taxTotal, before.taxTotal);
  assert.equal(unchecked.finalKeep, before.finalKeep);
});

test("子どもの年齢は各贈与年の1月1日時点で一般・特例を判定する", () => {
  assert.equal(gift.giftCategoryForAge(17), "general");
  assert.equal(gift.giftCategoryForAge(18), "special");
  const r = gift.simulateScenario({
    estate: 10000,
    children: 1,
    childAges: [17],
    rate: 0,
    years: 2,
    annualGift: 500,
  });
  assert.equal(r.detail[0].generalChildren, 1);
  assert.equal(r.detail[0].giftTax, 53);
  assert.equal(r.detail[1].specialChildren, 1);
  assert.equal(r.detail[1].giftTax, 48.5);
  assert.equal(r.giftTax, 101.5);
});

test("年齢が異なる子どもには同じ年でも一般・特例税率を個別適用する", () => {
  const r = gift.simulateScenario({
    estate: 10000,
    children: 2,
    childAges: [17, 18],
    rate: 0,
    years: 1,
    annualGift: 500,
  });
  assert.equal(r.detail[0].generalChildren, 1);
  assert.equal(r.detail[0].specialChildren, 1);
  assert.equal(r.detail[0].giftTax, 53 + 48.5);
});

test("2031年以後: 3年以内は全額、3年超7年以内は合計100万円控除", () => {
  const h = [
    { year: 2030, amount: 50, tax: 0 },
    { year: 2031, amount: 100, tax: 0 },
    { year: 2033, amount: 200, tax: 10 },
    { year: 2034, amount: 300, tax: 20 },
    { year: 2037, amount: 400, tax: 30 },
  ];
  const r = gift.addBackForGifts(h, 2037);
  // 2031〜2037が7年。2035〜2037は全額、2031〜2034は650万円から100万円控除。
  assert.equal(r.added, 400 + (100 + 200 + 300 - 100));
  assert.equal(r.credit, 60);
});

test("年次詳細は相続前贈与加算の対象期間となる最初の年を示す", () => {
  const r = gift.simulateScenario({
    startYear: 2026,
    estate: 30000,
    children: 2,
    childAges: [20, 18],
    rate: 0,
    years: 20,
    annualGift: 200,
  });
  const marked = r.detail.filter((x) => x.event.includes("贈与加算対象↓"));
  assert.equal(marked.length, 1);
  assert.equal(marked[0].year, 2039); // 2045年相続の年単位モデルでは2039〜2045年が7年間
  assert.equal(r.detail.at(-1).event, "相続");
});

test("シミュレーション開始年を変えると年次詳細と年齢判定が連動する", () => {
  const r = gift.simulateScenario({
    startYear: 2027,
    estate: 10000,
    children: 1,
    childAges: [17],
    rate: 0,
    years: 2,
    annualGift: 500,
  });
  assert.deepEqual(
    r.detail.map((x) => x.year),
    [2027, 2028],
  );
  assert.equal(r.detail[0].generalChildren, 1);
  assert.equal(r.detail[1].specialChildren, 1);
});

test("相続税の総額は既存inheritance-coreと一致する", () => {
  const r = gift.settleInheritance(30000, 2, []);
  assert.equal(r.totalBeforeCredits, inheritance.totalTax(30000, false, 2));
});

test("贈与なし・利回り0では、税額以外に資産は増減しない", () => {
  const r = gift.simulateScenario({
    estate: 30000,
    children: 2,
    rate: 0,
    years: 20,
    annualGift: 0,
  });
  assert.equal(r.giftTax, 0);
  assert.equal(r.finalKeep + r.inheritanceTax, 30000);
});

test("長期比較の実効税率は実際の贈与額と相続時の残資産を分母にする", () => {
  const r = gift.simulateScenario({
    estate: 10000,
    children: 2,
    childAges: [20, 18],
    rate: 0,
    years: 20,
    annualGift: 200,
  });
  assert.equal(r.grossTransfer, r.giftTotal + r.detail.at(-1).asset);
  assert.equal(r.effectiveTaxRate, (r.taxTotal / r.grossTransfer) * 100);
  assert.ok(Number.isFinite(r.effectiveTaxRate));
});

test("相続予定資産が不足しても負の資産や負の税額を作らない", () => {
  const r = gift.simulateScenario({
    estate: 2,
    children: 2,
    rate: 0,
    years: 4,
    annualGift: 1000,
  });
  assert.equal(r.shortfall, true);
  for (const y of r.detail) {
    assert.ok(y.asset >= 0 && y.giftTax >= 0);
  }
  assert.ok(r.taxTotal >= 0 && Number.isFinite(r.finalKeep));
});

test("最終手残りのピークが1,000万円超なら次の1,000万円単位まで比較する", () => {
  const r = gift.adaptiveSweep(
    { estate: 30000, children: 2, childAges: [20, 20], rate: 5, years: 20 },
    1000,
    1000,
    10,
  );
  const best = r.reduce((a, x) => (x.finalKeep > a.finalKeep ? x : a));
  assert.equal(best.annual, 1090);
  assert.equal(r.at(-1).annual, 2000);
});
