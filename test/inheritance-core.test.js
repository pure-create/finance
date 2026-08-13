/* 相続税の計算のテスト。
   期待値は国税庁の速算表から手で計算したもので、コードの出力を写したものではない。
   制度改正で税率や控除額を直したときは、まずここの数字を直すこと。

   実行: npm test   （プロジェクト直下から） */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { taxOnShare, totalTax, simulate } = require('../inheritance/js/inheritance-core.js');

// 万円単位の金額を比べる。円未満のずれは無視する
function near(actual, expected, msg) {
	assert.ok(Math.abs(actual - expected) < 1e-6,
		(msg || '') + ' 期待 ' + expected + ' / 実際 ' + actual);
}

test('速算表：各区分の上限ちょうどの税額', () => {
	// 相続税の速算表（平成27年1月1日以後）。金額は万円
	near(taxOnShare(1000), 100, '1,000万円 10%');
	near(taxOnShare(3000), 400, '3,000万円 15%−50');
	near(taxOnShare(5000), 800, '5,000万円 20%−200');
	near(taxOnShare(10000), 2300, '1億円 30%−700');
	near(taxOnShare(20000), 6300, '2億円 40%−1,700');
	near(taxOnShare(30000), 10800, '3億円 45%−2,700');
	near(taxOnShare(60000), 25800, '6億円 50%−4,200');
	near(taxOnShare(100000), 47800, '10億円 55%−7,200');
});

test('速算表：区分の境目で税額が飛ばない', () => {
	// 控除額は「境目で連続になる」ように決まっている。
	// 片方の区分だけ直すと、ここが飛んで気付ける
	for (const lim of [1000, 3000, 5000, 10000, 20000, 30000, 60000]) {
		const below = taxOnShare(lim);
		const above = taxOnShare(lim + 0.01);
		assert.ok(above >= below, lim + '万円の前後で税額が減っている');
		assert.ok(above - below < 0.01, lim + '万円の境目で税額が飛んでいる');
	}
});

test('速算表：0以下は課税されない', () => {
	near(taxOnShare(0), 0);
	near(taxOnShare(-100), 0);
});

test('基礎控除ちょうどでは相続税がかからない', () => {
	// 配偶者＋子1人 ＝ 法定相続人2人 → 3,000＋600×2 ＝ 4,200万円
	near(totalTax(4200, true, 1), 0, '基礎控除ちょうど');
	near(totalTax(4199, true, 1), 0, '基礎控除未満');
	// 1万円超えると、その1万円だけが課税対象になる
	near(totalTax(4201, true, 1), 0.1, '基礎控除＋1万円');

	// 子3人（配偶者なし）＝ 3,000＋600×3 ＝ 4,800万円
	near(totalTax(4800, false, 3), 0, '子3人の基礎控除ちょうど');
});

test('相続税の総額（教科書どおりの例）', () => {
	// 遺産1億円・配偶者＋子2人:
	//   課税遺産総額 10,000−4,800 ＝ 5,200
	//   配偶者 2,600 → 2,600×15%−50 ＝ 340
	//   子 各1,300 → 1,300×15%−50 ＝ 145、2人で290
	near(totalTax(10000, true, 2), 630, '1億円・配偶者と子2人');

	// 遺産1億円・子1人のみ:
	//   課税遺産総額 10,000−3,600 ＝ 6,400 → 6,400×30%−700 ＝ 1,220
	near(totalTax(10000, false, 1), 1220, '1億円・子1人');

	// 配偶者のみ（子なし）: 課税遺産総額の全額に1人分の税率
	//   10,000−3,600 ＝ 6,400 → 1,220
	near(totalTax(10000, true, 0), 1220, '1億円・配偶者のみ');
});

test('配偶者の税額軽減：1億6,000万円までは配偶者に税額が出ない', () => {
	// 遺産1.6億円を配偶者が全部取得 → 軽減の上限ちょうどで税額ゼロ
	const r = simulate(16000, 0, true, 1, 100, 0, 10);
	near(r.spTax, 0, '配偶者の税額');
	near(r.first, 0, '一次相続の税額合計');

	// 1.6億円を超えた分には税額が出る
	const over = simulate(20000, 0, true, 1, 100, 0, 10);
	// 総額 3,340（課税遺産総額 15,800 → 配偶者・子 各7,900 → 各1,670）
	near(over.total1, 3340, '相続税の総額');
	// 軽減されるのは 16,000/20,000 ＝ 8割 → 残り2割が配偶者の負担
	near(over.spTax, 668, '軽減後の配偶者の税額');
});

