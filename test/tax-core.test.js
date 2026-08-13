/* サイト共通の税額の計算（common/tax-core.js）のテスト。
   期待値は速算表から手で計算したもので、コードの出力を写したものではない。
   税率や控除額を改正で直したときは、まずここの数字を直すこと。

   実行: npm test   （プロジェクト直下から） */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
	roundedTaxableIncome, incomeTax, inhabitantTax,
	retireDeduction, calcTax,
	pensionMiscIncome, pensionDeduction,
	INHABITANT_TAX_RATE, RECONSTRUCTION_RATE
} = require('../common/tax-core.js');

/* 所得税は最後に復興特別所得税ぶんの1.021を掛けて切り捨てるため、
   二進小数の丸めで手計算より1円小さくなることがある
   （例: 13,204,000×1.021 は 13,481,283.999… になり、切り捨てで1円減る）。
   区分や税率の取り違えを見つけるのが目的なので、1円までは許容する */
function taxNear(actual, expected, msg) {
	assert.ok(Math.abs(actual - expected) <= 1,
		(msg || '') + ' 期待 ' + expected + '円 / 実際 ' + actual + '円');
}

/* ---------- 端数処理と税率 ---------- */

test('課税所得金額は1,000円未満を切り捨てる', () => {
	assert.strictEqual(roundedTaxableIncome(1999), 1000);
	assert.strictEqual(roundedTaxableIncome(1000), 1000);
	assert.strictEqual(roundedTaxableIncome(999), 0);
	assert.strictEqual(roundedTaxableIncome(0), 0);
	assert.strictEqual(roundedTaxableIncome(-5000), 0, 'マイナスは0');
});

test('復興特別所得税は2.1%の上乗せ', () => {
	assert.strictEqual(RECONSTRUCTION_RATE, 1.021);
});

test('住民税の所得割は10%', () => {
	assert.strictEqual(INHABITANT_TAX_RATE, 0.10);
	assert.strictEqual(inhabitantTax(3000000), 300000);
	assert.strictEqual(inhabitantTax(1999), 100, '1,000円未満を切り捨ててから10%');
	assert.strictEqual(inhabitantTax(0), 0);
});

/* ---------- 所得税の速算表 ---------- */

test('所得税：各区分の上限ちょうど', () => {
	// 課税所得 × 税率 − 控除額 に、復興特別所得税の1.021を掛けて切り捨て
	taxNear(incomeTax(1950000), 99547, '5%の上限（195万円）');
	taxNear(incomeTax(3300000), 237382, '10%の上限（330万円）');
	taxNear(incomeTax(6950000), 982712, '20%の上限（695万円）');
	taxNear(incomeTax(9000000), 1464114, '23%の上限（900万円）');
	taxNear(incomeTax(18000000), 4496484, '33%の上限（1,800万円）');
	taxNear(incomeTax(40000000), 13481284, '40%の上限（4,000万円）');
});

test('所得税：区分をひとつ上がった直後', () => {
	taxNear(incomeTax(1951000), 99649, '10%の下端');
	taxNear(incomeTax(3301000), 237586, '20%の下端');
	taxNear(incomeTax(40001000), 13481743, '45%の下端');
});

test('所得税：区分の境目で税額が飛ばない', () => {
	for (const edge of [1950000, 3300000, 6950000, 9000000, 18000000, 40000000]) {
		const below = incomeTax(edge);
		const above = incomeTax(edge + 1000);
		assert.ok(above >= below, edge + '円の前後で税額が減っている');
		// 1,000円増えたぶんの税額の増分が、最高税率55%相当を超えないこと
		assert.ok(above - below < 1000 * 0.55 + 1,
			edge + '円の境目で税額が飛んでいる（差 ' + (above - below) + '円）');
	}
});

