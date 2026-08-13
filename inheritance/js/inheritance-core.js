'use strict';

/* 二次相続シミュレーターの計算部分。表示から独立していて、テストからも読み込める
   （資産運用シミュレーターの asset-core.js と同じ切り分け方）。

   金額の単位はすべて万円。 */

/* ---------- 相続税計算（単位:万円） ---------- */
const BRACKETS = [
  [1000, .10, 0], [3000, .15, 50], [5000, .20, 200], [10000, .30, 700],
  [20000, .40, 1700], [30000, .45, 2700], [60000, .50, 4200], [Infinity, .55, 7200],
];
function taxOnShare(x) {
  if (x <= 0) return 0;
  for (const [lim, rate, ded] of BRACKETS) if (x <= lim) return x * rate - ded;
}
// 相続税の総額（法定相続分で按分して税率適用）
function totalTax(estate, hasSpouse, nChildren) {
  const heirs = (hasSpouse ? 1 : 0) + nChildren;
  if (heirs === 0) return 0;
  const taxable = Math.max(0, estate - (3000 + 600 * heirs));
  if (taxable === 0) return 0;
  let t = 0;
  if (hasSpouse) {
    if (nChildren > 0) {
      t += taxOnShare(taxable / 2);
      t += taxOnShare(taxable / 2 / nChildren) * nChildren;
    } else {
      t += taxOnShare(taxable);
    }
  } else {
    t += taxOnShare(taxable / nChildren) * nChildren;
  }
  return t;
}
// 一次＋二次をまとめて計算
// spDelta: 二次相続までの配偶者資産の増減（万円、負も可）
// years:   一次→二次の経過年数（10以上で相次相続控除なし）
function simulate(assetMe, assetSp, hasSpouse, nChildren, spPct, spDelta, years) {
  const r = {};
  r.total1 = totalTax(assetMe, hasSpouse, nChildren);
  if (hasSpouse) {
    const spAcq = assetMe * spPct / 100;              // 配偶者の取得額
    const statFrac = nChildren > 0 ? 0.5 : 1;         // 配偶者の法定相続分
    const spTaxRaw = assetMe > 0 ? r.total1 * spAcq / assetMe : 0;
    const reliefCap = Math.max(16000, assetMe * statFrac); // 配偶者の税額軽減の上限
    const relief = assetMe > 0 ? r.total1 * Math.min(spAcq, reliefCap) / assetMe : 0;
    r.spAcq = spAcq;
    r.spTax = Math.max(0, spTaxRaw - relief);
    r.chTax1 = Math.max(0, r.total1 - spTaxRaw);      // 子は残り割合を取得
    r.first = r.spTax + r.chTax1;
    r.estate2 = Math.max(0, assetSp + spAcq - r.spTax + spDelta);
    const second0 = totalTax(r.estate2, false, nChildren); // 相次相続控除前
    // 相次相続控除: A×min(C/(B−A),1)×(10−E)/10（A=一次で配偶者が納めた税額,
    // B=一次での取得額, C=二次の遺産額, E=経過年数）。子全員分の合計。
    r.deduct = 0;
    if (years < 10 && r.spTax > 0) {
      const netAcq = spAcq - r.spTax; // B−A
      if (netAcq > 0) {
        r.deduct = Math.min(second0,
          r.spTax * Math.min(r.estate2 / netAcq, 1) * (10 - years) / 10);
      }
    }
    r.second = second0 - r.deduct;
    // 子の手取り = 一次での取得分（税引後）＋ 二次の遺産（税引後）
    r.keep = Math.max(0, (assetMe - spAcq - r.chTax1) + (r.estate2 - r.second));
  } else {
    r.spAcq = 0; r.spTax = 0;
    r.chTax1 = r.total1;
    r.first = r.total1;
    r.estate2 = 0; r.second = 0; r.deduct = 0;
    r.keep = Math.max(0, assetMe - r.first);
  }
  r.grand = r.first + r.second;
  return r;
}

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { taxOnShare: taxOnShare, totalTax: totalTax, simulate: simulate, BRACKETS: BRACKETS };
}
