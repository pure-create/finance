/* 退職手当の計算のテスト。
   期待値は制度の規定から手で計算したもので、コードの出力を写したものではない。
   支給率・税率・定年の引き上げ方を改正で直したときは、まずここの数字を直すこと。

   実行: npm test   （プロジェクト直下から） */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
	own_rate, compulsory_rate, getRate, retireDeduction, teinenAge, calcTax
} = require('../retirement/js/retire-calc.js');

test('支給率の表は0〜50年の51個ある', () => {
	assert.strictEqual(own_rate.length, 51, '自己都合');
	assert.strictEqual(compulsory_rate.length, 51, '定年・勧奨');
});

test('支給率は勤続年数が延びても下がらない', () => {
	for (let y = 1; y < own_rate.length; y++) {
		assert.ok(own_rate[y] >= own_rate[y - 1], '自己都合 ' + y + '年で支給率が下がっている');
		assert.ok(compulsory_rate[y] >= compulsory_rate[y - 1], '定年勧奨 ' + y + '年で支給率が下がっている');
	}
});

test('支給率は同じ勤続年数なら定年・勧奨のほうが手厚い', () => {
	for (let y = 0; y < own_rate.length; y++) {
		assert.ok(compulsory_rate[y] >= own_rate[y], y + '年で自己都合のほうが高い');
	}
});

test('支給率の上限は47.709で頭打ち', () => {
	assert.strictEqual(own_rate[own_rate.length - 1], 47.709);
	assert.strictEqual(compulsory_rate[compulsory_rate.length - 1], 47.709);
	// 定年・勧奨は35年で、自己都合は43年で上限に達する
	assert.strictEqual(compulsory_rate[35], 47.709);
	assert.ok(compulsory_rate[34] < 47.709);
	assert.strictEqual(own_rate[43], 47.709);
	assert.ok(own_rate[42] < 47.709);
});

test('getRate：表の範囲外は端の値に丸める', () => {
	assert.strictEqual(getRate(own_rate, 0), own_rate[0]);
	assert.strictEqual(getRate(own_rate, -5), own_rate[0], '負の年数');
	assert.strictEqual(getRate(own_rate, 50), 47.709);
	assert.strictEqual(getRate(own_rate, 99), 47.709, '表を超える年数');
});

test('退職所得控除：20年までは1年40万円', () => {
	assert.strictEqual(retireDeduction(3), 1200000);
	assert.strictEqual(retireDeduction(10), 4000000);
	assert.strictEqual(retireDeduction(20), 8000000, '20年ちょうど');
});

test('退職所得控除：20年を超えた分は1年70万円', () => {
	assert.strictEqual(retireDeduction(21), 8700000, '20年の境目');
	assert.strictEqual(retireDeduction(30), 15000000);
	assert.strictEqual(retireDeduction(38), 20600000);
	// 境目で40万円→70万円に切り替わる
	assert.strictEqual(retireDeduction(21) - retireDeduction(20), 700000);
	assert.strictEqual(retireDeduction(20) - retireDeduction(19), 400000);
});

test('退職所得控除：下限は80万円', () => {
	assert.strictEqual(retireDeduction(0), 800000, '勤続0年');
	assert.strictEqual(retireDeduction(1), 800000, '40万円では下限を下回る');
	assert.strictEqual(retireDeduction(2), 800000, '80万円ちょうど');
	assert.strictEqual(retireDeduction(3), 1200000, '下限を上回ったら計算どおり');
});

test('定年年齢：2023年度から2年に1歳ずつ65歳まで', () => {
	assert.strictEqual(teinenAge(2022), 60, '引き上げ前');
	assert.strictEqual(teinenAge(2023), 61);
	assert.strictEqual(teinenAge(2024), 61);
	assert.strictEqual(teinenAge(2025), 62);
	assert.strictEqual(teinenAge(2026), 62);
	assert.strictEqual(teinenAge(2027), 63);
	assert.strictEqual(teinenAge(2029), 64);
	assert.strictEqual(teinenAge(2031), 65, '65歳に到達');
	assert.strictEqual(teinenAge(2033), 65, '65歳で頭打ち');
	assert.strictEqual(teinenAge(2050), 65);
});