test('配偶者の税額軽減：法定相続分までなら額が大きくても税額ゼロ', () => {
	// 4億円を法定相続分（1/2 ＝ 2億円）だけ取得 → 1.6億円より法定相続分が大きい
	const r = simulate(40000, 0, true, 1, 50, 0, 10);
	near(r.spTax, 0, '法定相続分どおりに取得した配偶者の税額');
});

test('相次相続控除：10年で切れる', () => {
	// 2億円・配偶者が全部取得・配偶者の固有資産0
	//   一次: 配偶者の税額 668 → 二次の遺産 20,000−668 ＝ 19,332
	//   二次: 19,332−3,600 ＝ 15,732 → 15,732×40%−1,700 ＝ 4,592.8
	const base = { me: 20000, sp: 0, pct: 100 };
	const at10 = simulate(base.me, base.sp, true, 1, base.pct, 0, 10);
	near(at10.deduct, 0, '10年経過後は控除なし');
	near(at10.second, 4592.8, '二次相続の税額');

	// 9年 → 控除は「配偶者が納めた税額 668」の 1/10
	const at9 = simulate(base.me, base.sp, true, 1, base.pct, 0, 9);
	near(at9.deduct, 66.8, '9年経過時の相次相続控除');
	near(at9.second, 4526, '控除後の二次相続の税額');

	// 0年（すぐに二次相続）→ 全額（10/10）が控除される
	const at0 = simulate(base.me, base.sp, true, 1, base.pct, 0, 0);
	near(at0.deduct, 668, '0年経過時の相次相続控除');

	// 経過年数が延びるほど控除は減る
	let prev = Infinity;
	for (let y = 0; y <= 10; y++) {
		const d = simulate(base.me, base.sp, true, 1, base.pct, 0, y).deduct;
		assert.ok(d <= prev + 1e-9, y + '年で控除額が増えている');
		prev = d;
	}
});

test('相次相続控除は二次相続の税額を超えない', () => {
	// 二次の税額より控除のほうが大きくなる形でも、税額はマイナスにならない
	const r = simulate(40000, 0, true, 3, 100, -30000, 0);
	assert.ok(r.second >= 0, '二次相続の税額がマイナス');
	assert.ok(r.deduct <= r.second + r.deduct + 1e-9);
});

test('配偶者がいない場合は二次相続が起きない', () => {
	const r = simulate(10000, 5000, false, 2, 50, 0, 5);
	near(r.second, 0, '二次相続の税額');
	near(r.first, r.total1, '一次相続の税額');
	near(r.keep, 10000 - r.total1, '子に残る額');
});

test('子に残る額＝総資産−税額合計', () => {
	const r = simulate(15000, 3000, true, 2, 40, 500, 6);
	// 総資産 ＝ 自分15,000 ＋ 配偶者3,000 ＋ 増減500
	near(r.keep, 15000 + 3000 + 500 - r.grand, '手残りと税額合計の関係');
	near(r.grand, r.first + r.second, '税額合計');
});

test('取得割合を動かしても税額合計は有限で、最小になる割合が存在する', () => {
	let best = Infinity, bestPct = -1;
	for (let p = 0; p <= 100; p++) {
		const r = simulate(20000, 3000, true, 2, p, 0, 10);
		assert.ok(Number.isFinite(r.grand), p + '%で税額合計が数値でない');
		assert.ok(r.grand >= 0, p + '%で税額合計がマイナス');
		if (r.grand < best) { best = r.grand; bestPct = p; }
	}
	assert.ok(bestPct >= 0 && bestPct <= 100);
});

test('資産ゼロでも壊れない', () => {
	const r = simulate(0, 0, true, 1, 50, 0, 5);
	near(r.grand, 0);
	near(r.keep, 0);
});
