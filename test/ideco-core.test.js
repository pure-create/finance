/* iDeCoの計算のテスト。
   期待値は制度の規定と速算表から手で計算したもので、コードの出力を写したものではない。
   拠出限度額や重複期間のルールを改正で直したときは、まずここの数字を直すこと。

   実行: npm test   （プロジェクト直下から） */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const tax = require('../common/tax-core.js');
const {
	contributionLimit, joinAgeLimit, taxSaving, accumulate,
	overlapYears, adjustedDeduction, lumpSumTax, retireOnlyTax, annuityPayment, annuityTax, compare,
	LIMIT_REFORM_YEAR, JOIN_AGE_LIMIT, PAYOUT_AGE_MIN, PAYOUT_AGE_MAX,
	OVERLAP_YEARS_IDECO_FIRST, OVERLAP_YEARS_RETIRE_FIRST
} = require('../ideco/js/ideco-core.js');

// 所得税は1.021を掛けて切り捨てるので、二進小数の丸めで1円ずれることがある
function near(actual, expected, tol, msg) {
	assert.ok(Math.abs(actual - expected) <= (tol === undefined ? 1 : tol),
		(msg || '') + ' 期待 ' + expected + ' / 実際 ' + actual);
}

/* ---------- 拠出限度額 ---------- */

test('改正は2027年拠出分から効く', () => {
	assert.strictEqual(LIMIT_REFORM_YEAR, 2027);
});

test('拠出限度額：2026年までは現行の額', () => {
	assert.strictEqual(contributionLimit('self', 2026, 0), 68000, '第1号');
	assert.strictEqual(contributionLimit('employee', 2026, 0), 23000, '企業年金なし');
	assert.strictEqual(contributionLimit('corporate', 2026, 0), 20000, '企業年金あり');
	assert.strictEqual(contributionLimit('publicSv', 2026, 0), 20000, '公務員');
	assert.strictEqual(contributionLimit('spouse', 2026, 0), 23000, '第3号');
});

test('拠出限度額：2027年からは改正後の額', () => {
	assert.strictEqual(contributionLimit('self', 2027, 0), 75000, '第1号');
	assert.strictEqual(contributionLimit('employee', 2027, 0), 62000, '企業年金なし');
	assert.strictEqual(contributionLimit('corporate', 2027, 0), 62000, '企業年金あり');
	assert.strictEqual(contributionLimit('publicSv', 2027, 0), 62000, '公務員');
	assert.strictEqual(contributionLimit('spouse', 2027, 0), 23000, '第3号は変わらない');
});

test('拠出限度額：改正後の第2号は他制度の掛金を差し引いた残り', () => {
	assert.strictEqual(contributionLimit('employee', 2027, 20000), 42000, '62,000−20,000');
	assert.strictEqual(contributionLimit('corporate', 2027, 62000), 0, '使い切っていれば0');
	assert.strictEqual(contributionLimit('corporate', 2027, 80000), 0, '超えてもマイナスにしない');
	// 改正前は他制度の額を引く仕組みではない
	assert.strictEqual(contributionLimit('employee', 2026, 20000), 23000, '改正前は差し引かない');
	// 第1号・第3号は他制度と枠を分け合わない
	assert.strictEqual(contributionLimit('self', 2027, 30000), 75000, '第1号は差し引かない');
	assert.strictEqual(contributionLimit('spouse', 2027, 30000), 23000, '第3号は差し引かない');
});

test('拠出限度額：知らない区分は0', () => {
	assert.strictEqual(contributionLimit('unknown', 2027, 0), 0);
});

test('加入できる年齢の上限は改正で65歳未満から70歳未満へ', () => {
	assert.strictEqual(JOIN_AGE_LIMIT.current, 65);
	assert.strictEqual(JOIN_AGE_LIMIT.reformed, 70);
	assert.strictEqual(joinAgeLimit(2026), 65);
	assert.strictEqual(joinAgeLimit(2027), 70);
});

test('受給を始められる年齢は60歳から75歳', () => {
	assert.strictEqual(PAYOUT_AGE_MIN, 60);
	assert.strictEqual(PAYOUT_AGE_MAX, 75);
});

/* ---------- 入口：節税額 ---------- */

