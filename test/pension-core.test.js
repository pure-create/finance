/* 年金の損益分岐点の計算のテスト。

   利回り0%・課税なしにすると累積受取総額は直線になり、交差する年齢を
   手で解ける。ここではその解析解と突き合わせている。
   金額は「65歳受給開始時の年金額＝1」を基準にした倍数（＝年分）。

   実行: npm test   （プロジェクト直下から） */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  pRate,
  calcW,
  leaderTimeline,
  MINA,
  MAXA,
  CALCA,
  MAPM,
} = require("../pension/js/pension-core.js");

function near(actual, expected, tol, msg) {
  assert.ok(
    Math.abs(actual - expected) <= (tol === undefined ? 1e-9 : tol),
    (msg || "") + " 期待 " + expected + " / 実際 " + actual,
  );
}

// 年齢から、その月の添字へ
const idx = (age) => Math.round((age - MINA) * 12);

test("定数：計算は60歳から140歳まで、表示は100歳まで", () => {
  assert.strictEqual(MINA, 60, "計算開始年齢");
  assert.strictEqual(MAXA, 100, "表示の上限");
  assert.strictEqual(CALCA, 140, "計算の上限");
  assert.strictEqual(MAPM, (CALCA - MINA) * 12, "計算する月数");
});

test("pRate：繰上げ・繰下げの増減率", () => {
  near(pRate(65), 1, 1e-12, "65歳が基準");
  near(pRate(60), 0.76, 1e-12, "60歳（0.4%×60か月＝24%減）");
  near(pRate(70), 1.42, 1e-12, "70歳（0.7%×60か月＝42%増）");
  near(pRate(75), 1.84, 1e-12, "75歳（0.7%×120か月＝84%増）");
  // 1か月刻みでも効く
  near(pRate(64 + 11 / 12), 1 - 0.004, 1e-12, "64歳11ヶ月");
  near(pRate(65 + 1 / 12), 1 + 0.007, 1e-12, "65歳1ヶ月");
});

test("pRate：75歳より後は増えない", () => {
  near(pRate(76), 1.84, 1e-12);
  near(pRate(100), 1.84, 1e-12);
  // 74歳11ヶ月はまだ上限に達していない
  assert.ok(pRate(74 + 11 / 12) < 1.84);
});

test("pRate：年齢が上がるほど単調に増える", () => {
  let prev = -Infinity;
  for (let m = 0; m <= (75 - 60) * 12; m++) {
    const v = pRate(60 + m / 12);
    assert.ok(v >= prev - 1e-12, 60 + m / 12 + "歳で増減率が下がっている");
    prev = v;
  }
});

test("calcW：利回り0%なら受け取った分だけ積み上がる", () => {
  // 投資期間なし（ia=60）・利回り0%・非課税
  const w65 = calcW(65, 0, 60, 0);
  near(w65[idx(65)], 0, 1e-9, "受給開始時点");
  near(w65[idx(66)], 1, 1e-9, "1年受け取ると1年分");
  near(w65[idx(75)], 10, 1e-9, "10年で10年分");

  // 70歳開始は1年あたり1.42年分ずつ増える
  const w70 = calcW(70, 0, 60, 0);
  near(w70[idx(70)], 0, 1e-9, "受給開始前は0");
  near(w70[idx(69)], 0, 1e-9, "受給開始前は0");
  near(w70[idx(80)], 14.2, 1e-9, "10年で1.42×10");

  // 60歳開始は0.76年分ずつ
  const w60 = calcW(60, 0, 60, 0);
  near(w60[idx(80)], 15.2, 1e-9, "20年で0.76×20");
});

