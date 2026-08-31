/* iDeCoの計算のテスト。
   期待値は制度の規定と速算表から手で計算したもので、コードの出力を写したものではない。
   拠出限度額や重複期間のルールを改正で直したときは、まずここの数字を直すこと。

   実行: npm test   （プロジェクト直下から） */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const tax = require("../common/tax-core.js");
const {
  contributionLimit,
  joinAgeLimit,
  taxSaving,
  accumulate,
  overlapYears,
  adjustedDeduction,
  lumpSumTax,
  retireOnlyTax,
  annuityPayment,
  annuityTax,
  compare,
  mixTax,
  bestMix,
  MIX_STEPS,
  taxableAccountTax,
  TAXABLE_GAIN_TAX_RATE,
  LIMIT_REFORM_YEAR,
  JOIN_AGE_LIMIT,
  PAYOUT_AGE_MIN,
  PAYOUT_AGE_MAX,
  earliestPayoutAge,
  PAYOUT_START_BY_PERIOD,
  LATE_JOIN_AGE,
  LATE_JOIN_WAIT,
  OVERLAP_YEARS_IDECO_FIRST,
  OVERLAP_YEARS_RETIRE_FIRST,
  NATIONAL_PENSION_END_AGE,
  LATE_JOIN_CATEGORY_LIMIT,
  PUBLIC_PENSION_START_AGE,
  PUBLIC_PENSION_MIN_AGE,
  PUBLIC_PENSION_MAX_AGE,
  publicPensionRate,
} = require("../ideco/js/ideco-core.js");

// 所得税は1.021を掛けて切り捨てるので、二進小数の丸めで1円ずれることがある
function near(actual, expected, tol, msg) {
  assert.ok(
    Math.abs(actual - expected) <= (tol === undefined ? 1 : tol),
    (msg || "") + " 期待 " + expected + " / 実際 " + actual,
  );
}

/* ---------- 拠出限度額 ---------- */

test("改正は2027年拠出分から効く", () => {
  assert.strictEqual(LIMIT_REFORM_YEAR, 2027);
});

test("拠出限度額：2026年までは現行の額", () => {
  assert.strictEqual(contributionLimit("self", 2026, 0, 40), 68000, "第1号");
  assert.strictEqual(
    contributionLimit("employee", 2026, 0, 40),
    23000,
    "企業年金なし",
  );
  assert.strictEqual(
    contributionLimit("corporate", 2026, 0, 40),
    20000,
    "企業年金あり",
  );
  assert.strictEqual(
    contributionLimit("publicSv", 2026, 0, 40),
    20000,
    "公務員",
  );
  assert.strictEqual(contributionLimit("spouse", 2026, 0, 40), 23000, "第3号");
});

test("拠出限度額：2027年からは改正後の額", () => {
  assert.strictEqual(contributionLimit("self", 2027, 0, 40), 75000, "第1号");
  assert.strictEqual(
    contributionLimit("employee", 2027, 0, 40),
    62000,
    "企業年金なし",
  );
  assert.strictEqual(
    contributionLimit("corporate", 2027, 0, 40),
    62000,
    "企業年金あり",
  );
  assert.strictEqual(
    contributionLimit("publicSv", 2027, 0, 40),
    62000,
    "公務員",
  );
  assert.strictEqual(
    contributionLimit("spouse", 2027, 0, 40),
    23000,
    "第3号は変わらない",
  );
});

test("拠出限度額：改正後の第2号は他制度の掛金を差し引いた残り", () => {
  assert.strictEqual(
    contributionLimit("employee", 2027, 20000, 40),
    42000,
    "62,000−20,000",
  );
  assert.strictEqual(
    contributionLimit("corporate", 2027, 62000, 40),
    0,
    "使い切っていれば0",
  );
  assert.strictEqual(
    contributionLimit("corporate", 2027, 80000, 40),
    0,
    "超えてもマイナスにしない",
  );
  // 改正前は他制度の額を引く仕組みではない
  assert.strictEqual(
    contributionLimit("employee", 2026, 20000, 40),
    23000,
    "改正前は差し引かない",
  );
  // 第1号・第3号は他制度と枠を分け合わない
  assert.strictEqual(
    contributionLimit("self", 2027, 30000, 40),
    75000,
    "第1号は差し引かない",
  );
  assert.strictEqual(
    contributionLimit("spouse", 2027, 30000, 40),
    23000,
    "第3号は差し引かない",
  );
});

test("拠出限度額：知らない区分は0", () => {
  assert.strictEqual(contributionLimit("unknown", 2027, 0, 40), 0);
});

test("拠出限度額：第1号・第3号は60歳で国民年金の被保険者でなくなる", () => {
  /* 第1号・第3号は20歳以上60歳未満。現行制度では60歳以降は拠出できない。
	   改正後は「60歳以上70歳未満で国民年金の被保険者でない人」＝第5号加入者として、
	   第2号と同じ月6.2万円の枠になる（第3号の2.3万円が続くのではない） */
  assert.strictEqual(NATIONAL_PENSION_END_AGE, 60);
  assert.strictEqual(LATE_JOIN_CATEGORY_LIMIT, 62000);

  assert.strictEqual(
    contributionLimit("self", 2026, 0, 59),
    68000,
    "59歳は第1号のまま",
  );
  assert.strictEqual(
    contributionLimit("self", 2026, 0, 60),
    0,
    "60歳からは拠出できない",
  );
  assert.strictEqual(
    contributionLimit("spouse", 2026, 0, 59),
    23000,
    "59歳は第3号のまま",
  );
  assert.strictEqual(
    contributionLimit("spouse", 2026, 0, 60),
    0,
    "60歳からは拠出できない",
  );

  assert.strictEqual(
    contributionLimit("self", 2027, 0, 60),
    62000,
    "改正後は第5号として6.2万円",
  );
  assert.strictEqual(
    contributionLimit("spouse", 2027, 0, 60),
    62000,
    "第3号だった人も6.2万円",
  );
  assert.strictEqual(
    contributionLimit("self", 2027, 0, 59),
    75000,
    "59歳まではこれまでどおり",
  );
});

test("拠出限度額：第2号は厚生年金の被保険者なので60歳で変わらない", () => {
  for (const cat of ["employee", "corporate", "publicSv"]) {
    assert.strictEqual(
      contributionLimit(cat, 2026, 0, 62),
      contributionLimit(cat, 2026, 0, 40),
      cat + "（現行）",
    );
    assert.strictEqual(
      contributionLimit(cat, 2027, 0, 62),
      contributionLimit(cat, 2027, 0, 40),
      cat + "（改正後）",
    );
  }
});

test("積立：第3号は60歳で拠出が止まり、改正後は第5号として続く", () => {
  // 2026年に59歳。60歳になる2027年は改正後なので、第5号として拠出できる
  const a = accumulate(
    Object.assign({}, baseAcc, {
      startAge: 59,
      payAge: 63,
      startYear: 2026,
      category: "spouse",
      monthly: 30000,
    }),
    tax,
  );
  assert.strictEqual(a.rows[0].limit, 23000, "59歳（2026年）は第3号の2.3万円");
  assert.strictEqual(
    a.rows[0].contribution,
    23000 * 12,
    "上限までしか出せない",
  );
  assert.strictEqual(
    a.rows[1].limit,
    62000,
    "60歳（2027年）からは第5号の6.2万円",
  );
  assert.strictEqual(a.rows[1].contribution, 30000 * 12, "希望額が枠に収まる");
});

test("積立：現行制度のうちは、第1号・第3号は60歳で拠出が止まる", () => {
  // 2026年に60歳。改正前なので、この年は拠出できない
  const a = accumulate(
    Object.assign({}, baseAcc, {
      startAge: 60,
      payAge: 62,
      startYear: 2026,
      category: "self",
    }),
    tax,
  );
  assert.strictEqual(a.rows[0].limit, 0, "60歳（2026年）は拠出できない");
  assert.strictEqual(a.rows[0].contribution, 0);
  assert.strictEqual(a.rows[0].saving, 0, "拠出していないので節税もない");
  assert.strictEqual(a.rows[1].limit, 62000, "61歳（2027年）からは第5号");
});

test("加入できる年齢の上限は改正で65歳未満から70歳未満へ", () => {
  assert.strictEqual(JOIN_AGE_LIMIT.current, 65);
  assert.strictEqual(JOIN_AGE_LIMIT.reformed, 70);
  assert.strictEqual(joinAgeLimit(2026), 65);
  assert.strictEqual(joinAgeLimit(2027), 70);
});

test("受給を始められる年齢は60歳から75歳", () => {
  assert.strictEqual(PAYOUT_AGE_MIN, 60);
  assert.strictEqual(PAYOUT_AGE_MAX, 75);
});