test('所得税：課税所得が0以下なら0', () => {
	assert.strictEqual(incomeTax(0), 0);
	assert.strictEqual(incomeTax(999), 0, '1,000円未満は切り捨てて0');
	assert.strictEqual(incomeTax(-1000000), 0);
});

test('所得税：課税所得が増えれば税額も増える', () => {
	let prev = -1;
	for (let x = 0; x <= 50000000; x += 250000) {
		const t = incomeTax(x);
		assert.ok(t >= prev, x + '円で税額が減っている');
		prev = t;
	}
});

/* ---------- 退職所得 ---------- */

test('退職所得控除：20年までは1年40万円', () => {
	assert.strictEqual(retireDeduction(3), 1200000);
	assert.strictEqual(retireDeduction(10), 4000000);
	assert.strictEqual(retireDeduction(20), 8000000, '20年ちょうど');
});

test('退職所得控除：20年を超えた分は1年70万円', () => {
	assert.strictEqual(retireDeduction(21), 8700000, '20年の境目');
	assert.strictEqual(retireDeduction(30), 15000000);
	assert.strictEqual(retireDeduction(38), 20600000);
	assert.strictEqual(retireDeduction(21) - retireDeduction(20), 700000);
	assert.strictEqual(retireDeduction(20) - retireDeduction(19), 400000);
});

test('退職所得控除：下限は80万円', () => {
	assert.strictEqual(retireDeduction(0), 800000, '勤続0年');
	assert.strictEqual(retireDeduction(1), 800000, '40万円では下限を下回る');
	assert.strictEqual(retireDeduction(2), 800000, '80万円ちょうど');
	assert.strictEqual(retireDeduction(3), 1200000, '下限を上回ったら計算どおり');
});

test('退職所得の税額：控除額以下なら課税されない', () => {
	assert.deepStrictEqual(calcTax(8000000, 8000000), { tax: 0, inhabitTax: 0 }, '控除額ちょうど');
	assert.deepStrictEqual(calcTax(5000000, 8000000), { tax: 0, inhabitTax: 0 }, '控除額未満');
	assert.deepStrictEqual(calcTax(0, 800000), { tax: 0, inhabitTax: 0 }, '支給額0');
});

test('退職所得の税額：2分の1にして1,000円未満を切り捨てる', () => {
	// 控除超過 2,000円 → 退職所得 1,000円
	const r = calcTax(8002000, 8000000);
	assert.strictEqual(r.inhabitTax, 100, '住民税は退職所得の10%');
	// 1,000×5%×1.021 ＝ 51.05 → 51
	assert.strictEqual(r.tax, 51);

	// 控除超過 1,000円 → 退職所得 500円 → 切り捨てて0
	assert.deepStrictEqual(calcTax(8001000, 8000000), { tax: 0, inhabitTax: 0 });

	// 控除超過 5,000円 → 2,500円 → 切り捨てて2,000円
	assert.strictEqual(calcTax(8005000, 8000000).inhabitTax, 200);
});

test('退職所得の税額：所得税の速算表と同じ表を使っている', () => {
	// 退職所得が195万円になる支給額（控除超過390万円）
	const koujo = 8000000;
	taxNear(calcTax(koujo + 3900000, koujo).tax, incomeTax(1950000), '5%の上限');
	taxNear(calcTax(koujo + 80000000, koujo).tax, incomeTax(40000000), '40%の上限');
});

/* ---------- 公的年金等 ---------- */

test('公的年金等：控除額まではは雑所得が出ない', () => {
	assert.strictEqual(pensionMiscIncome(600000, 60), 0, '65歳未満は60万円まで');
	assert.strictEqual(pensionMiscIncome(599999, 60), 0);
	assert.strictEqual(pensionMiscIncome(1100000, 65), 0, '65歳以上は110万円まで');
	assert.strictEqual(pensionMiscIncome(1099999, 65), 0);
	assert.strictEqual(pensionMiscIncome(0, 65), 0, '収入なし');
});