test("calcW：損益分岐する年齢は解析解と一致する", () => {
  /* 利回り0%なら累積は直線なので、交差する年齢は手で解ける。
	   60歳開始: 0.76×(a−60) ／ 65歳開始: 1.00×(a−65)
	     0.76a−45.6 = a−65 → a = 80.8333…（80歳10ヶ月） */
  const w60 = calcW(60, 0, 60, 0),
    w65 = calcW(65, 0, 60, 0);
  const cross6065 = 60 + 60 / 0.24 / 12;
  near(cross6065, 80 + 10 / 12, 1e-9, "解析解そのものの確認");
  // 交差の前後で優劣が入れ替わる
  assert.ok(w60[idx(80)] > w65[idx(80)], "80歳では60歳開始が有利");
  assert.ok(w60[idx(82)] < w65[idx(82)], "82歳では65歳開始が有利");

  /* 65歳開始と70歳開始: a−65 = 1.42(a−70) → a = 81.9047…（81歳11ヶ月） */
  const w70 = calcW(70, 0, 60, 0);
  assert.ok(w65[idx(81)] > w70[idx(81)], "81歳では65歳開始が有利");
  assert.ok(w65[idx(83)] < w70[idx(83)], "83歳では70歳開始が有利");

  /* 70歳開始と75歳開始: 1.42(a−70) = 1.84(a−75) → a = 91.9047…（91歳11ヶ月） */
  const w75 = calcW(75, 0, 60, 0);
  assert.ok(w70[idx(91)] > w75[idx(91)], "91歳では70歳開始が有利");
  assert.ok(w70[idx(93)] < w75[idx(93)], "93歳では75歳開始が有利");
});

test("calcW：利回りが高いほど残高は増える", () => {
  const flat = calcW(65, 0, 80, 0);
  const grow = calcW(65, 0.05, 80, 0);
  assert.ok(grow[idx(90)] > flat[idx(90)], "運用したほうが残高は多い");
  // 課税すると、同じ利回りでも残高は減る
  const taxed = calcW(65, 0.05, 80, 0.20315);
  assert.ok(taxed[idx(90)] < grow[idx(90)], "課税ありのほうが少ない");
  assert.ok(taxed[idx(90)] > flat[idx(90)], "課税ありでも運用しないよりは多い");
});

test("calcW：累積受取総額は減らない", () => {
  for (const sa of [60, 65, 70, 75]) {
    const w = calcW(sa, 0.03, 70, 0.20315);
    for (let m = 1; m <= MAPM; m++) {
      assert.ok(
        w[m] >= w[m - 1] - 1e-9,
        sa + "歳開始：" + (MINA + m / 12).toFixed(2) + "歳で累積が減っている",
      );
    }
  }
});

test("leaderTimeline：期間が隙間なく並ぶ", () => {
  const ages = [60, 65, 70, 75];
  const ws = ages.map((a) => calcW(a, 0.03, 70, 0.20315));
  const periods = leaderTimeline(ws);

  assert.ok(periods.length > 0, "期間が空");
  near(periods[0].start, MINA, 1e-9, "最初の期間は計算開始年齢から");
  near(
    periods[periods.length - 1].end,
    CALCA,
    1e-9,
    "最後の期間は計算の上限まで",
  );
  for (let i = 1; i < periods.length; i++) {
    near(
      periods[i].start,
      periods[i - 1].end,
      1e-9,
      i + "番目の期間が前の期間と繋がっていない",
    );
    assert.ok(periods[i].idx !== periods[i - 1].idx, "同じ相手が連続している");
  }
  for (const p of periods) {
    assert.ok(p.idx >= 0 && p.idx < ages.length, "範囲外の添字");
    assert.ok(p.end > p.start, "長さが0以下の期間");
  }
});

test("leaderTimeline：利回り0%なら交差する年齢は解析解と一致する", () => {
  const ages = [60, 65, 70, 75];
  const ws = ages.map((a) => calcW(a, 0, 60, 0));
  const periods = leaderTimeline(ws);

  // 60 → 65 → 70 → 75 の順に有利が移る
  assert.deepStrictEqual(
    periods.map((p) => ages[p.idx]),
    [60, 65, 70, 75],
  );

  /* 交差する年齢（月単位の補間を挟むので、1か月ぶんの誤差は許容する）
	     0.76(a−60) = 1.00(a−65) → 19.4 = 0.24a
	     1.00(a−65) = 1.42(a−70) → 34.4 = 0.42a
	     1.42(a−70) = 1.84(a−75) → 38.6 = 0.42a */
  near(periods[0].end, 19.4 / 0.24, 1 / 12, "60歳開始と65歳開始");
  near(periods[1].end, 34.4 / 0.42, 1 / 12, "65歳開始と70歳開始");
  near(periods[2].end, 38.6 / 0.42, 1 / 12, "70歳開始と75歳開始");
});

test("leaderTimeline：ずっと同じ相手が有利なら期間は1つ", () => {
  // 65歳開始だけを2本渡せば、常に先頭が首位のまま
  const w = calcW(65, 0, 60, 0);
  const periods = leaderTimeline([w, calcW(60, 0, 60, 0)]);
  assert.ok(periods.length >= 1);
  near(periods[0].start, MINA, 1e-9);
});