/* ---------- 入口：節税額 ---------- */

test("節税額：掛金を引く前後の税額の差で出す", () => {
  // 課税所得400万円（20%の区分）、掛金 月2.3万円＝年27.6万円
  //   所得税 (4,000,000×20%−427,500)×1.021 ＝ 372,500×1.021 ＝ 380,322.5 → 380,322
  //   引いた後 3,724,000 → (744,800−427,500)×1.021 ＝ 317,300×1.021 ＝ 323,963.3 → 323,963
  //   差 56,359 ／ 住民税 400,000−372,400 ＝ 27,600
  const s = taxSaving(4000000, 276000, tax);
  near(s.income, 56359, 2, "所得税の節税");
  assert.strictEqual(s.inhabitant, 27600, "住民税の節税");
  near(s.total, 83959, 2, "合計");
});

test("節税額：区分をまたぐと「税率×掛金」とは一致しない", () => {
  /* 課税所得340万円（20%の区分）から27.6万円引くと312.4万円で、10%の区分に落ちる。
	     所得税 (680,000−427,500)×1.021 ＝ 252,500×1.021 ＝ 257,802.5 → 257,802
	     引いた後 (312,400−97,500)×1.021 ＝ 214,900×1.021 ＝ 219,412.9 → 219,412
	     差 38,390
	   「税率20%×掛金」で出すと 276,000×0.20×1.021 ＝ 56,359 になり、大きく違う */
  const s = taxSaving(3400000, 276000, tax);
  near(s.income, 38390, 2, "区分をまたぐ場合の所得税の節税");
  assert.ok(
    s.income < 276000 * 0.2 * 1.021 - 10000,
    "税率×掛金より小さくなっているはず",
  );
  assert.strictEqual(s.inhabitant, 27600);
});

test("節税額：課税所得が掛金に満たなくてもマイナスにならない", () => {
  const s = taxSaving(100000, 276000, tax);
  assert.ok(s.income >= 0 && s.inhabitant >= 0);
  assert.ok(s.total >= 0);
});

test("節税額：課税所得0なら節税もなし", () => {
  const s = taxSaving(0, 276000, tax);
  assert.strictEqual(s.total, 0);
});

/* ---------- 積立 ---------- */

const baseAcc = {
  startAge: 40,
  payAge: 45,
  startYear: 2026,
  category: "employee",
  monthly: 23000,
  otherPlanMonthly: 0,
  yieldRate: 0,
  taxableIncome: 4000000,
  initialBalance: 0,
};

test("積立：利回り0なら拠出額がそのまま積み上がる", () => {
  const a = accumulate(baseAcc, tax);
  assert.strictEqual(a.rows.length, 5, "40歳から45歳までの5年");
  assert.strictEqual(a.paid, 276000 * 5);
  assert.strictEqual(a.balance, 276000 * 5);
  assert.strictEqual(a.gain, 0, "利回り0なら運用益なし");
});

test("積立：節税額も年ごとに積み上がる", () => {
  const a = accumulate(baseAcc, tax);
  near(a.saved, 83959 * 5, 10, "5年分の節税額");
});

test("積立：掛金は年の真ん中に入れ、その年は半年分の利回りが付く", () => {
  /* 掛金は毎月払うので、年初に一括で入れて1年分の利回りを付けると多く出すぎる。
	   1年目の掛金は 1.03^4.5、2年目は 1.03^3.5、…と半年ぶん短く回る */
  const a = accumulate(Object.assign({}, baseAcc, { yieldRate: 3 }), tax);
  let expected = 0;
  for (let i = 1; i <= 5; i++) expected += 276000 * Math.pow(1.03, i - 0.5);
  near(a.balance, expected, 1e-6, "5年後の残高");
  assert.ok(a.gain > 0, "運用益が出ている");
});

test("積立：もとからある残高には1年分の利回りが付く", () => {
  // 拠出0・利回り10%・1年 → 100万円がそのまま110万円になる
  const a = accumulate(
    Object.assign({}, baseAcc, {
      payAge: 41,
      monthly: 0,
      yieldRate: 10,
      initialBalance: 1000000,
    }),
    tax,
  );
  near(a.balance, 1100000, 1e-6);
});

test("積立：今ある残高の元本を入れると、差が含み益として運用益に入る", () => {
  /* 拠出0・利回り10%・1年。残高100万円のうち元本60万円なら、
	   含み益40万円＋その年の運用益10万円で、運用益は50万円になる */
  const a = accumulate(
    Object.assign({}, baseAcc, {
      payAge: 41,
      monthly: 0,
      yieldRate: 10,
      initialBalance: 1000000,
      initialPaid: 600000,
    }),
    tax,
  );
  near(a.balance, 1100000, 1e-6, "残高は元本の入力で変わらない");
  assert.strictEqual(a.initialPaid, 600000, "元本");
  assert.strictEqual(a.initialGain, 400000, "含み益");
  near(a.gain, 500000, 1e-6, "含み益を含む運用益");
});

test("積立：元本が未入力なら、残高すべてを元本として扱う", () => {
  const over = {
    payAge: 41,
    monthly: 0,
    yieldRate: 10,
    initialBalance: 1000000,
  };
  const noPaid = accumulate(Object.assign({}, baseAcc, over), tax);
  const zeroPaid = accumulate(
    Object.assign({}, baseAcc, over, { initialPaid: 0 }),
    tax,
  );
  for (const [a, name] of [
    [noPaid, "未指定"],
    [zeroPaid, "0を指定"],
  ]) {
    assert.strictEqual(
      a.initialPaid,
      1000000,
      name + "：元本が残高と一致しない",
    );
    assert.strictEqual(a.initialGain, 0, name + "：含み益が出ている");
    near(a.gain, 100000, 1e-6, name + "：運用益がその年の分だけになっていない");
  }
});

test("積立：残高が無ければ、元本の入力は無視する", () => {
  /* 画面は残高を0にすると元本の欄を隠すが、値は残ったまま保存や共有URLに乗る。
	   残高に無い元本を引くと、運用益がマイナスに振れて内訳も比較も狂う */
  const a = accumulate(
    Object.assign({}, baseAcc, { yieldRate: 3, initialPaid: 3000000 }),
    tax,
  );
  const plain = accumulate(Object.assign({}, baseAcc, { yieldRate: 3 }), tax);
  assert.strictEqual(a.initialPaid, 0, "元本");
  assert.strictEqual(a.initialGain, 0, "含み益");
  near(a.gain, plain.gain, 1e-6, "運用益が元本の入力で変わっている");
  assert.ok(a.gain > 0, "運用益がマイナスに振れている：" + a.gain);
});

test("積立：元本が残高を上回るなら、含み損として運用益から引く", () => {
  // 残高100万円・元本120万円（含み損20万円）。1年で10万円増えても運用益はマイナス
  const a = accumulate(
    Object.assign({}, baseAcc, {
      payAge: 41,
      monthly: 0,
      yieldRate: 10,
      initialBalance: 1000000,
      initialPaid: 1200000,
    }),
    tax,
  );
  assert.strictEqual(a.initialGain, -200000, "含み損");
  near(a.gain, -100000, 1e-6, "運用益");
  // 課税口座なら、含み損のうちは売っても税金がかからない
  assert.strictEqual(taxableAccountTax(a.gain), 0);
});

test("積立：毎月ずつ積み上げた場合とほぼ一致する", () => {
  /* 年の真ん中に置くのは、毎月の積み上げの近似として妥当かの確認。
	   利回りが高いほど差は開くが、8%でも0.5%は超えない */
  for (const rate of [1, 3, 5, 8]) {
    const a = accumulate(
      Object.assign({}, baseAcc, { payAge: 65, yieldRate: rate }),
      tax,
    );
    let monthly = 0;
    const mr = Math.pow(1 + rate / 100, 1 / 12) - 1;
    for (let m = 0; m < 25 * 12; m++) monthly = (monthly + 23000) * (1 + mr);
    const diff = Math.abs(a.balance / monthly - 1);
    assert.ok(
      diff < 0.005,
      "利回り" + rate + "%で差が " + (diff * 100).toFixed(2) + "%",
    );
    assert.ok(
      a.balance < monthly,
      "毎月より少なめ（多く見せない側）に出るはず",
    );
  }
});

test("積立：限度額を超える掛金は限度額まで", () => {
  // 2026年は企業年金なしで月2.3万円が上限。月5万円と入れても2.3万円で頭打ち
  const a = accumulate(
    Object.assign({}, baseAcc, { monthly: 50000, payAge: 41 }),
    tax,
  );
  assert.strictEqual(a.rows[0].contribution, 23000 * 12);
  assert.strictEqual(a.rows[0].limit, 23000);
});

