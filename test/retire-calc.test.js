/* 退職手当の支給率と定年のテスト。
   期待値は制度の規定から手で計算したもので、コードの出力を写したものではない。
   支給率や定年の引き上げ方を改正で直したときは、まずここの数字を直すこと。

   退職所得控除・所得税・住民税は common/tax-core.js へ移したので、
   その中身は test/tax-core.test.js が見る。ここでは最後に、
   支給率と税額を通した「支給額の目安」だけを突き合わせている。

   実行: npm test   （プロジェクト直下から） */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  own_rate,
  compulsory_rate,
  getRate,
  teinenAge,
} = require("../retirement/js/retire-calc.js");
const { retireDeduction, calcTax } = require("../common/tax-core.js");

test("支給率の表は0〜50年の51個ある", () => {
  assert.strictEqual(own_rate.length, 51, "自己都合");
  assert.strictEqual(compulsory_rate.length, 51, "定年・勧奨");
});

test("支給率は勤続年数が延びても下がらない", () => {
  for (let y = 1; y < own_rate.length; y++) {
    assert.ok(
      own_rate[y] >= own_rate[y - 1],
      "自己都合 " + y + "年で支給率が下がっている",
    );
    assert.ok(
      compulsory_rate[y] >= compulsory_rate[y - 1],
      "定年勧奨 " + y + "年で支給率が下がっている",
    );
  }
});

test("支給率は同じ勤続年数なら定年・勧奨のほうが手厚い", () => {
  for (let y = 0; y < own_rate.length; y++) {
    assert.ok(
      compulsory_rate[y] >= own_rate[y],
      y + "年で自己都合のほうが高い",
    );
  }
});

test("支給率の上限は47.709で頭打ち", () => {
  assert.strictEqual(own_rate[own_rate.length - 1], 47.709);
  assert.strictEqual(compulsory_rate[compulsory_rate.length - 1], 47.709);
  // 定年・勧奨は35年で、自己都合は43年で上限に達する
  assert.strictEqual(compulsory_rate[35], 47.709);
  assert.ok(compulsory_rate[34] < 47.709);
  assert.strictEqual(own_rate[43], 47.709);
  assert.ok(own_rate[42] < 47.709);
});

test("getRate：表の範囲外は端の値に丸める", () => {
  assert.strictEqual(getRate(own_rate, 0), own_rate[0]);
  assert.strictEqual(getRate(own_rate, -5), own_rate[0], "負の年数");
  assert.strictEqual(getRate(own_rate, 50), 47.709);
  assert.strictEqual(getRate(own_rate, 99), 47.709, "表を超える年数");
});

test("定年年齢：2023年度から2年に1歳ずつ65歳まで", () => {
  assert.strictEqual(teinenAge(2022), 60, "引き上げ前");
  assert.strictEqual(teinenAge(2023), 61);
  assert.strictEqual(teinenAge(2024), 61);
  assert.strictEqual(teinenAge(2025), 62);
  assert.strictEqual(teinenAge(2026), 62);
  assert.strictEqual(teinenAge(2027), 63);
  assert.strictEqual(teinenAge(2029), 64);
  assert.strictEqual(teinenAge(2031), 65, "65歳に到達");
  assert.strictEqual(teinenAge(2033), 65, "65歳で頭打ち");
  assert.strictEqual(teinenAge(2050), 65);
});

/* 所得税は最後に復興特別所得税ぶんの1.021を掛けて切り捨てるため、
   二進小数の丸めで手計算より1円小さくなることがある。1円までは許容する
   （同じ断りが test/tax-core.test.js にもある） */
function taxNear(actual, expected, msg) {
  assert.ok(
    Math.abs(actual - expected) <= 1,
    (msg || "") + " 期待 " + expected + "円 / 実際 " + actual + "円",
  );
}

test("支給額の目安：勤続35年・給料月額40万円の定年退職", () => {
  // 40万円 × 47.709 ＝ 19,083,600円
  const price = Math.floor(400000 * getRate(compulsory_rate, 35));
  assert.strictEqual(price, 19083600);
  // 退職所得控除 800万＋(35−20)×70万 ＝ 1,850万円
  const koujo = retireDeduction(35);
  assert.strictEqual(koujo, 18500000);
  // 控除超過 583,600円 → 退職所得 291,800 → 切り捨てて291,000円
  const t = calcTax(price, koujo);
  assert.strictEqual(t.inhabitTax, 29100);
  // 291,000×5%×1.021 ＝ 14,855.55 → 14,855
  taxNear(t.tax, 14855, "所得税");
});