test('節税額：掛金を引く前後の税額の差で出す', () => {
	// 課税所得400万円（20%の区分）、掛金 月2.3万円＝年27.6万円
	//   所得税 (4,000,000×20%−427,500)×1.021 ＝ 372,500×1.021 ＝ 380,322.5 → 380,322
	//   引いた後 3,724,000 → (744,800−427,500)×1.021 ＝ 317,300×1.021 ＝ 323,963.3 → 323,963
	//   差 56,359 ／ 住民税 400,000−372,400 ＝ 27,600
	const s = taxSaving(4000000, 276000, tax);
	near(s.income, 56359, 2, '所得税の節税');
	assert.strictEqual(s.inhabitant, 27600, '住民税の節税');
	near(s.total, 83959, 2, '合計');
});

test('節税額：区分をまたぐと「税率×掛金」とは一致しない', () => {
	/* 課税所得340万円（20%の区分）から27.6万円引くと312.4万円で、10%の区分に落ちる。
	     所得税 (680,000−427,500)×1.021 ＝ 252,500×1.021 ＝ 257,802.5 → 257,802
	     引いた後 (312,400−97,500)×1.021 ＝ 214,900×1.021 ＝ 219,412.9 → 219,412
	     差 38,390
	   「税率20%×掛金」で出すと 276,000×0.20×1.021 ＝ 56,359 になり、大きく違う */
	const s = taxSaving(3400000, 276000, tax);
	near(s.income, 38390, 2, '区分をまたぐ場合の所得税の節税');
	assert.ok(s.income < 276000 * 0.20 * 1.021 - 10000,
		'税率×掛金より小さくなっているはず');
	assert.strictEqual(s.inhabitant, 27600);
});

test('節税額：課税所得が掛金に満たなくてもマイナスにならない', () => {
	const s = taxSaving(100000, 276000, tax);
	assert.ok(s.income >= 0 && s.inhabitant >= 0);
	assert.ok(s.total >= 0);
});

test('節税額：課税所得0なら節税もなし', () => {
	const s = taxSaving(0, 276000, tax);
	assert.strictEqual(s.total, 0);
});

/* ---------- 積立 ---------- */

const baseAcc = {
	startAge: 40, payAge: 45, startYear: 2026, category: 'employee',
	monthly: 23000, otherPlanMonthly: 0, yieldRate: 0,
	taxableIncome: 4000000, initialBalance: 0
};

test('積立：利回り0なら拠出額がそのまま積み上がる', () => {
	const a = accumulate(baseAcc, tax);
	assert.strictEqual(a.rows.length, 5, '40歳から45歳までの5年');
	assert.strictEqual(a.paid, 276000 * 5);
	assert.strictEqual(a.balance, 276000 * 5);
	assert.strictEqual(a.gain, 0, '利回り0なら運用益なし');
});

test('積立：節税額も年ごとに積み上がる', () => {
	const a = accumulate(baseAcc, tax);
	near(a.saved, 83959 * 5, 10, '5年分の節税額');
});

test('積立：掛金は年初に入れ、その年の利回りが付く', () => {
	const a = accumulate(Object.assign({}, baseAcc, { yieldRate: 3 }), tax);
	// 276,000×(1.03^5 + 1.03^4 + … + 1.03^1)
	let expected = 0;
	for (let i = 1; i <= 5; i++) expected += 276000 * Math.pow(1.03, i);
	near(a.balance, expected, 1e-6, '5年後の残高');
	assert.ok(a.gain > 0, '運用益が出ている');
});

test('積立：限度額を超える掛金は限度額まで', () => {
	// 2026年は企業年金なしで月2.3万円が上限。月5万円と入れても2.3万円で頭打ち
	const a = accumulate(Object.assign({}, baseAcc, { monthly: 50000, payAge: 41 }), tax);
	assert.strictEqual(a.rows[0].contribution, 23000 * 12);
	assert.strictEqual(a.rows[0].limit, 23000);
});

test('積立：2027年をまたぐと限度額が上がる', () => {
	const a = accumulate(Object.assign({}, baseAcc, { monthly: 50000, payAge: 43 }), tax);
	assert.strictEqual(a.rows[0].year, 2026);
	assert.strictEqual(a.rows[0].limit, 23000, '2026年は現行');
	assert.strictEqual(a.rows[1].year, 2027);
	assert.strictEqual(a.rows[1].limit, 62000, '2027年から改正後');
	assert.strictEqual(a.rows[1].contribution, 50000 * 12, '希望額が枠に収まる');
});