test("積立：2027年をまたぐと限度額が上がる", () => {
  const a = accumulate(
    Object.assign({}, baseAcc, { monthly: 50000, payAge: 43 }),
    tax,
  );
  assert.strictEqual(a.rows[0].year, 2026);
  assert.strictEqual(a.rows[0].limit, 23000, "2026年は現行");
  assert.strictEqual(a.rows[1].year, 2027);
  assert.strictEqual(a.rows[1].limit, 62000, "2027年から改正後");
  assert.strictEqual(a.rows[1].contribution, 50000 * 12, "希望額が枠に収まる");
});

test("積立：加入できる年齢を過ぎたら拠出は止まるが運用は続く", () => {
  // 2020年に63歳。65歳になる2022年から拠出できない（当時の上限は65歳未満）
  const a = accumulate(
    Object.assign({}, baseAcc, {
      startAge: 63,
      payAge: 70,
      startYear: 2020,
      yieldRate: 0,
    }),
    tax,
  );
  assert.strictEqual(a.rows.length, 7);
  assert.strictEqual(a.rows[0].contribution, 276000, "63歳は拠出できる");
  assert.strictEqual(a.rows[1].contribution, 276000, "64歳は拠出できる");
  assert.strictEqual(a.rows[2].contribution, 0, "65歳からは拠出できない");
  assert.strictEqual(
    a.rows[6].contribution,
    0,
    "69歳（2026年）もまだ65歳未満の制限",
  );
  assert.strictEqual(a.paid, 276000 * 2);
});

test("積立：改正後は69歳まで拠出できる", () => {
  const a = accumulate(
    Object.assign({}, baseAcc, {
      startAge: 63,
      payAge: 70,
      startYear: 2027,
      yieldRate: 0,
    }),
    tax,
  );
  assert.strictEqual(a.rows.length, 7);
  for (const row of a.rows) {
    assert.ok(
      row.contribution > 0,
      row.age + "歳（" + row.year + "年）で拠出できていない",
    );
  }
});

/* ---------- 出口：重複期間 ---------- */

test("重複期間：重なった年数を1年未満切り捨てで返す", () => {
  // iDeCo 40〜65歳、勤続 22〜60歳 → 重なりは40〜60の20年
  assert.strictEqual(overlapYears(40, 65, 22, 60), 20);
  // 完全に含まれる
  assert.strictEqual(overlapYears(30, 60, 22, 65), 30);
  // 端が接するだけなら0
  assert.strictEqual(overlapYears(60, 70, 22, 60), 0);
  // まったく重ならない
  assert.strictEqual(overlapYears(60, 70, 22, 55), 0);
  // 端数は切り捨て
  assert.strictEqual(overlapYears(40, 60.9, 22, 60.5), 20);
});

test("調整後の控除：自分の年数の控除から重複年数の控除を引く", () => {
  // 勤続38年 2,060万円 − 重複20年 800万円 ＝ 1,260万円
  assert.strictEqual(adjustedDeduction(38, 20, tax), 12600000);
  // 重複なしなら満額
  assert.strictEqual(adjustedDeduction(38, 0, tax), tax.retireDeduction(38));
});

test("調整後の控除：重複が1年なら引くのは40万円", () => {
  /* 引く側に80万円の最低保障を効かせない。効かせると、重複0年→1年で
	   いきなり80万円減り、1年→2年では変わらないという段差ができてしまう */
  assert.strictEqual(
    adjustedDeduction(6, 1, tax),
    2400000 - 400000,
    "加入6年・重複1年",
  );
  assert.strictEqual(
    adjustedDeduction(6, 2, tax),
    2400000 - 800000,
    "重複2年で80万円",
  );
  // 重複が1年増えるごとに40万円ずつ減っていく
  assert.strictEqual(
    adjustedDeduction(25, 0, tax) - adjustedDeduction(25, 1, tax),
    400000,
  );
  assert.strictEqual(
    adjustedDeduction(25, 1, tax) - adjustedDeduction(25, 2, tax),
    400000,
  );
});

test("調整後の控除：マイナスにはならない", () => {
  assert.strictEqual(adjustedDeduction(3, 40, tax), 0);
  assert.ok(adjustedDeduction(20, 20, tax) >= 0);
});

test("重複期間の対象は、受取順で9年と19年", () => {
  assert.strictEqual(OVERLAP_YEARS_IDECO_FIRST, 9, "iDeCoが先→退職金が後");
  assert.strictEqual(OVERLAP_YEARS_RETIRE_FIRST, 19, "退職金が先→iDeCoが後");
});

/* ---------- 出口：一時金 ---------- */

// 退職金2,000万円・22歳就職60歳退職／iDeCo 1,000万円・40歳加入
const lumpBase = {
  idecoAmount: 10000000,
  idecoJoinAge: 40,
  idecoPayAge: 65,
  retireAmount: 20000000,
  hireAge: 22,
  retireAge: 60,
};

test("一時金：退職金が先なら、19年内はiDeCo側の控除が削られる", () => {
  /* 60歳で退職金 → 65歳でiDeCo（間隔5年 ≤ 19年）
	     iDeCoの加入年数25年 → 控除1,150万円
	     重複20年ぶん 800万円を引いて 350万円
	     退職所得 (1,000万−350万)÷2 ＝ 325万円
	       所得税 (325万×10%−97,500)×1.021 ＝ 227,500×1.021 ＝ 232,277.5 → 232,277
	       住民税 325,000
	     退職金は勤続38年で控除2,060万円 → 2,000万円以下なので非課税 */
  const r = lumpSumTax(lumpBase, tax);
  assert.strictEqual(r.gap, 5);
  assert.strictEqual(r.adjusted, "ideco", "iDeCo側が調整される");
  assert.strictEqual(r.overlap, 20);
  assert.strictEqual(r.ideco.deduction, 3500000);
  near(r.ideco.tax, 232277, 2, "iDeCoの所得税");
  assert.strictEqual(r.ideco.inhabitTax, 325000, "iDeCoの住民税");
  assert.strictEqual(r.retire.tax, 0, "退職金は控除以下で非課税");
  near(r.tax, 557277, 2, "税額の合計");
  near(r.net, 30000000 - 557277, 2, "手取り");
});

test("一時金：iDeCoが先で10年以上空けば調整されない", () => {
  /* 60歳でiDeCo → 70歳で退職金（間隔10年 > 9年）
	     iDeCoの加入年数20年 → 控除800万円（満額）
	     退職所得 (1,000万−800万)÷2 ＝ 100万円
	       所得税 100万×5%×1.021 ＝ 51,050 ／ 住民税 100,000 */
  const r = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 70 }),
    tax,
  );
  assert.strictEqual(r.gap, -10);
  assert.strictEqual(r.adjusted, null, "調整なし");
  assert.strictEqual(r.overlap, 0);
  assert.strictEqual(r.ideco.deduction, 8000000, "満額の控除");
  near(r.ideco.tax, 51050, 2);
  assert.strictEqual(r.ideco.inhabitTax, 100000);
  near(r.tax, 151050, 2);
});

test("一時金：iDeCoが先でも9年内なら退職金側の控除が削られる", () => {
  /* 61歳でiDeCo → 70歳で退職金（間隔9年 ≤ 9年）
	     重複は40〜61歳の21年
	     iDeCo 加入21年 → 控除870万円（満額）
	       退職所得 (1,000万−870万)÷2 ＝ 65万円
	       所得税 65万×5%×1.021 ＝ 33,182.5 → 33,182 ／ 住民税 65,000
	     退職金 勤続48年 2,760万円 − 重複21年 870万円 ＝ 1,890万円
	       退職所得 (2,000万−1,890万)÷2 ＝ 55万円
	       所得税 55万×5%×1.021 ＝ 28,077.5 → 28,077 ／ 住民税 55,000 */
  const r = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 61, retireAge: 70 }),
    tax,
  );
  assert.strictEqual(r.gap, -9);
  assert.strictEqual(r.adjusted, "retire", "退職金側が調整される");
  assert.strictEqual(r.overlap, 21);
  assert.strictEqual(r.ideco.deduction, 8700000);
  assert.strictEqual(r.retire.deduction, 18900000);
  near(r.ideco.tax, 33182, 2);
  near(r.retire.tax, 28077, 2);
  near(r.tax, 33182 + 65000 + 28077 + 55000, 3, "税額の合計");
});