test('公的年金等：65歳未満の雑所得', () => {
	// 60万円超130万円以下は「収入−60万円」
	assert.strictEqual(pensionMiscIncome(1000000, 60), 400000);
	assert.strictEqual(pensionMiscIncome(1300000, 60), 700000, '130万円ちょうど');
	// 130万円超は 収入×75%−27.5万円
	assert.strictEqual(pensionMiscIncome(2000000, 64), 2000000 * 0.75 - 275000);
});

test('公的年金等：65歳以上の雑所得', () => {
	// 110万円超330万円以下は「収入−110万円」
	assert.strictEqual(pensionMiscIncome(2000000, 65), 900000);
	assert.strictEqual(pensionMiscIncome(3300000, 65), 2200000, '330万円ちょうど');
	// 330万円超は 収入×75%−27.5万円
	assert.strictEqual(pensionMiscIncome(4000000, 70), 4000000 * 0.75 - 275000);
});

test('公的年金等：65歳の前後で控除が変わる', () => {
	// 同じ収入200万円でも、65歳以上のほうが雑所得は小さい
	assert.ok(pensionMiscIncome(2000000, 65) < pensionMiscIncome(2000000, 64),
		'65歳以上のほうが控除が大きいはず');
	assert.strictEqual(pensionMiscIncome(2000000, 64), 2000000 * 0.75 - 275000);
	assert.strictEqual(pensionMiscIncome(2000000, 65), 900000);
});

test('公的年金等：区分の境目で雑所得が飛ばない', () => {
	for (const age of [60, 70]) {
		const edges = age >= 65
			? [1100000, 3300000, 4100000, 7700000, 10000000]
			: [600000, 1300000, 4100000, 7700000, 10000000];
		for (const edge of edges) {
			const below = pensionMiscIncome(edge - 1, age);
			const at = pensionMiscIncome(edge, age);
			const above = pensionMiscIncome(edge + 1, age);
			assert.ok(at >= below - 1e-6, age + '歳・' + edge + '円の手前で逆転');
			assert.ok(above >= at - 1e-6, age + '歳・' + edge + '円の直後で逆転');
			assert.ok(Math.abs(above - at) < 2, age + '歳・' + edge + '円の境目で雑所得が飛んでいる');
		}
	}
});

test('公的年金等：410万円から上は年齢によらず同じ', () => {
	for (const revenue of [4100000, 5000000, 7700000, 9000000, 10000000, 15000000]) {
		assert.strictEqual(pensionMiscIncome(revenue, 60), pensionMiscIncome(revenue, 70),
			revenue + '円で65歳未満と65歳以上が食い違っている');
	}
});

test('公的年金等：1,000万円を超えると控除は195.5万円で頭打ち', () => {
	assert.strictEqual(pensionMiscIncome(10000000, 70), 10000000 - 1955000);
	assert.strictEqual(pensionMiscIncome(20000000, 70), 20000000 - 1955000);
	assert.strictEqual(pensionDeduction(20000000, 70), 1955000);
});

test('公的年金等控除：収入が控除額に満たなければ、控除は収入まで', () => {
	// 雑所得がマイナスにならない ＝ 控除は収入を超えない
	assert.strictEqual(pensionDeduction(1000000, 70), 1000000, '110万円未満');
	assert.strictEqual(pensionDeduction(2000000, 70), 1100000, '110万円');
	assert.strictEqual(pensionDeduction(500000, 60), 500000, '60万円未満');
	assert.strictEqual(pensionDeduction(1000000, 60), 600000, '60万円');
});

test('公的年金等：収入が増えれば雑所得も増える', () => {
	for (const age of [60, 70]) {
		let prev = -1;
		for (let r = 0; r <= 20000000; r += 100000) {
			const inc = pensionMiscIncome(r, age);
			assert.ok(inc >= prev - 1e-6, age + '歳・' + r + '円で雑所得が減っている');
			prev = inc;
		}
	}
});