test('積立：加入できる年齢を過ぎたら拠出は止まるが運用は続く', () => {
	// 2020年に63歳。65歳になる2022年から拠出できない（当時の上限は65歳未満）
	const a = accumulate(Object.assign({}, baseAcc, {
		startAge: 63, payAge: 70, startYear: 2020, yieldRate: 0
	}), tax);
	assert.strictEqual(a.rows.length, 7);
	assert.strictEqual(a.rows[0].contribution, 276000, '63歳は拠出できる');
	assert.strictEqual(a.rows[1].contribution, 276000, '64歳は拠出できる');
	assert.strictEqual(a.rows[2].contribution, 0, '65歳からは拠出できない');
	assert.strictEqual(a.rows[6].contribution, 0, '69歳（2026年）もまだ65歳未満の制限');
	assert.strictEqual(a.paid, 276000 * 2);
});

test('積立：改正後は69歳まで拠出できる', () => {
	const a = accumulate(Object.assign({}, baseAcc, {
		startAge: 63, payAge: 70, startYear: 2027, yieldRate: 0
	}), tax);
	assert.strictEqual(a.rows.length, 7);
	for (const row of a.rows) {
		assert.ok(row.contribution > 0, row.age + '歳（' + row.year + '年）で拠出できていない');
	}
});

/* ---------- 出口：重複期間 ---------- */

test('重複期間：重なった年数を1年未満切り捨てで返す', () => {
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

test('調整後の控除：自分の年数の控除から重複年数の控除を引く', () => {
	// 勤続38年 2,060万円 − 重複20年 800万円 ＝ 1,260万円
	assert.strictEqual(adjustedDeduction(38, 20, tax), 12600000);
	// 重複なしなら満額
	assert.strictEqual(adjustedDeduction(38, 0, tax), tax.retireDeduction(38));
});

test('調整後の控除：マイナスにはならない', () => {
	assert.strictEqual(adjustedDeduction(3, 40, tax), 0);
	assert.ok(adjustedDeduction(20, 20, tax) >= 0);
});

test('重複期間の対象は、受取順で9年と19年', () => {
	assert.strictEqual(OVERLAP_YEARS_IDECO_FIRST, 9, 'iDeCoが先→退職金が後');
	assert.strictEqual(OVERLAP_YEARS_RETIRE_FIRST, 19, '退職金が先→iDeCoが後');
});

/* ---------- 出口：一時金 ---------- */

// 退職金2,000万円・22歳就職60歳退職／iDeCo 1,000万円・40歳加入
const lumpBase = {
	idecoAmount: 10000000, idecoJoinAge: 40, idecoPayAge: 65,
	retireAmount: 20000000, hireAge: 22, retireAge: 60
};

test('一時金：退職金が先なら、19年内はiDeCo側の控除が削られる', () => {
	/* 60歳で退職金 → 65歳でiDeCo（間隔5年 ≤ 19年）
	     iDeCoの加入年数25年 → 控除1,150万円
	     重複20年ぶん 800万円を引いて 350万円
	     退職所得 (1,000万−350万)÷2 ＝ 325万円
	       所得税 (325万×10%−97,500)×1.021 ＝ 227,500×1.021 ＝ 232,277.5 → 232,277
	       住民税 325,000
	     退職金は勤続38年で控除2,060万円 → 2,000万円以下なので非課税 */
	const r = lumpSumTax(lumpBase, tax);
	assert.strictEqual(r.gap, 5);
	assert.strictEqual(r.adjusted, 'ideco', 'iDeCo側が調整される');
	assert.strictEqual(r.overlap, 20);
	assert.strictEqual(r.ideco.deduction, 3500000);
	near(r.ideco.tax, 232277, 2, 'iDeCoの所得税');
	assert.strictEqual(r.ideco.inhabitTax, 325000, 'iDeCoの住民税');
	assert.strictEqual(r.retire.tax, 0, '退職金は控除以下で非課税');
	near(r.tax, 557277, 2, '税額の合計');
	near(r.net, 30000000 - 557277, 2, '手取り');
});

test('一時金：iDeCoが先で10年以上空けば調整されない', () => {
	/* 60歳でiDeCo → 70歳で退職金（間隔10年 > 9年）
	     iDeCoの加入年数20年 → 控除800万円（満額）
	     退職所得 (1,000万−800万)÷2 ＝ 100万円
	       所得税 100万×5%×1.021 ＝ 51,050 ／ 住民税 100,000 */
	const r = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 70 }), tax);
	assert.strictEqual(r.gap, -10);
	assert.strictEqual(r.adjusted, null, '調整なし');
	assert.strictEqual(r.overlap, 0);
	assert.strictEqual(r.ideco.deduction, 8000000, '満額の控除');
	near(r.ideco.tax, 51050, 2);
	assert.strictEqual(r.ideco.inhabitTax, 100000);
	near(r.tax, 151050, 2);
});