test("一時金：10年ルールの崖（1年ずらすと税額が跳ねる）", () => {
  const noAdjust = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 70 }),
    tax,
  );
  const adjusted = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 61, retireAge: 70 }),
    tax,
  );
  assert.ok(
    adjusted.tax > noAdjust.tax,
    "9年内に入ると税額が増えるはず（" +
      noAdjust.tax +
      " → " +
      adjusted.tax +
      "）",
  );
  assert.ok(noAdjust.net > adjusted.net, "手取りは10年空けたほうが多い");
});

test("一時金：同じ年に受け取ると合算して1回ぶんの控除になる", () => {
  /* 60歳で両方
	     通算の勤続年数 20＋38−20 ＝ 38年 → 控除2,060万円
	     退職所得 (3,000万−2,060万)÷2 ＝ 470万円
	       所得税 (470万×20%−427,500)×1.021 ＝ 512,500×1.021 ＝ 523,262.5 → 523,262
	       住民税 470,000 */
  const r = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 60 }),
    tax,
  );
  assert.strictEqual(r.gap, 0);
  assert.strictEqual(r.sameYear, true);
  assert.strictEqual(r.combined.deduction, 20600000);
  near(r.combined.tax, 523262, 2);
  assert.strictEqual(r.combined.inhabitTax, 470000);
  near(r.tax, 993262, 2);
});

test("一時金：同じ年より、ずらしたほうが有利になる場合がある", () => {
  const same = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 60 }),
    tax,
  );
  const apart = lumpSumTax(lumpBase, tax); // 退職金60歳・iDeCo65歳
  assert.ok(apart.tax < same.tax, "ずらしたほうが税額が小さいはず");
});

test("一時金：退職金が無ければiDeCoだけを普通に計算する", () => {
  // 加入25年 → 控除1,150万円 ＞ 1,000万円 なので非課税
  const r = lumpSumTax(Object.assign({}, lumpBase, { retireAmount: 0 }), tax);
  assert.strictEqual(r.ideco.deduction, tax.retireDeduction(25));
  assert.strictEqual(r.tax, 0);
  assert.strictEqual(r.net, 10000000);
});

test("一時金：加入5年以下は短期退職手当等になる", () => {
  /* 62歳加入・67歳受取（加入5年）・800万円
	     控除 5年×40万 ＝ 200万円 → 残額600万円
	     300万円までは半分の150万円、超えた300万円はそのまま ＝ 450万円
	       所得税 (450万×20%−427,500)×1.021 ＝ 472,500×1.021 ＝ 482,422.5 → 482,422
	       住民税 450,000
	   半分にするだけなら退職所得300万円で、税額は 506,752円 にしかならない */
  const short = lumpSumTax(
    {
      idecoAmount: 8000000,
      idecoJoinAge: 62,
      idecoPayAge: 67,
      retireAmount: 0,
      hireAge: 22,
      retireAge: 60,
    },
    tax,
  );
  assert.strictEqual(short.idecoYears, 5);
  assert.strictEqual(short.ideco.deduction, 2000000);
  near(short.ideco.tax, 482422, 2, "iDeCoの所得税");
  assert.strictEqual(short.ideco.inhabitTax, 450000, "iDeCoの住民税");
  assert.strictEqual(short.shortTenure, true, "画面で断るための印");
  assert.strictEqual(short.shortTenureYears, 5);

  // 加入6年なら制限が外れ、残額の半分だけが課税される
  const six = lumpSumTax(
    {
      idecoAmount: 8000000,
      idecoJoinAge: 61,
      idecoPayAge: 67,
      retireAmount: 0,
      hireAge: 22,
      retireAge: 60,
    },
    tax,
  );
  assert.strictEqual(six.idecoYears, 6);
  assert.ok(six.tax < short.tax, "控除は大きく、制限も外れるので税額は下がる");
});

test("一時金：加入5年以下でも残額が300万円までなら普通に半分", () => {
  /* 62歳加入・67歳受取・500万円 → 控除200万円、残額300万円ちょうど
	     退職所得 150万円
	       所得税 150万×5%×1.021 ＝ 76,575 ／ 住民税 150,000 */
  const r = lumpSumTax(
    {
      idecoAmount: 5000000,
      idecoJoinAge: 62,
      idecoPayAge: 67,
      retireAmount: 0,
      hireAge: 22,
      retireAge: 60,
    },
    tax,
  );
  near(r.ideco.tax, 76575, 2);
  assert.strictEqual(r.ideco.inhabitTax, 150000);
  assert.strictEqual(r.shortTenure, false, "制限が効いていないので断らない");
});

test("一時金：加入25年なら額が大きくても短期退職手当等にならない", () => {
  const r = lumpSumTax(
    Object.assign({}, lumpBase, { retireAmount: 0, idecoAmount: 30000000 }),
    tax,
  );
  assert.strictEqual(r.idecoYears, 25);
  assert.strictEqual(r.shortTenure, false);
});

/* ---------- 出口：年金（分割） ---------- */

test("年金：公的年金と控除枠を分け合う", () => {
  /* 65歳から10年、iDeCoを毎年100万円。老齢年金180万円
	     iDeCoなし: 180万−110万 ＝ 70万円
	     iDeCoあり: 280万−110万 ＝ 170万円 → 増えた雑所得は100万円
	     所得税 100万×5%×1.021 ＝ 51,050 ／ 住民税 100,000 */
  const a = annuityTax(
    {
      idecoAmount: 10000000,
      annuityYears: 10,
      idecoPayAge: 65,
      publicPension: 1800000,
    },
    tax,
  );
  assert.strictEqual(a.years, 10);
  assert.strictEqual(a.perYear, 1000000);
  assert.strictEqual(a.rows[0].misc, 1000000);
  near(a.rows[0].tax, 51050, 2);
  assert.strictEqual(a.rows[0].inhabitTax, 100000);
  near(a.tax, 151050 * 10, 20, "10年分の税額");
});

test("年金：公的年金が多いほど控除の残りが減る", () => {
  const few = annuityTax(
    {
      idecoAmount: 10000000,
      annuityYears: 10,
      idecoPayAge: 65,
      publicPension: 0,
    },
    tax,
  );
  const many = annuityTax(
    {
      idecoAmount: 10000000,
      annuityYears: 10,
      idecoPayAge: 65,
      publicPension: 3000000,
    },
    tax,
  );
  assert.ok(few.tax < many.tax, "公的年金が多いほうが税額は大きいはず");
  // 公的年金0なら、110万円の枠が空いているぶん雑所得が小さい
  assert.ok(
    few.rows[0].misc < 1000000,
    "控除の枠が残っていれば雑所得は受取額より小さい",
  );
});

test("年金：65歳未満は控除が小さい", () => {
  const under = annuityTax(
    {
      idecoAmount: 6000000,
      annuityYears: 5,
      idecoPayAge: 60,
      publicPension: 0,
    },
    tax,
  );
  const over = annuityTax(
    {
      idecoAmount: 6000000,
      annuityYears: 5,
      idecoPayAge: 65,
      publicPension: 0,
    },
    tax,
  );
  assert.ok(
    under.tax > over.tax,
    "65歳未満のほうが控除が小さく、税額は大きいはず",
  );
});

test("年金：老齢年金は65歳から。それまでは控除をiDeCoが単独で使える", () => {
  /* iDeCoは60歳から受け取れるが、老齢年金は原則65歳から。
	   全期間に老齢年金があるものとして計算すると、60〜64歳を重く見積もる。
	     60〜64歳: 老齢年金なし。iDeCo 100万円だけ → 65歳未満の控除60万円を引いて40万円
	     65歳以降: 老齢年金180万円と合算。280万円−110万円 ＝ 170万円、
	               老齢年金だけなら70万円なので、増えた雑所得は100万円 */
  assert.strictEqual(PUBLIC_PENSION_START_AGE, 65);
  const a = annuityTax(
    {
      idecoAmount: 10000000,
      annuityYears: 10,
      idecoPayAge: 60,
      publicPension: 1800000,
      yieldRate: 0,
    },
    tax,
  );
  assert.strictEqual(a.perYear, 1000000);
  assert.strictEqual(a.rows[0].age, 60);
  assert.strictEqual(a.rows[0].misc, 400000, "60歳は老齢年金がまだ無い");
  assert.strictEqual(a.rows[4].age, 64);
  assert.strictEqual(a.rows[4].misc, 400000, "64歳まで同じ");
  assert.strictEqual(a.rows[5].age, 65);
  assert.strictEqual(a.rows[5].misc, 1000000, "65歳から老齢年金と分け合う");

  // 全期間に老齢年金があるものとして計算すると、税額が多く出る
  const from65 = annuityTax(
    {
      idecoAmount: 10000000,
      annuityYears: 10,
      idecoPayAge: 65,
      publicPension: 1800000,
      yieldRate: 0,
    },
    tax,
  );
  assert.ok(a.tax < from65.tax, "60歳開始のほうが、はじめの5年ぶん軽いはず");
});