test('税額：控除額以下なら課税されない', () => {
	assert.deepStrictEqual(calcTax(8000000, 8000000), { tax: 0, inhabitTax: 0 }, '控除額ちょうど');
	assert.deepStrictEqual(calcTax(5000000, 8000000), { tax: 0, inhabitTax: 0 }, '控除額未満');
	assert.deepStrictEqual(calcTax(0, 800000), { tax: 0, inhabitTax: 0 }, '支給額0');
});

test('税額：退職所得は2分の1にして1,000円未満を切り捨てる', () => {
	// 控除超過 2,000円 → 退職所得 1,000円
	const r = calcTax(8002000, 8000000);
	assert.strictEqual(r.inhabitTax, 100, '住民税は退職所得の10%');
	// 所得税 1,000×5%×1.021 ＝ 51.05 → 切り捨てて51
	assert.strictEqual(r.tax, 51);

	// 控除超過 1,000円 → 退職所得 500円 → 1,000円未満切り捨てで0
	assert.deepStrictEqual(calcTax(8001000, 8000000), { tax: 0, inhabitTax: 0 });

	// 控除超過 5,000円 → 2,500円 → 切り捨てて2,000円
	assert.strictEqual(calcTax(8005000, 8000000).inhabitTax, 200);
});

/* 所得税は最後に復興特別所得税ぶんの1.021を掛けて切り捨てるため、
   二進小数の丸めで手計算より1円小さくなることがある
   （例: 13,204,000×1.021 は 13,481,283.999… になり、切り捨てで1円減る）。
   区分や税率の取り違えを見つけるのが目的なので、1円までは許容する */
function taxNear(actual, expected, msg) {
	assert.ok(Math.abs(actual - expected) <= 1,
		(msg || '') + ' 期待 ' + expected + '円 / 実際 ' + actual + '円');
}

test('税額：所得税の税率区分の境目', () => {
	const koujo = 8000000;
	// 退職所得 195万円ちょうど（＝控除超過390万円）は5%の区分
	// 1,950,000×5%×1.021 ＝ 99,547.5 → 99,547
	taxNear(calcTax(koujo + 3900000, koujo).tax, 99547, '5%の区分の上限');

	// ひとつ上の区分（10%）へ入っても税額は飛ばない
	// 1,951,000×10%−97,500 ＝ 97,600 → ×1.021 ＝ 99,649.6 → 99,649
	taxNear(calcTax(koujo + 3902000, koujo).tax, 99649, '10%の区分の下端');

	// 退職所得 4,000万円ちょうどは40%の区分
	// 40,000,000×40%−2,796,000 ＝ 13,204,000 → ×1.021 ＝ 13,481,284
	taxNear(calcTax(koujo + 80000000, koujo).tax, 13481284, '40%の区分の上限');

	// 4,000万円を超えると45%の区分
	// 40,001,000×45%−4,796,000 ＝ 13,204,450 → ×1.021 ＝ 13,481,743.45 → 13,481,743
	taxNear(calcTax(koujo + 80002000, koujo).tax, 13481743, '45%の区分の下端');
});

test('税額：区分の境目で税額が飛ばない', () => {
	// 控除額を0とみなし、退職所得が境目をまたぐところを見る。
	// price ＝ 退職所得×2 なので、境目の退職所得は price/2
	const koujo = 800000;
	for (const kazei of [1950000, 3300000, 6950000, 9000000, 18000000, 40000000]) {
		const below = calcTax(koujo + kazei * 2, koujo).tax;
		const above = calcTax(koujo + (kazei + 1000) * 2, koujo).tax;
		assert.ok(above >= below, kazei + '円の前後で所得税が減っている');
		// 1,000円分の増加に対する税額の増加が、最高税率55%相当を超えないこと
		assert.ok(above - below < 1000 * 0.55 + 1,
			kazei + '円の境目で所得税が飛んでいる（差 ' + (above - below) + '円）');
	}
});

test('税額：住民税は所得割10%（都道府県4%＋市町村6%）', () => {
	const koujo = 8000000;
	assert.strictEqual(calcTax(koujo + 20000000, koujo).inhabitTax, 1000000, '退職所得1,000万円');
});

test('支給額の目安：勤続35年・給料月額40万円の定年退職', () => {
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
	taxNear(t.tax, 14855, '所得税');
});