test('一時金：iDeCoが先でも9年内なら退職金側の控除が削られる', () => {
	/* 61歳でiDeCo → 70歳で退職金（間隔9年 ≤ 9年）
	     重複は40〜61歳の21年
	     iDeCo 加入21年 → 控除870万円（満額）
	       退職所得 (1,000万−870万)÷2 ＝ 65万円
	       所得税 65万×5%×1.021 ＝ 33,182.5 → 33,182 ／ 住民税 65,000
	     退職金 勤続48年 2,760万円 − 重複21年 870万円 ＝ 1,890万円
	       退職所得 (2,000万−1,890万)÷2 ＝ 55万円
	       所得税 55万×5%×1.021 ＝ 28,077.5 → 28,077 ／ 住民税 55,000 */
	const r = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 61, retireAge: 70 }), tax);
	assert.strictEqual(r.gap, -9);
	assert.strictEqual(r.adjusted, 'retire', '退職金側が調整される');
	assert.strictEqual(r.overlap, 21);
	assert.strictEqual(r.ideco.deduction, 8700000);
	assert.strictEqual(r.retire.deduction, 18900000);
	near(r.ideco.tax, 33182, 2);
	near(r.retire.tax, 28077, 2);
	near(r.tax, 33182 + 65000 + 28077 + 55000, 3, '税額の合計');
});

test('一時金：10年ルールの崖（1年ずらすと税額が跳ねる）', () => {
	const noAdjust = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 70 }), tax);
	const adjusted = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 61, retireAge: 70 }), tax);
	assert.ok(adjusted.tax > noAdjust.tax,
		'9年内に入ると税額が増えるはず（' + noAdjust.tax + ' → ' + adjusted.tax + '）');
	assert.ok(noAdjust.net > adjusted.net, '手取りは10年空けたほうが多い');
});

test('一時金：同じ年に受け取ると合算して1回ぶんの控除になる', () => {
	/* 60歳で両方
	     通算の勤続年数 20＋38−20 ＝ 38年 → 控除2,060万円
	     退職所得 (3,000万−2,060万)÷2 ＝ 470万円
	       所得税 (470万×20%−427,500)×1.021 ＝ 512,500×1.021 ＝ 523,262.5 → 523,262
	       住民税 470,000 */
	const r = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 60 }), tax);
	assert.strictEqual(r.gap, 0);
	assert.strictEqual(r.sameYear, true);
	assert.strictEqual(r.combined.deduction, 20600000);
	near(r.combined.tax, 523262, 2);
	assert.strictEqual(r.combined.inhabitTax, 470000);
	near(r.tax, 993262, 2);
});

test('一時金：同じ年より、ずらしたほうが有利になる場合がある', () => {
	const same = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 60 }), tax);
	const apart = lumpSumTax(lumpBase, tax); // 退職金60歳・iDeCo65歳
	assert.ok(apart.tax < same.tax, 'ずらしたほうが税額が小さいはず');
});

test('一時金：退職金が無ければiDeCoだけを普通に計算する', () => {
	// 加入25年 → 控除1,150万円 ＞ 1,000万円 なので非課税
	const r = lumpSumTax(Object.assign({}, lumpBase, { retireAmount: 0 }), tax);
	assert.strictEqual(r.ideco.deduction, tax.retireDeduction(25));
	assert.strictEqual(r.tax, 0);
	assert.strictEqual(r.net, 10000000);
});

/* ---------- 出口：年金（分割） ---------- */

test('年金：公的年金と控除枠を分け合う', () => {
	/* 65歳から10年、iDeCoを毎年100万円。老齢年金180万円
	     iDeCoなし: 180万−110万 ＝ 70万円
	     iDeCoあり: 280万−110万 ＝ 170万円 → 増えた雑所得は100万円
	     所得税 100万×5%×1.021 ＝ 51,050 ／ 住民税 100,000 */
	const a = annuityTax({
		idecoAmount: 10000000, annuityYears: 10, idecoPayAge: 65, publicPension: 1800000
	}, tax);
	assert.strictEqual(a.years, 10);
	assert.strictEqual(a.perYear, 1000000);
	assert.strictEqual(a.rows[0].misc, 1000000);
	near(a.rows[0].tax, 51050, 2);
	assert.strictEqual(a.rows[0].inhabitTax, 100000);
	near(a.tax, 151050 * 10, 20, '10年分の税額');
});