test("老齢年金：繰上げは1か月0.4%減、繰下げは1か月0.7%増", () => {
  assert.strictEqual(PUBLIC_PENSION_MIN_AGE, 60);
  assert.strictEqual(PUBLIC_PENSION_MAX_AGE, 75);
  assert.strictEqual(publicPensionRate(65), 1, "65歳が基準");
  // 60歳まで早めると 0.4%×60か月 ＝ 24%減
  near(publicPensionRate(60), 0.76, 1e-12, "60歳受給開始");
  near(publicPensionRate(64), 1 - 0.048, 1e-12, "1年早めると4.8%減");
  // 75歳まで遅らせると 0.7%×120か月 ＝ 84%増
  near(publicPensionRate(75), 1.84, 1e-12, "75歳受給開始");
  near(publicPensionRate(70), 1.42, 1e-12, "70歳受給開始");
  // 上限を超えても増えない
  assert.strictEqual(
    publicPensionRate(80),
    publicPensionRate(75),
    "繰下げの頭打ち",
  );
});

test("年金：受給開始年齢を選ぶと、老齢年金の額も出はじめる年も動く", () => {
  /* 入力する見込額は65歳時点の額。70歳まで繰り下げれば1.42倍になるが、
	   65〜69歳の5年間は老齢年金が無く、その間はiDeCoが控除を単独で使える */
  const base = {
    idecoAmount: 10000000,
    annuityYears: 10,
    idecoPayAge: 65,
    publicPension: 1800000,
    yieldRate: 0,
  };
  const late = annuityTax(
    Object.assign({}, base, { publicPensionStartAge: 70 }),
    tax,
  );
  assert.strictEqual(late.pensionAge, 70);
  near(late.pensionYearly, 1800000 * 1.42, 1, "繰下げで1.42倍");
  assert.strictEqual(late.rows[0].age, 65);
  assert.ok(
    late.rows[0].misc < late.rows[5].misc,
    "65〜69歳は老齢年金が無く、70歳から分け合うので雑所得の増え方が変わる",
  );

  // 指定が無ければ原則の65歳。明示しても同じ
  const dflt = annuityTax(base, tax);
  const at65 = annuityTax(
    Object.assign({}, base, { publicPensionStartAge: 65 }),
    tax,
  );
  assert.strictEqual(dflt.pensionAge, PUBLIC_PENSION_START_AGE);
  assert.strictEqual(dflt.tax, at65.tax);

  // 繰上げると額は減るが、その年から控除を分け合う
  const early = annuityTax(
    Object.assign({}, base, {
      idecoPayAge: 60,
      publicPensionStartAge: 60,
    }),
    tax,
  );
  near(early.pensionYearly, 1800000 * 0.76, 1, "繰上げで0.76倍");
  assert.strictEqual(early.rows[0].age, 60);
  assert.ok(
    early.rows[0].misc > 0,
    "60歳から老齢年金があるので、初年から分け合う",
  );
});

test("年金：老齢年金を繰り下げるほど、iDeCo側の税額は軽くなる", () => {
  /* 老齢年金が出るまでは公的年金等控除をiDeCoが単独で使えるので、
	   受給開始を遅らせるほどiDeCoにかかる税金は減る */
  const at = (start) =>
    annuityTax(
      {
        idecoAmount: 12000000,
        annuityYears: 10,
        idecoPayAge: 65,
        publicPension: 1800000,
        yieldRate: 0,
        publicPensionStartAge: start,
      },
      tax,
    ).tax;
  assert.ok(at(65) > at(70), "70歳まで繰り下げると軽くなる");
  assert.ok(at(70) > at(75), "75歳まで繰り下げるとさらに軽くなる");
});

test("年金：受け取る年数を延ばすと1年あたりの額が減る", () => {
  const short = annuityTax(
    {
      idecoAmount: 12000000,
      annuityYears: 5,
      idecoPayAge: 65,
      publicPension: 1800000,
    },
    tax,
  );
  const long = annuityTax(
    {
      idecoAmount: 12000000,
      annuityYears: 20,
      idecoPayAge: 65,
      publicPension: 1800000,
    },
    tax,
  );
  assert.strictEqual(short.perYear, 2400000);
  assert.strictEqual(long.perYear, 600000);
  assert.strictEqual(short.gross, long.gross, "受け取る総額は同じ");
});

test("年金：控除の枠に収まるまで延ばせば非課税になる", () => {
  // 老齢年金が無ければ、65歳以上は110万円までが非課税。
  // 1,200万円を20年に分ければ年60万円で枠に収まる
  const spread = annuityTax(
    {
      idecoAmount: 12000000,
      annuityYears: 20,
      idecoPayAge: 65,
      publicPension: 0,
    },
    tax,
  );
  assert.strictEqual(spread.tax, 0);
  assert.strictEqual(spread.net, 12000000);

  // 10年だと年120万円で枠を10万円超え、そのぶんに課税される
  const dense = annuityTax(
    {
      idecoAmount: 12000000,
      annuityYears: 10,
      idecoPayAge: 65,
      publicPension: 0,
    },
    tax,
  );
  assert.strictEqual(dense.rows[0].misc, 100000);
  assert.ok(dense.tax > 0);
});

test("年金：年数を延ばせば必ず得になるとは限らない", () => {
  /* 公的年金等控除は、収入が多い部分ほど雑所得への算入割合が下がる
	   （330万円までは100%、以降は75%・85%・95%）。そのため受取額を
	   集中させると、算入割合の低い区分に入って雑所得の合計はむしろ減ることがある。

	   老齢年金180万円・1,200万円を受け取る場合:
	     5年（年240万円）  → 公的年金等の収入420万円。85%の区分に入る
	     10年（年120万円） → 収入300万円。330万円以下なので全額が雑所得
	   結果として5年のほうが税額は小さくなる。直感に反するので、
	   実装の意図としてここに固定しておく */
  const short = annuityTax(
    {
      idecoAmount: 12000000,
      annuityYears: 5,
      idecoPayAge: 65,
      publicPension: 1800000,
    },
    tax,
  );
  const long = annuityTax(
    {
      idecoAmount: 12000000,
      annuityYears: 10,
      idecoPayAge: 65,
      publicPension: 1800000,
    },
    tax,
  );
  assert.strictEqual(
    short.rows[0].misc,
    2185000,
    "5年のときの1年あたりの雑所得",
  );
  assert.strictEqual(
    long.rows[0].misc,
    1200000,
    "10年のときの1年あたりの雑所得",
  );
  assert.ok(
    short.tax < long.tax,
    "算入割合の低い区分に入るぶん、5年のほうが税額は小さい（" +
      short.tax +
      " < " +
      long.tax +
      "）",
  );
});

/* ---------- まとめ ---------- */

test("比較：退職金が無ければ一時金が有利（控除を使い切れる）", () => {
  const c = compare(
    {
      idecoAmount: 10000000,
      idecoJoinAge: 40,
      idecoPayAge: 65,
      retireAmount: 0,
      hireAge: 22,
      retireAge: 60,
      annuityYears: 10,
      publicPension: 1800000,
    },
    tax,
  );
  assert.strictEqual(c.lump.tax, 0, "加入25年の控除1,150万円で全額が収まる");
  assert.ok(c.annuity.tax > 0, "年金受取だと雑所得に課税される");
  assert.ok(c.lump.net > c.annuity.net);
});

test("比較：手取りは「総額 − 税額」で一貫している", () => {
  const cfg = {
    idecoAmount: 10000000,
    idecoJoinAge: 40,
    idecoPayAge: 65,
    retireAmount: 20000000,
    hireAge: 22,
    retireAge: 60,
    annuityYears: 10,
    publicPension: 1800000,
  };
  const c = compare(cfg, tax);
  near(c.lump.net, c.lump.gross - c.lump.tax, 1e-6);
  near(c.annuity.net, c.annuity.gross - c.annuity.tax, 1e-6);
  assert.strictEqual(c.lump.gross, 30000000);
  assert.strictEqual(c.annuity.gross, 30000000);
});

test("比較：どの受取年齢でも結果が壊れない", () => {
  for (let payAge = PAYOUT_AGE_MIN; payAge <= PAYOUT_AGE_MAX; payAge++) {
    for (const retireAge of [60, 65, 70]) {
      const c = compare(
        {
          idecoAmount: 10000000,
          idecoJoinAge: 40,
          idecoPayAge: payAge,
          retireAmount: 20000000,
          hireAge: 22,
          retireAge: retireAge,
          annuityYears: 10,
          publicPension: 1800000,
        },
        tax,
      );
      const where = payAge + "歳受取・退職" + retireAge + "歳";
      assert.ok(
        Number.isFinite(c.lump.net) && c.lump.net >= 0,
        where + " 一時金の手取りが不正",
      );
      assert.ok(
        Number.isFinite(c.annuity.net) && c.annuity.net >= 0,
        where + " 年金の手取りが不正",
      );
      assert.ok(
        c.lump.tax >= 0 && c.annuity.tax >= 0,
        where + " 税額がマイナス",
      );
    }
  }
});

