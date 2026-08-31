"use strict";

/* 二次相続シミュレーターの計算部分。表示から独立していて、テストからも読み込める
   （資産運用シミュレーターの asset-core.js と同じ切り分け方）。

   金額の単位はすべて万円。 */

/* ---------- 相続税計算（単位:万円） ---------- */
const BRACKETS = [
  [1000, 0.1, 0],
  [3000, 0.15, 50],
  [5000, 0.2, 200],
  [10000, 0.3, 700],
  [20000, 0.4, 1700],
  [30000, 0.45, 2700],
  [60000, 0.5, 4200],
  [Infinity, 0.55, 7200],
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
/* ---------- 小規模宅地等の特例（特定居住用宅地等） ---------- */
const SMALL_LOT_LIMIT = 330; // 限度面積（㎡）
const SMALL_LOT_RATE = 0.8; // 減額割合

/* 自宅の土地の評価額から差し引ける額。
   減額されるのは限度面積までの部分なので、それを超える広さの土地は
   330㎡分だけが対象になる（面積に対する割合で按分する）。 */
function smallLotReduction(landValue, areaSqm) {
  if (!(landValue > 0)) return 0;
  const area = areaSqm > 0 ? areaSqm : SMALL_LOT_LIMIT;
  return landValue * (Math.min(SMALL_LOT_LIMIT, area) / area) * SMALL_LOT_RATE;
}

/* ---------- 生命保険金の非課税枠 ---------- */
const INSURANCE_PER_HEIR = 500; // 法定相続人1人あたりの非課税限度額（万円）

// 死亡保険金のうち課税されない額。限度額は 500万円 × 法定相続人の数
function insuranceExemption(payout, heirs) {
  if (!(payout > 0) || !(heirs > 0)) return 0;
  return Math.min(payout, INSURANCE_PER_HEIR * heirs);
}

// 一次＋二次をまとめて計算
// spDelta: 二次相続までの配偶者資産の増減（万円、負も可）
// years:   一次→二次の経過年数（10以上で相次相続控除なし）
// opts:    課税価格を下げる仕組み。省略すればどちらも適用しない
//   .land      小規模宅地等の特例 { value: 自宅の土地の評価額, area: 面積㎡,
//              first: 一次で適用できるか, second: 二次で適用できるか }
//   .insurance 自分の死亡保険金の額（万円）。非課税枠は一次相続にだけ効く
function simulate(
  assetMe,
  assetSp,
  hasSpouse,
  nChildren,
  spPct,
  spDelta,
  years,
  opts,
) {
  const r = {};
  const land = opts && opts.land;
  const heirs = (hasSpouse ? 1 : 0) + nChildren;

  /* 特例や非課税枠は課税価格を下げるだけで、実際に受け継ぐ財産の額は変わらない。
     そこで税額は「減額後の課税価格」で、手残りや二次の遺産額は
     「減額前の実額」で計算する。
     どちらも遺産総額の内訳なので、2つ合わせても総額を超えないようにする */
  r.cut1 =
    land && land.first
      ? Math.min(smallLotReduction(land.value, land.area), assetMe)
      : 0;
  r.cutIns = Math.min(
    insuranceExemption(opts && opts.insurance, heirs),
    Math.max(0, assetMe - r.cut1),
  );
  r.taxable1 = Math.max(0, assetMe - r.cut1 - r.cutIns);

  r.total1 = totalTax(r.taxable1, hasSpouse, nChildren);
  if (hasSpouse) {
    const spAcq = (assetMe * spPct) / 100; // 配偶者の取得額（減額前の実額）
    const spAcqTax = (r.taxable1 * spPct) / 100; // 配偶者の課税価格
    const statFrac = nChildren > 0 ? 0.5 : 1; // 配偶者の法定相続分
    const spTaxRaw = r.taxable1 > 0 ? (r.total1 * spAcqTax) / r.taxable1 : 0;
    const reliefCap = Math.max(16000, r.taxable1 * statFrac); // 配偶者の税額軽減の上限
    const relief =
      r.taxable1 > 0
        ? (r.total1 * Math.min(spAcqTax, reliefCap)) / r.taxable1
        : 0;
    r.spAcq = spAcq;
    r.spTax = Math.max(0, spTaxRaw - relief);
    r.chTax1 = Math.max(0, r.total1 - spTaxRaw); // 子は残り割合を取得
    r.first = r.spTax + r.chTax1;
    r.estate2 = Math.max(0, assetSp + spAcq - r.spTax + spDelta);

    /* 二次相続にある自宅は、一次で配偶者が取得した割合分だけ。
       取得割合0%なら自宅も配偶者の手には渡らず、二次では特例の対象が無い */
    r.cut2 = 0;
    if (land && land.second) {
      const share = spPct / 100;
      r.cut2 = Math.min(
        smallLotReduction(land.value * share, land.area * share),
        r.estate2,
      );
    }
    r.taxable2 = Math.max(0, r.estate2 - r.cut2);

    const second0 = totalTax(r.taxable2, false, nChildren); // 相次相続控除前
    // 相次相続控除: A×min(C/(B−A),1)×(10−E)/10（A=一次で配偶者が納めた税額,
    // B=一次での取得額, C=二次の遺産額, E=経過年数）。子全員分の合計。
    r.deduct = 0;
    if (years < 10 && r.spTax > 0) {
      const netAcq = spAcq - r.spTax; // B−A
      if (netAcq > 0) {
        r.deduct = Math.min(
          second0,
          (r.spTax * Math.min(r.taxable2 / netAcq, 1) * (10 - years)) / 10,
        );
      }
    }
    r.second = second0 - r.deduct;
    // 子の手取り = 一次での取得分（税引後）＋ 二次の遺産（税引後）
    r.keep = Math.max(0, assetMe - spAcq - r.chTax1 + (r.estate2 - r.second));
  } else {
    r.spAcq = 0;
    r.spTax = 0;
    r.chTax1 = r.total1;
    r.first = r.total1;
    r.estate2 = 0;
    r.second = 0;
    r.deduct = 0;
    r.cut2 = 0;
    r.taxable2 = 0;
    r.keep = Math.max(0, assetMe - r.first);
  }
  r.grand = r.first + r.second;
  return r;
}

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    taxOnShare: taxOnShare,
    totalTax: totalTax,
    simulate: simulate,
    BRACKETS: BRACKETS,
    smallLotReduction: smallLotReduction,
    insuranceExemption: insuranceExemption,
    SMALL_LOT_LIMIT: SMALL_LOT_LIMIT,
    SMALL_LOT_RATE: SMALL_LOT_RATE,
    INSURANCE_PER_HEIR: INSURANCE_PER_HEIR,
  };
}

/* 他の試算ページも同じ相続税の速算表を使えるよう、ブラウザでも明示的に公開する。
   classic script のトップレベル関数に依存しないので、読み込み順が分かりやすい。 */
if (typeof window !== "undefined") {
  window.InheritanceTaxCore = {
    taxOnShare: taxOnShare,
    totalTax: totalTax,
    BRACKETS: BRACKETS,
  };
}