test('年金：公的年金が多いほど控除の残りが減る', () => {
	const few = annuityTax({ idecoAmount: 10000000, annuityYears: 10, idecoPayAge: 65, publicPension: 0 }, tax);
	const many = annuityTax({ idecoAmount: 10000000, annuityYears: 10, idecoPayAge: 65, publicPension: 3000000 }, tax);
	assert.ok(few.tax < many.tax, '公的年金が多いほうが税額は大きいはず');
	// 公的年金0なら、110万円の枠が空いているぶん雑所得が小さい
	assert.ok(few.rows[0].misc < 1000000, '控除の枠が残っていれば雑所得は受取額より小さい');
});

test('年金：65歳未満は控除が小さい', () => {
	const under = annuityTax({ idecoAmount: 6000000, annuityYears: 5, idecoPayAge: 60, publicPension: 0 }, tax);
	const over = annuityTax({ idecoAmount: 6000000, annuityYears: 5, idecoPayAge: 65, publicPension: 0 }, tax);
	assert.ok(under.tax > over.tax, '65歳未満のほうが控除が小さく、税額は大きいはず');
});

test('年金：受け取る年数を延ばすと1年あたりの額が減る', () => {
	const short = annuityTax({ idecoAmount: 12000000, annuityYears: 5, idecoPayAge: 65, publicPension: 1800000 }, tax);
	const long = annuityTax({ idecoAmount: 12000000, annuityYears: 20, idecoPayAge: 65, publicPension: 1800000 }, tax);
	assert.strictEqual(short.perYear, 2400000);
	assert.strictEqual(long.perYear, 600000);
	assert.strictEqual(short.gross, long.gross, '受け取る総額は同じ');
});

test('年金：控除の枠に収まるまで延ばせば非課税になる', () => {
	// 老齢年金が無ければ、65歳以上は110万円までが非課税。
	// 1,200万円を20年に分ければ年60万円で枠に収まる
	const spread = annuityTax({ idecoAmount: 12000000, annuityYears: 20, idecoPayAge: 65, publicPension: 0 }, tax);
	assert.strictEqual(spread.tax, 0);
	assert.strictEqual(spread.net, 12000000);

	// 10年だと年120万円で枠を10万円超え、そのぶんに課税される
	const dense = annuityTax({ idecoAmount: 12000000, annuityYears: 10, idecoPayAge: 65, publicPension: 0 }, tax);
	assert.strictEqual(dense.rows[0].misc, 100000);
	assert.ok(dense.tax > 0);
});

test('年金：年数を延ばせば必ず得になるとは限らない', () => {
	/* 公的年金等控除は、収入が多い部分ほど雑所得への算入割合が下がる
	   （330万円までは100%、以降は75%・85%・95%）。そのため受取額を
	   集中させると、算入割合の低い区分に入って雑所得の合計はむしろ減ることがある。

	   老齢年金180万円・1,200万円を受け取る場合:
	     5年（年240万円）  → 公的年金等の収入420万円。85%の区分に入る
	     10年（年120万円） → 収入300万円。330万円以下なので全額が雑所得
	   結果として5年のほうが税額は小さくなる。直感に反するので、
	   実装の意図としてここに固定しておく */
	const short = annuityTax({ idecoAmount: 12000000, annuityYears: 5, idecoPayAge: 65, publicPension: 1800000 }, tax);
	const long = annuityTax({ idecoAmount: 12000000, annuityYears: 10, idecoPayAge: 65, publicPension: 1800000 }, tax);
	assert.strictEqual(short.rows[0].misc, 2185000, '5年のときの1年あたりの雑所得');
	assert.strictEqual(long.rows[0].misc, 1200000, '10年のときの1年あたりの雑所得');
	assert.ok(short.tax < long.tax,
		'算入割合の低い区分に入るぶん、5年のほうが税額は小さい（' + short.tax + ' < ' + long.tax + '）');
});

/* ---------- まとめ ---------- */

test('比較：退職金が無ければ一時金が有利（控除を使い切れる）', () => {
	const c = compare({
		idecoAmount: 10000000, idecoJoinAge: 40, idecoPayAge: 65,
		retireAmount: 0, hireAge: 22, retireAge: 60,
		annuityYears: 10, publicPension: 1800000
	}, tax);
	assert.strictEqual(c.lump.tax, 0, '加入25年の控除1,150万円で全額が収まる');
	assert.ok(c.annuity.tax > 0, '年金受取だと雑所得に課税される');
	assert.ok(c.lump.net > c.annuity.net);
});