test("一時金：結果に受取年齢を残す（画面の案内文で使う）", () => {
  const r = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 65, retireAge: 70 }),
    tax,
  );
  assert.strictEqual(r.retireAge, 70);
  assert.strictEqual(r.idecoPayAge, 65);
  // 調整を外すには、退職金の10年以上前に受け取る必要がある
  assert.strictEqual(
    r.retireAge - (OVERLAP_YEARS_IDECO_FIRST + 1),
    60,
    "70歳退職なら60歳まで早めれば調整が外れる",
  );
});

test("積立：実質の負担は「掛金 − 節税額」", () => {
  /* 節税額は掛金とは別に増える額ではなく、払った掛金のうち
	   税金が軽くなって戻ってくる分。並べて足すと二重に数えることになる */
  const a = accumulate(baseAcc, tax);
  assert.strictEqual(a.netCost, a.paid - a.saved);
  assert.ok(a.netCost < a.paid, "節税があるぶん、負担は掛金より小さい");
  assert.ok(
    a.netCost > 0,
    "所得税＋住民税でも最大55%なので、負担が消えることはない",
  );
});

test("積立：残高の内訳を足すと残高そのものになる", () => {
  /* 画面の帯（元の残高／実質の負担／節税で戻る分／運用益）が
	   受け取る残高をちょうど分け合っていること */
  const cases = [
    {},
    { initialBalance: 3000000 },
    { yieldRate: 5 },
    { taxableIncome: 0 },
    // 含み益がある場合と、含み損の場合。帯の左端は時価ではなく元本になる
    { initialBalance: 3000000, initialPaid: 2000000 },
    { initialBalance: 3000000, initialPaid: 4000000 },
  ];
  for (const over of cases) {
    const a = accumulate(
      Object.assign({}, baseAcc, { yieldRate: 3 }, over),
      tax,
    );
    near(
      a.initialPaid + a.netCost + a.saved + a.gain,
      a.balance,
      1e-6,
      JSON.stringify(over) + " で内訳の合計が残高と合わない",
    );
  }
});

test("積立：節税がなければ実質の負担は掛金そのもの", () => {
  // 課税所得0なら軽くなる税金も無い
  const a = accumulate(Object.assign({}, baseAcc, { taxableIncome: 0 }), tax);
  assert.strictEqual(a.saved, 0);
  assert.strictEqual(a.netCost, a.paid);
});

test("一時金：退職金が先でも20年以上空けば調整されない", () => {
  /* 50歳で退職金 → 70歳でiDeCo（間隔20年 > 19年）。
	   画面の説明は「どちらが先か」で文が変わるので、
	   調整なしが両方の向きで起きることを固定しておく */
  const r = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 70, retireAge: 50 }),
    tax,
  );
  assert.strictEqual(r.gap, 20, "退職金が先（gapは正）");
  assert.strictEqual(r.adjusted, null, "調整なし");
  assert.strictEqual(r.overlap, 0);
  assert.strictEqual(
    r.ideco.deduction,
    tax.retireDeduction(r.idecoYears),
    "iDeCoは満額の控除",
  );
  assert.strictEqual(
    r.retire.deduction,
    tax.retireDeduction(r.retireYears),
    "退職金も満額の控除",
  );

  // 19年ちょうどだとまだ調整される
  const at19 = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 69, retireAge: 50 }),
    tax,
  );
  assert.strictEqual(at19.gap, 19);
  assert.strictEqual(at19.adjusted, "ideco", "19年内はiDeCo側が削られる");
});

/* ---------- 年金受取のあいだも運用は続く ---------- */

test("年金の1年あたりの額：利回り0なら残高を年数で割るだけ", () => {
  assert.strictEqual(annuityPayment(10000000, 10, 0), 1000000);
  assert.strictEqual(annuityPayment(12000000, 20, 0), 600000);
  assert.strictEqual(annuityPayment(0, 10, 3), 0, "残高なし");
});

test("年金の1年あたりの額：運用が続くぶん、残高÷年数より多い", () => {
  /* 期首払いの年金現価率 = (1 − 1.03^−10) / 0.03 × 1.03 = 8.786108…
	   1,000万円 ÷ 8.786108… ＝ 1,138,159円 */
  const pmt = annuityPayment(10000000, 10, 3);
  near(pmt, 1138159, 2, "1年あたりの受取額");
  assert.ok(pmt > 10000000 / 10, "残高を割っただけより多い");
  // 10年で受け取る総額は、受給開始時の残高より多くなる
  near(pmt * 10, 11381590, 20, "受け取る総額");
});

test("年金：受け取る総額は受給開始時の残高を上回る", () => {
  const a = annuityTax(
    {
      idecoAmount: 10000000,
      annuityYears: 10,
      idecoPayAge: 65,
      publicPension: 1800000,
      yieldRate: 3,
    },
    tax,
  );
  assert.strictEqual(a.balance, 10000000, "受給開始時の残高");
  assert.ok(a.gross > a.balance, "運用が続くぶん総額のほうが多い");
  near(a.growth, a.gross - a.balance, 1e-6);
  near(a.gross, a.perYear * a.years, 1e-6, "総額は1年あたり×年数");
});

test("年金：利回りが高いほど受け取る総額が増える", () => {
  const base = {
    idecoAmount: 10000000,
    annuityYears: 15,
    idecoPayAge: 65,
    publicPension: 0,
  };
  const flat = annuityTax(Object.assign({}, base, { yieldRate: 0 }), tax);
  const grow = annuityTax(Object.assign({}, base, { yieldRate: 4 }), tax);
  assert.strictEqual(flat.gross, 10000000, "利回り0なら残高そのもの");
  assert.ok(grow.gross > flat.gross);
  assert.strictEqual(flat.growth, 0);
  assert.ok(grow.growth > 0);
});

test("年金：長く分けるほど運用が続く期間も延びる", () => {
  const base = {
    idecoAmount: 10000000,
    idecoPayAge: 65,
    publicPension: 0,
    yieldRate: 3,
  };
  const short = annuityTax(Object.assign({}, base, { annuityYears: 5 }), tax);
  const long = annuityTax(Object.assign({}, base, { annuityYears: 20 }), tax);
  assert.ok(long.gross > short.gross, "20年のほうが受け取る総額は多い");
  assert.ok(long.perYear < short.perYear, "1年あたりは少ない");
});

test("比較：利回りがあると年金の総額は一時金より多い", () => {
  const cfg = {
    idecoAmount: 10000000,
    idecoJoinAge: 40,
    idecoPayAge: 65,
    retireAmount: 20000000,
    hireAge: 22,
    retireAge: 60,
    annuityYears: 10,
    publicPension: 1800000,
    yieldRate: 3,
  };
  const c = compare(cfg, tax);
  assert.ok(
    c.annuity.gross > c.lump.gross,
    "年金は受け取り終わるまで運用が続くぶん総額が多い（" +
      c.lump.gross +
      " → " +
      c.annuity.gross +
      "）",
  );
  // 退職金の額は両方に同じだけ含まれる
  near(c.annuity.gross - c.lump.gross, c.annuity.detail.growth, 1e-6);
  near(c.annuity.net, c.annuity.gross - c.annuity.tax, 1e-6);
});

/* ---------- iDeCoをやらなかった場合との差 ---------- */

test("基準：iDeCoが無ければ退職金は満額の控除を使える", () => {
  // 勤続38年 → 控除2,060万円。退職金2,000万円なら非課税
  assert.strictEqual(
    retireOnlyTax({ retireAmount: 20000000, hireAge: 22, retireAge: 60 }, tax),
    0,
  );
  // 退職金が控除を超えれば税額が出る
  assert.ok(
    retireOnlyTax({ retireAmount: 30000000, hireAge: 22, retireAge: 60 }, tax) >
      0,
  );
  // 退職金が無ければ0
  assert.strictEqual(
    retireOnlyTax({ retireAmount: 0, hireAge: 22, retireAge: 60 }, tax),
    0,
  );
});