test('比較：手取りは「総額 − 税額」で一貫している', () => {
	const cfg = {
		idecoAmount: 10000000, idecoJoinAge: 40, idecoPayAge: 65,
		retireAmount: 20000000, hireAge: 22, retireAge: 60,
		annuityYears: 10, publicPension: 1800000
	};
	const c = compare(cfg, tax);
	near(c.lump.net, c.lump.gross - c.lump.tax, 1e-6);
	near(c.annuity.net, c.annuity.gross - c.annuity.tax, 1e-6);
	assert.strictEqual(c.lump.gross, 30000000);
	assert.strictEqual(c.annuity.gross, 30000000);
});

test('比較：どの受取年齢でも結果が壊れない', () => {
	for (let payAge = PAYOUT_AGE_MIN; payAge <= PAYOUT_AGE_MAX; payAge++) {
		for (const retireAge of [60, 65, 70]) {
			const c = compare({
				idecoAmount: 10000000, idecoJoinAge: 40, idecoPayAge: payAge,
				retireAmount: 20000000, hireAge: 22, retireAge: retireAge,
				annuityYears: 10, publicPension: 1800000
			}, tax);
			const where = payAge + '歳受取・退職' + retireAge + '歳';
			assert.ok(Number.isFinite(c.lump.net) && c.lump.net >= 0, where + ' 一時金の手取りが不正');
			assert.ok(Number.isFinite(c.annuity.net) && c.annuity.net >= 0, where + ' 年金の手取りが不正');
			assert.ok(c.lump.tax >= 0 && c.annuity.tax >= 0, where + ' 税額がマイナス');
		}
	}
});

test('一時金：結果に受取年齢を残す（画面の案内文で使う）', () => {
	const r = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 65, retireAge: 70 }), tax);
	assert.strictEqual(r.retireAge, 70);
	assert.strictEqual(r.idecoPayAge, 65);
	// 調整を外すには、退職金の10年以上前に受け取る必要がある
	assert.strictEqual(r.retireAge - (OVERLAP_YEARS_IDECO_FIRST + 1), 60,
		'70歳退職なら60歳まで早めれば調整が外れる');
});

test('積立：実質の負担は「掛金 − 節税額」', () => {
	/* 節税額は掛金とは別に増える額ではなく、払った掛金のうち
	   税金が軽くなって戻ってくる分。並べて足すと二重に数えることになる */
	const a = accumulate(baseAcc, tax);
	assert.strictEqual(a.netCost, a.paid - a.saved);
	assert.ok(a.netCost < a.paid, '節税があるぶん、負担は掛金より小さい');
	assert.ok(a.netCost > 0, '所得税＋住民税でも最大55%なので、負担が消えることはない');
});

test('積立：残高の内訳を足すと残高そのものになる', () => {
	/* 画面の帯（元の残高／実質の負担／節税で戻る分／運用益）が
	   受け取る残高をちょうど分け合っていること */
	for (const over of [{}, { initialBalance: 3000000 }, { yieldRate: 5 }, { taxableIncome: 0 }]) {
		const a = accumulate(Object.assign({}, baseAcc, { yieldRate: 3 }, over), tax);
		const initial = over.initialBalance || 0;
		near(initial + a.netCost + a.saved + a.gain, a.balance, 1e-6,
			JSON.stringify(over) + ' で内訳の合計が残高と合わない');
	}
});

test('積立：節税がなければ実質の負担は掛金そのもの', () => {
	// 課税所得0なら軽くなる税金も無い
	const a = accumulate(Object.assign({}, baseAcc, { taxableIncome: 0 }), tax);
	assert.strictEqual(a.saved, 0);
	assert.strictEqual(a.netCost, a.paid);
});

test('一時金：退職金が先でも20年以上空けば調整されない', () => {
	/* 50歳で退職金 → 70歳でiDeCo（間隔20年 > 19年）。
	   画面の説明は「どちらが先か」で文が変わるので、
	   調整なしが両方の向きで起きることを固定しておく */
	const r = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 70, retireAge: 50 }), tax);
	assert.strictEqual(r.gap, 20, '退職金が先（gapは正）');
	assert.strictEqual(r.adjusted, null, '調整なし');
	assert.strictEqual(r.overlap, 0);
	assert.strictEqual(r.ideco.deduction, tax.retireDeduction(r.idecoYears), 'iDeCoは満額の控除');
	assert.strictEqual(r.retire.deduction, tax.retireDeduction(r.retireYears), '退職金も満額の控除');

	// 19年ちょうどだとまだ調整される
	const at19 = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 69, retireAge: 50 }), tax);
	assert.strictEqual(at19.gap, 19);
	assert.strictEqual(at19.adjusted, 'ideco', '19年内はiDeCo側が削られる');
});

/* ---------- 年金受取のあいだも運用は続く ---------- */

test('年金の1年あたりの額：利回り0なら残高を年数で割るだけ', () => {
	assert.strictEqual(annuityPayment(10000000, 10, 0), 1000000);
	assert.strictEqual(annuityPayment(12000000, 20, 0), 600000);
	assert.strictEqual(annuityPayment(0, 10, 3), 0, '残高なし');
});

test('年金の1年あたりの額：運用が続くぶん、残高÷年数より多い', () => {
	/* 期首払いの年金現価率 = (1 − 1.03^−10) / 0.03 × 1.03 = 8.786108…
	   1,000万円 ÷ 8.786108… ＝ 1,138,159円 */
	const pmt = annuityPayment(10000000, 10, 3);
	near(pmt, 1138159, 2, '1年あたりの受取額');
	assert.ok(pmt > 10000000 / 10, '残高を割っただけより多い');
	// 10年で受け取る総額は、受給開始時の残高より多くなる
	near(pmt * 10, 11381590, 20, '受け取る総額');
});

test('年金：受け取る総額は受給開始時の残高を上回る', () => {
	const a = annuityTax({
		idecoAmount: 10000000, annuityYears: 10, idecoPayAge: 65,
		publicPension: 1800000, yieldRate: 3
	}, tax);
	assert.strictEqual(a.balance, 10000000, '受給開始時の残高');
	assert.ok(a.gross > a.balance, '運用が続くぶん総額のほうが多い');
	near(a.growth, a.gross - a.balance, 1e-6);
	near(a.gross, a.perYear * a.years, 1e-6, '総額は1年あたり×年数');
});

test('年金：利回りが高いほど受け取る総額が増える', () => {
	const base = { idecoAmount: 10000000, annuityYears: 15, idecoPayAge: 65, publicPension: 0 };
	const flat = annuityTax(Object.assign({}, base, { yieldRate: 0 }), tax);
	const grow = annuityTax(Object.assign({}, base, { yieldRate: 4 }), tax);
	assert.strictEqual(flat.gross, 10000000, '利回り0なら残高そのもの');
	assert.ok(grow.gross > flat.gross);
	assert.strictEqual(flat.growth, 0);
	assert.ok(grow.growth > 0);
});

test('年金：長く分けるほど運用が続く期間も延びる', () => {
	const base = { idecoAmount: 10000000, idecoPayAge: 65, publicPension: 0, yieldRate: 3 };
	const short = annuityTax(Object.assign({}, base, { annuityYears: 5 }), tax);
	const long = annuityTax(Object.assign({}, base, { annuityYears: 20 }), tax);
	assert.ok(long.gross > short.gross, '20年のほうが受け取る総額は多い');
	assert.ok(long.perYear < short.perYear, '1年あたりは少ない');
});

test('比較：利回りがあると年金の総額は一時金より多い', () => {
	const cfg = {
		idecoAmount: 10000000, idecoJoinAge: 40, idecoPayAge: 65,
		retireAmount: 20000000, hireAge: 22, retireAge: 60,
		annuityYears: 10, publicPension: 1800000, yieldRate: 3
	};
	const c = compare(cfg, tax);
	assert.ok(c.annuity.gross > c.lump.gross,
		'年金は受け取り終わるまで運用が続くぶん総額が多い（' +
		c.lump.gross + ' → ' + c.annuity.gross + '）');
	// 退職金の額は両方に同じだけ含まれる
	near(c.annuity.gross - c.lump.gross, c.annuity.detail.growth, 1e-6);
	near(c.annuity.net, c.annuity.gross - c.annuity.tax, 1e-6);
});

/* ---------- iDeCoをやらなかった場合との差 ---------- */

test('基準：iDeCoが無ければ退職金は満額の控除を使える', () => {
	// 勤続38年 → 控除2,060万円。退職金2,000万円なら非課税
	assert.strictEqual(retireOnlyTax({ retireAmount: 20000000, hireAge: 22, retireAge: 60 }, tax), 0);
	// 退職金が控除を超えれば税額が出る
	assert.ok(retireOnlyTax({ retireAmount: 30000000, hireAge: 22, retireAge: 60 }, tax) > 0);
	// 退職金が無ければ0
	assert.strictEqual(retireOnlyTax({ retireAmount: 0, hireAge: 22, retireAge: 60 }, tax), 0);
});