test("同じ年に受け取っても、iDeCoで増えた税額は出せる", () => {
  /* 合算されると税額をiDeCo分と退職金分に割り振れないが、
	   「iDeCoが無かった場合」との差なら出せる。
	   60歳で両方：通算38年の控除2,060万円、合算3,000万円
	     退職所得 (3,000万−2,060万)÷2 ＝ 470万円 → 993,262円
	   iDeCoが無ければ退職金2,000万円は控除2,060万円以下で非課税 */
  const r = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 60 }),
    tax,
  );
  assert.strictEqual(r.sameYear, true);
  assert.strictEqual(r.taxWithoutIdeco, 0, "iDeCoが無ければ非課税");
  near(r.taxByIdeco, r.tax, 1, "この場合は税額のすべてがiDeCoによる増加");
  near(r.taxByIdeco, 993262, 3);
});

test("退職金側が削られた分も、iDeCoによる増加として出る", () => {
  /* iDeCoを61歳・退職金を70歳（9年内なので退職金側の控除が削られる）。
	   iDeCoが無ければ退職金は勤続48年の控除2,760万円で非課税 */
  const r = lumpSumTax(
    Object.assign({}, lumpBase, { idecoPayAge: 61, retireAge: 70 }),
    tax,
  );
  assert.strictEqual(r.adjusted, "retire");
  assert.strictEqual(r.taxWithoutIdeco, 0);
  near(r.taxByIdeco, r.tax, 1);
  // 退職金側にも税額が出ており、それもiDeCoが原因
  assert.ok(
    r.retire.tax + r.retire.inhabitTax > 0,
    "削られた結果、退職金にも課税されている",
  );
});

test("加入期間が勤続期間より長いと、税額がむしろ減ることがある", () => {
  /* 25歳からiDeCo、40〜60歳が勤続。同じ年（60歳）に受け取ると
	   通算35年ぶんの控除（1,850万円）が使え、勤続20年だけの
	   控除（800万円）より大きくなる。iDeCoを足したのに税額は下がる */
  const cfg = {
    idecoAmount: 1000000,
    idecoJoinAge: 25,
    idecoPayAge: 60,
    retireAmount: 20000000,
    hireAge: 40,
    retireAge: 60,
  };
  const r = lumpSumTax(cfg, tax);
  assert.strictEqual(r.sameYear, true);
  assert.ok(r.taxWithoutIdeco > 0, "勤続20年だけでは控除が足りず課税される");
  assert.ok(r.taxByIdeco < 0, "iDeCoによって税額が減っている（差はマイナス）");
  assert.ok(r.tax < r.taxWithoutIdeco);
});

test("年金で受け取れば、退職金の税額はiDeCoが無い場合と同じ", () => {
  const cfg = {
    idecoAmount: 10000000,
    idecoJoinAge: 40,
    idecoPayAge: 65,
    retireAmount: 30000000,
    hireAge: 22,
    retireAge: 60,
    annuityYears: 10,
    publicPension: 1800000,
    yieldRate: 3,
  };
  const c = compare(cfg, tax);
  // 年金はiDeCoが退職所得控除を使わないので、退職金側は調整されない
  assert.strictEqual(c.annuity.taxWithoutIdeco, retireOnlyTax(cfg, tax));
  near(
    c.annuity.taxByIdeco,
    c.annuity.detail.tax,
    1e-6,
    "増えるのはiDeCo分の税額だけ",
  );
  // 一時金だとiDeCo側の控除が削られるぶん、増え方が大きい
  assert.ok(
    c.lump.taxByIdeco > c.annuity.taxByIdeco - 1e-6 ||
      c.lump.tax !== c.annuity.tax,
  );
});

test("どの受取年齢でも、税額の増加は「合計 − 基準」で一貫している", () => {
  for (let payAge = PAYOUT_AGE_MIN; payAge <= PAYOUT_AGE_MAX; payAge++) {
    const cfg = {
      idecoAmount: 10000000,
      idecoJoinAge: 40,
      idecoPayAge: payAge,
      retireAmount: 30000000,
      hireAge: 22,
      retireAge: 60,
      annuityYears: 10,
      publicPension: 1800000,
      yieldRate: 3,
    };
    const c = compare(cfg, tax);
    near(
      c.lump.taxByIdeco,
      c.lump.tax - c.lump.taxWithoutIdeco,
      1e-6,
      payAge + "歳の一時金",
    );
    near(
      c.annuity.taxByIdeco,
      c.annuity.tax - c.annuity.taxWithoutIdeco,
      1e-6,
      payAge + "歳の年金",
    );
  }
});

/* ---------- 受給を始められる年齢 ---------- */

test("受給開始年齢：通算加入者等期間が10年以上なら60歳から", () => {
  // 60歳になるまでの期間で決まるので、50歳までに加入していれば10年ある
  assert.strictEqual(earliestPayoutAge(50), 60);
  assert.strictEqual(earliestPayoutAge(40), 60);
  assert.strictEqual(earliestPayoutAge(22), 60);
});

test("受給開始年齢：期間が足りないと繰り下がる", () => {
  /* 表のとおり。区分は「8年以上10年未満→61歳」のように幅を持つので、
	   区分の上端と下端の両方を見る（加入年齢 ＝ 60 − 期間） */
  assert.strictEqual(earliestPayoutAge(51), 61, "9年");
  assert.strictEqual(earliestPayoutAge(52), 61, "8年");
  assert.strictEqual(earliestPayoutAge(53), 62, "7年");
  assert.strictEqual(earliestPayoutAge(54), 62, "6年");
  assert.strictEqual(earliestPayoutAge(55), 63, "5年");
  assert.strictEqual(earliestPayoutAge(56), 63, "4年");
  assert.strictEqual(earliestPayoutAge(57), 64, "3年");
  assert.strictEqual(earliestPayoutAge(58), 64, "2年");
  assert.strictEqual(earliestPayoutAge(59), 65, "1年");
});

test("受給開始年齢：10年ちょうどの境目", () => {
  assert.strictEqual(earliestPayoutAge(50), 60, "50歳加入はちょうど10年");
  assert.strictEqual(
    earliestPayoutAge(51),
    61,
    "1年足りないだけで1歳繰り下がる",
  );
});

test("受給開始年齢：60歳以降に初めて加入したら5年後から", () => {
  assert.strictEqual(LATE_JOIN_AGE, 60);
  assert.strictEqual(LATE_JOIN_WAIT, 5);
  assert.strictEqual(earliestPayoutAge(60), 65);
  assert.strictEqual(earliestPayoutAge(64), 69);
  assert.strictEqual(earliestPayoutAge(69), 74);
  // 受給開始の上限（75歳）は超えない
  assert.strictEqual(earliestPayoutAge(71), PAYOUT_AGE_MAX);
  assert.strictEqual(earliestPayoutAge(75), PAYOUT_AGE_MAX);
});

test("受給開始年齢：どの加入年齢でも受給できる範囲に収まる", () => {
  for (let joinAge = 18; joinAge <= 75; joinAge++) {
    const age = earliestPayoutAge(joinAge);
    assert.ok(
      age >= PAYOUT_AGE_MIN && age <= PAYOUT_AGE_MAX,
      joinAge + "歳加入で受給開始が範囲外: " + age,
    );
  }
});

test("受給開始年齢：遅く加入するほど遅くなる（逆転しない）", () => {
  let prev = 0;
  for (let joinAge = 18; joinAge <= 75; joinAge++) {
    const age = earliestPayoutAge(joinAge);
    assert.ok(age >= prev, joinAge + "歳加入で受給開始が早くなっている");
    prev = age;
  }
});

test("受給開始年齢の表は、年数の降順に並んでいる", () => {
  // 上から順に見て最初に当てはまるものを使うので、並び順が崩れると誤判定する
  for (let i = 1; i < PAYOUT_START_BY_PERIOD.length; i++) {
    assert.ok(
      PAYOUT_START_BY_PERIOD[i].minYears <
        PAYOUT_START_BY_PERIOD[i - 1].minYears,
      "年数が降順でない",
    );
    assert.ok(
      PAYOUT_START_BY_PERIOD[i].age > PAYOUT_START_BY_PERIOD[i - 1].age,
      "年齢が昇順でない",
    );
  }
});

/* ---------- 出口：一時金と年金の併用 ----------

   期待値の考え方は一時金・年金と同じで、両端（0%と100%）が
   それぞれ年金だけ・一時金だけと一致することを軸に固定している。 */

// 退職金2,000万円・22歳就職60歳退職／iDeCo 1,000万円・40歳加入・年金は20年
const mixBase = {
  idecoAmount: 10000000,
  idecoJoinAge: 40,
  idecoPayAge: 65,
  retireAmount: 20000000,
  hireAge: 22,
  retireAge: 60,
  annuityYears: 20,
  publicPension: 1800000,
  yieldRate: 3,
};