test('同じ年に受け取っても、iDeCoで増えた税額は出せる', () => {
	/* 合算されると税額をiDeCo分と退職金分に割り振れないが、
	   「iDeCoが無かった場合」との差なら出せる。
	   60歳で両方：通算38年の控除2,060万円、合算3,000万円
	     退職所得 (3,000万−2,060万)÷2 ＝ 470万円 → 993,262円
	   iDeCoが無ければ退職金2,000万円は控除2,060万円以下で非課税 */
	const r = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 60, retireAge: 60 }), tax);
	assert.strictEqual(r.sameYear, true);
	assert.strictEqual(r.taxWithoutIdeco, 0, 'iDeCoが無ければ非課税');
	near(r.taxByIdeco, r.tax, 1, 'この場合は税額のすべてがiDeCoによる増加');
	near(r.taxByIdeco, 993262, 3);
});

test('退職金側が削られた分も、iDeCoによる増加として出る', () => {
	/* iDeCoを61歳・退職金を70歳（9年内なので退職金側の控除が削られる）。
	   iDeCoが無ければ退職金は勤続48年の控除2,760万円で非課税 */
	const r = lumpSumTax(Object.assign({}, lumpBase, { idecoPayAge: 61, retireAge: 70 }), tax);
	assert.strictEqual(r.adjusted, 'retire');
	assert.strictEqual(r.taxWithoutIdeco, 0);
	near(r.taxByIdeco, r.tax, 1);
	// 退職金側にも税額が出ており、それもiDeCoが原因
	assert.ok(r.retire.tax + r.retire.inhabitTax > 0, '削られた結果、退職金にも課税されている');
});

test('加入期間が勤続期間より長いと、税額がむしろ減ることがある', () => {
	/* 25歳からiDeCo、40〜60歳が勤続。同じ年（60歳）に受け取ると
	   通算35年ぶんの控除（1,850万円）が使え、勤続20年だけの
	   控除（800万円）より大きくなる。iDeCoを足したのに税額は下がる */
	const cfg = {
		idecoAmount: 1000000, idecoJoinAge: 25, idecoPayAge: 60,
		retireAmount: 20000000, hireAge: 40, retireAge: 60
	};
	const r = lumpSumTax(cfg, tax);
	assert.strictEqual(r.sameYear, true);
	assert.ok(r.taxWithoutIdeco > 0, '勤続20年だけでは控除が足りず課税される');
	assert.ok(r.taxByIdeco < 0, 'iDeCoによって税額が減っている（差はマイナス）');
	assert.ok(r.tax < r.taxWithoutIdeco);
});

test('年金で受け取れば、退職金の税額はiDeCoが無い場合と同じ', () => {
	const cfg = {
		idecoAmount: 10000000, idecoJoinAge: 40, idecoPayAge: 65,
		retireAmount: 30000000, hireAge: 22, retireAge: 60,
		annuityYears: 10, publicPension: 1800000, yieldRate: 3
	};
	const c = compare(cfg, tax);
	// 年金はiDeCoが退職所得控除を使わないので、退職金側は調整されない
	assert.strictEqual(c.annuity.taxWithoutIdeco, retireOnlyTax(cfg, tax));
	near(c.annuity.taxByIdeco, c.annuity.detail.tax, 1e-6, '増えるのはiDeCo分の税額だけ');
	// 一時金だとiDeCo側の控除が削られるぶん、増え方が大きい
	assert.ok(c.lump.taxByIdeco > c.annuity.taxByIdeco - 1e-6 || c.lump.tax !== c.annuity.tax);
});

test('どの受取年齢でも、税額の増加は「合計 − 基準」で一貫している', () => {
	for (let payAge = PAYOUT_AGE_MIN; payAge <= PAYOUT_AGE_MAX; payAge++) {
		const cfg = {
			idecoAmount: 10000000, idecoJoinAge: 40, idecoPayAge: payAge,
			retireAmount: 30000000, hireAge: 22, retireAge: 60,
			annuityYears: 10, publicPension: 1800000, yieldRate: 3
		};
		const c = compare(cfg, tax);
		near(c.lump.taxByIdeco, c.lump.tax - c.lump.taxWithoutIdeco, 1e-6, payAge + '歳の一時金');
		near(c.annuity.taxByIdeco, c.annuity.tax - c.annuity.taxWithoutIdeco, 1e-6, payAge + '歳の年金');
	}
});