// 受取順の3通り。控除の調整の効き方が変わるので、併用でも全部見る
const MIX_ORDERS = [
  [65, 60, "退職金が先→iDeCoが後"],
  [60, 65, "iDeCoが先→退職金が後"],
  [60, 60, "同じ年に受け取る"],
];

test("併用：割合100%は一時金だけ、0%は年金だけと同じ結果になる", () => {
  for (const [payAge, retireAge, name] of MIX_ORDERS) {
    const cfg = Object.assign({}, mixBase, {
      idecoPayAge: payAge,
      retireAge: retireAge,
    });
    const c = compare(cfg, tax);
    const all = mixTax(cfg, tax, 1),
      none = mixTax(cfg, tax, 0);
    near(all.tax, c.lump.tax, 1e-6, name + "：100%の税額が一時金と食い違う");
    near(
      all.taxByIdeco,
      c.lump.taxByIdeco,
      1e-6,
      name + "：100%の増える税金が一時金と食い違う",
    );
    near(none.tax, c.annuity.tax, 1e-6, name + "：0%の税額が年金と食い違う");
    near(
      none.taxByIdeco,
      c.annuity.taxByIdeco,
      1e-6,
      name + "：0%の増える税金が年金と食い違う",
    );
  }
});

test("併用：一時金を受け取らないなら、退職所得控除の重複調整は起きない", () => {
  /* lumpSumTax は金額ではなく受取順で調整を掛けるので、0円で呼ぶと
	   「受け取っていないのに退職金の控除が削られた」税額になってしまう。
	   0%のときは呼ばずに、退職金は満額の控除で計算されていること */
  for (const [payAge, retireAge, name] of MIX_ORDERS) {
    const cfg = Object.assign({}, mixBase, {
      idecoPayAge: payAge,
      retireAge: retireAge,
    });
    const none = mixTax(cfg, tax, 0);
    assert.strictEqual(none.lump, null, name + "：一時金の計算を呼んでいる");
    near(
      none.tax - none.annuity.tax,
      retireOnlyTax(cfg, tax),
      1e-6,
      name + "：退職金の税額が満額の控除で計算されていない",
    );
    near(
      none.taxByIdeco,
      none.annuity.tax,
      1e-6,
      name + "：増える税金に退職金側の分がまぎれている",
    );
  }
});

test("併用：1円でも一時金にすると重複調整が効き、0%と1%の間で跳ねる", () => {
  // iDeCoを60歳・退職金を65歳（間隔5年 ≤ 9年）なので、退職金側の控除が削られる
  const cfg = Object.assign({}, mixBase, { idecoPayAge: 60, retireAge: 65 });
  const none = mixTax(cfg, tax, 0),
    bit = mixTax(cfg, tax, 0.01);
  assert.ok(
    bit.taxByIdeco > none.taxByIdeco,
    "控除の調整は期間で決まるので、1%でも丸ごと効くはず（0%:" +
      none.taxByIdeco +
      " → 1%:" +
      bit.taxByIdeco +
      "）",
  );
});

test("併用：一時金だけ・年金だけより税金が少なくなる組み合わせがある", () => {
  // 同じ年に退職金2,000万円とiDeCo 1,000万円を受け取り、老齢年金は180万円
  const cfg = Object.assign({}, mixBase, { idecoPayAge: 60, retireAge: 60 });
  const b = bestMix(cfg, tax);
  const c = compare(cfg, tax);
  assert.ok(
    b.best < c.lump.taxByIdeco,
    "一時金だけ（" + c.lump.taxByIdeco + "）より少ないはず：" + b.best,
  );
  assert.ok(
    b.best < c.annuity.taxByIdeco,
    "年金だけ（" + c.annuity.taxByIdeco + "）より少ないはず：" + b.best,
  );
  assert.ok(
    b.at > 0 && b.at < 100,
    "最小が端ではなく途中にあるはず：" + b.at + "%",
  );
});

test("併用：どの割合でも非課税なら、最小の範囲は0〜100%になる", () => {
  // 退職金も老齢年金も無く、加入25年の控除1,150万円に1,000万円が収まる
  const cfg = Object.assign({}, mixBase, { retireAmount: 0, publicPension: 0 });
  const b = bestMix(cfg, tax);
  assert.strictEqual(b.best, 0);
  assert.strictEqual(b.lo, 0);
  assert.strictEqual(b.hi, 100);
});

test("併用：分けた額の合計は、どの割合でも残高と一致する", () => {
  // 端数の出る残高で、丸めが残高からずれないことを見る
  const cfg = Object.assign({}, mixBase, { idecoAmount: 9999999 });
  for (let i = 0; i <= MIX_STEPS; i++) {
    const m = mixTax(cfg, tax, i / MIX_STEPS);
    assert.strictEqual(
      m.lumpAmount + m.annuityAmount,
      9999999,
      i + "%で合計がずれる",
    );
  }
});

test("併用：割合は0〜1の外を渡しても端に収まる", () => {
  const under = mixTax(mixBase, tax, -1),
    over = mixTax(mixBase, tax, 2);
  assert.strictEqual(under.lumpAmount, 0);
  assert.strictEqual(over.annuityAmount, 0);
});

test("併用：どの受取年齢でも最小とその範囲が壊れない", () => {
  for (let payAge = PAYOUT_AGE_MIN; payAge <= PAYOUT_AGE_MAX; payAge++) {
    for (const retireAge of [60, 65, 70]) {
      const cfg = Object.assign({}, mixBase, {
        idecoPayAge: payAge,
        retireAge: retireAge,
      });
      const b = bestMix(cfg, tax);
      const c = compare(cfg, tax);
      const where = payAge + "歳受取・退職" + retireAge + "歳";
      assert.strictEqual(
        b.points.length,
        MIX_STEPS + 1,
        where + " 点の数が合わない",
      );
      assert.ok(b.lo <= b.at && b.at <= b.hi, where + " 最小の位置が範囲の外");
      // 端を含めて振っているので、併用の最小が片方だけの受取を上回ることはない
      assert.ok(
        b.best <= c.lump.taxByIdeco + 1e-6,
        where + " 一時金だけより悪い",
      );
      assert.ok(
        b.best <= c.annuity.taxByIdeco + 1e-6,
        where + " 年金だけより悪い",
      );
      for (let i = 0; i <= MIX_STEPS; i++) {
        assert.ok(
          b.points[i] >= b.best - 1e-6,
          where + " " + i + "%が最小を下回る",
        );
        if (i >= b.lo && i <= b.hi) {
          near(
            b.points[i],
            b.best,
            1e-6,
            where + " " + i + "%は範囲内なのに最小でない",
          );
        }
      }
    }
  }
});

test("併用：手取りは「総額 − 税額」で一貫している", () => {
  for (let i = 0; i <= MIX_STEPS; i += 10) {
    const m = mixTax(mixBase, tax, i / MIX_STEPS);
    near(m.net, m.gross - m.tax, 1e-6, i + "%");
    // 総額は「一時金 ＋ 年金の受取総額 ＋ 退職金」。年金分は受取中の運用で増える
    near(
      m.gross,
      m.lumpAmount + m.annuity.gross + mixBase.retireAmount,
      1e-6,
      i + "%の総額",
    );
  }
});

/* ---------- 参考：課税口座で運用した場合 ---------- */

test("課税口座：譲渡益税は20.315%", () => {
  // 所得税15% ＋ 復興特別所得税0.315%（15%×2.1%） ＋ 住民税5%
  assert.ok(
    Math.abs(TAXABLE_GAIN_TAX_RATE - (0.15 + 0.15 * 0.021 + 0.05)) < 1e-12,
    "内訳の合計と合わない：" + TAXABLE_GAIN_TAX_RATE,
  );
  near(taxableAccountTax(10000000), 2031500, 1e-6, "運用益1,000万円");
});

test("課税口座：運用益が無ければ税金も0円", () => {
  assert.strictEqual(taxableAccountTax(0), 0);
  // 元本割れ（マイナスの運用益）でも、税金が戻ってくる形にはしない
  assert.strictEqual(taxableAccountTax(-1000000), 0);
  assert.strictEqual(taxableAccountTax(undefined), 0);
});

test("課税口座：運用益に比例する（分けて計算しても合計は同じ）", () => {
  /* 画面は併用のときに運用益を一時金部分と年金部分へ割り振ってから
	   それぞれに掛ける。合計がずれないことを見る */
  const gain = 4720000;
  for (let i = 0; i <= 10; i++) {
    const share = i / 10;
    near(
      taxableAccountTax(gain * share) + taxableAccountTax(gain * (1 - share)),
      taxableAccountTax(gain),
      1e-6,
      i * 10 + "%で分けた場合",
    );
  }
});
