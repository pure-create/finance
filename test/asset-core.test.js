/* 資産運用シミュレーターの計算のテスト。

   モンテカルロ法そのものは乱数を使うが、リスク（標準偏差）をすべて0にすると
   結果が一意に決まるので、複利や取り崩しの解析解と突き合わせられる。
   ここではその形で「計算が合っているか」を確かめている。

   実行: npm test   （プロジェクト直下から） */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
	simulate, portfolioStats, percentile, logParams, cholesky3,
	mulberry32, makeNormal, incomeAt, lumpAt
} = require('../assetSimulator/js/asset-core.js');

function near(actual, expected, tol, msg) {
	assert.ok(Math.abs(actual - expected) <= (tol || 1e-9),
		(msg || '') + ' 期待 ' + expected + ' / 実際 ' + actual);
}

/* リスクを0にした決定的な設定。上書きしたい項目だけ渡す */
function cfg(over) {
	return Object.assign({
		ageNow: 40, ageRetire: 65, ageEnd: 95,
		assetNow: 1000, contribution: 0,
		lumpSum: 0, lumpAge: 65, lumpBase: 'nominal',
		wdMode: 'fixed', withdraw: 0, wdRate: 4,
		salary: 0, salaryUntil: 0, pension: 0, pensionFrom: 200,
		alloc: [100, 0, 0], ret: [0, 0, 0], risk: [0, 0, 0], corr: [0, 0, 0],
		fee: 0, inflation: 0,
		taxOn: false, nisaOn: false, nisaUsed: 0,
		trials: 1, seed: 20260801
	}, over || {});
}

// その年の中央値残高（リスク0なら全試行が同じ値になる）
function balanceAt(sim, year) { return sim.stats[year].p50; }

test('リスク0の積立期は複利の解析解と一致する', () => {
	const sim = simulate(cfg({ ageRetire: 50, ageEnd: 50, ret: [10, 0, 0] }));
	assert.strictEqual(sim.years, 10);
	near(balanceAt(sim, 10), 1000 * Math.pow(1.1, 10), 1e-6, '10年後の残高');
	near(balanceAt(sim, 0), 1000, 1e-9, '開始時の残高');
});

test('信託報酬はリターンから差し引かれる', () => {
	const sim = simulate(cfg({ ageRetire: 50, ageEnd: 50, ret: [10, 0, 0], fee: 0.15 }));
	// 10% − 0.15% ＝ 9.85%
	near(balanceAt(sim, 10), 1000 * Math.pow(1.0985, 10), 1e-6, '手数料控除後の残高');
});

test('資産配分は加重平均で合成される', () => {
	// 株式50%（10%）＋債券50%（2%）→ 6%
	const sim = simulate(cfg({
		ageRetire: 45, ageEnd: 45, alloc: [50, 50, 0], ret: [10, 2, 0]
	}));
	near(balanceAt(sim, 5), 1000 * Math.pow(1.06, 5), 1e-6);
});

test('配分の合計が100%でなくても割合として正規化される', () => {
	const a = simulate(cfg({ ageRetire: 45, ageEnd: 45, alloc: [50, 50, 0], ret: [10, 2, 0] }));
	const b = simulate(cfg({ ageRetire: 45, ageEnd: 45, alloc: [10, 10, 0], ret: [10, 2, 0] }));
	near(balanceAt(b, 5), balanceAt(a, 5), 1e-9, '合計20%でも比率は同じ');
});

test('積立額は毎年の年初に加わる', () => {
	// リターン0・インフレ0なら、5年で単純に5倍の積立額が乗る
	const sim = simulate(cfg({ ageRetire: 45, ageEnd: 45, contribution: 120 }));
	near(balanceAt(sim, 5), 1000 + 120 * 5, 1e-9);
});

test('積立額はインフレ率で増額される', () => {
	// 現在の物価で入力した額が、毎年 (1+インフレ率) 倍になっていく
	const sim = simulate(cfg({ ageRetire: 43, ageEnd: 43, contribution: 100, inflation: 2 }));
	const expected = 1000 + 100 * (1 + 1.02 + Math.pow(1.02, 2));
	near(balanceAt(sim, 3), expected, 1e-9);
});

test('定額取り崩しは生活費のぶんだけ残高を減らす', () => {
	const sim = simulate(cfg({
		ageNow: 65, ageRetire: 65, ageEnd: 70, assetNow: 1000, withdraw: 100
	}));
	for (let y = 1; y <= 5; y++) {
		near(balanceAt(sim, y), 1000 - 100 * y, 1e-9, y + '年後の残高');
	}
	near(sim.successRate, 1, 1e-12, '資産は尽きていない');
	assert.strictEqual(sim.depletionAges.length, 0);
});

test('生活費もインフレ率で増額される', () => {
	const sim = simulate(cfg({
		ageNow: 65, ageRetire: 65, ageEnd: 68, assetNow: 10000, withdraw: 100, inflation: 2
	}));
	const spent = 100 + 100 * 1.02 + 100 * Math.pow(1.02, 2);
	near(balanceAt(sim, 3), 10000 - spent, 1e-9);
});

test('取り崩し期の収入は生活費から差し引かれる', () => {
	// 年金180万円があれば、生活費360万円のうち180万円だけ取り崩す
	const sim = simulate(cfg({
		ageNow: 65, ageRetire: 65, ageEnd: 68, assetNow: 10000,
		withdraw: 360, pension: 180, pensionFrom: 65
	}));
	near(balanceAt(sim, 3), 10000 - 180 * 3, 1e-9);
});

test('収入が生活費を上回っても取り崩しはマイナスにならない', () => {
	const sim = simulate(cfg({
		ageNow: 65, ageRetire: 65, ageEnd: 68, assetNow: 1000,
		withdraw: 100, pension: 500, pensionFrom: 65
	}));
	near(balanceAt(sim, 3), 1000, 1e-9, '余った収入は資産に足さない');
});

test('資産が尽きた年齢と成功率が記録される', () => {
	// 100万円しかないのに毎年100万円使う → 2年目に足りなくなる
	const sim = simulate(cfg({
		ageNow: 65, ageRetire: 65, ageEnd: 68, assetNow: 100, withdraw: 100
	}));
	near(sim.successRate, 0, 1e-12, '成功率');
	assert.deepStrictEqual(Array.from(sim.depletionAges), [66], '資産が尽きた年齢');
	near(sim.medianDepletionAge, 66, 1e-12);
});

test('退職金は名目のままなら物価で増えない', () => {
	// 60歳開始・65歳で受け取り・全期間が積立期
	const base = { ageNow: 60, ageRetire: 70, ageEnd: 66, assetNow: 0, lumpSum: 2000, lumpAge: 65, inflation: 2 };
	const nominal = simulate(cfg(Object.assign({}, base, { lumpBase: 'nominal' })));
	near(balanceAt(nominal, 6), 2000, 1e-9, '名目のまま');

	const real = simulate(cfg(Object.assign({}, base, { lumpBase: 'real' })));
	// 受け取る年（6年目）の年初の物価倍率は (1.02)^5
	near(balanceAt(real, 6), 2000 * Math.pow(1.02, 5), 1e-9, '現在の物価');
});

test('退職金は受け取る年齢の年にだけ入る', () => {
	const sim = simulate(cfg({
		ageNow: 60, ageRetire: 70, ageEnd: 66, assetNow: 0, lumpSum: 2000, lumpAge: 65
	}));
	near(balanceAt(sim, 5), 0, 1e-9, '受け取る前年');
	near(balanceAt(sim, 6), 2000, 1e-9, '受け取る年');
});

test('売却益への課税は含み益の割合ぶんだけかかる', () => {
	const common = {
		ageNow: 60, ageRetire: 61, ageEnd: 62, assetNow: 1000,
		ret: [10, 0, 0], withdraw: 100
	};
	// 1年目に1,000→1,100（含み益100）。2年目に手取り100万円を取り崩す
	const free = simulate(cfg(Object.assign({}, common, { taxOn: false })));
	near(balanceAt(free, 2), (1100 - 100) * 1.1, 1e-6, '非課税なら額面100万円の売却');

	const taxed = simulate(cfg(Object.assign({}, common, { taxOn: true })));
	// 含み益の割合 100/1,100、税率20.315% → 売却1万円あたりの手取りは eff
	const eff = 1 - (100 / 1100) * 0.20315;
	const sell = 100 / eff;
	near(balanceAt(taxed, 2), (1100 - sell) * 1.1, 1e-6, '課税ぶん多く売る必要がある');
	assert.ok(balanceAt(taxed, 2) < balanceAt(free, 2), '課税ありのほうが残高が少ない');

	// どちらも手取りは生活費どおり100万円
	near(taxed.medianFinalWithdrawReal, 100, 1e-6, '課税ありの手取り');
	near(free.medianFinalWithdrawReal, 100, 1e-6, '非課税の手取り');
});

test('NISAの生涯枠を使い切っていれば、NISAを使わない場合と同じ結果になる', () => {
	const common = {
		ageNow: 40, ageRetire: 45, ageEnd: 50, assetNow: 0, contribution: 100,
		ret: [5, 0, 0], withdraw: 100, taxOn: true
	};
	const noRoom = simulate(cfg(Object.assign({}, common, { nisaOn: true, nisaUsed: 1800 })));
	const noNisa = simulate(cfg(Object.assign({}, common, { nisaOn: false })));
	near(balanceAt(noRoom, 10), balanceAt(noNisa, 10), 1e-9);
});

test('NISA枠が残っていれば課税口座だけより有利になる', () => {
	const common = {
		ageNow: 40, ageRetire: 45, ageEnd: 50, assetNow: 0, contribution: 100,
		ret: [5, 0, 0], withdraw: 100, taxOn: true
	};
	const withNisa = simulate(cfg(Object.assign({}, common, { nisaOn: true, nisaUsed: 0 })));
	const noNisa = simulate(cfg(Object.assign({}, common, { nisaOn: false })));
	assert.ok(balanceAt(withNisa, 10) > balanceAt(noNisa, 10), 'NISAを使ったほうが残る');
});

test('定率取り崩しは残高の一定率を売る', () => {
	const sim = simulate(cfg({
		ageNow: 65, ageRetire: 65, ageEnd: 68, assetNow: 1000, wdMode: 'rate', wdRate: 4
	}));
	// リターン0・非課税なら、毎年残高の4%が減る
	for (let y = 1; y <= 3; y++) {
		near(balanceAt(sim, y), 1000 * Math.pow(0.96, y), 1e-9, y + '年後');
	}
});

test('運用しなかった場合の残高（積立と取り崩しの単純累計）', () => {
	const sim = simulate(cfg({
		ageNow: 40, ageRetire: 45, ageEnd: 48, assetNow: 1000, contribution: 100, withdraw: 200
	}));
	// 5年積立 → 1,500、その後3年取り崩し → 900
	near(sim.principal[5], 1500, 1e-9, '積立終了時');
	near(sim.principal[8], 1500 - 200 * 3, 1e-9, '取り崩し後');
});

test('乱数を固定すれば結果は再現する', () => {
	const c = { ageRetire: 60, ageEnd: 70, risk: [18, 6, 0.5], ret: [7, 2.5, 0.7], trials: 200 };
	const a = simulate(cfg(c));
	const b = simulate(cfg(c));
	assert.deepStrictEqual(Array.from(a.finals), Array.from(b.finals), '同じ種なら同じ結果');

	const other = simulate(cfg(Object.assign({}, c, { seed: 12345 })));
	assert.notDeepStrictEqual(Array.from(other.finals), Array.from(a.finals), '種が違えば結果も違う');
});

test('分位点は下位から上位へ順に並ぶ', () => {
	const sim = simulate(cfg({
		ageRetire: 60, ageEnd: 80, risk: [18, 6, 0.5], ret: [7, 2.5, 0.7],
		contribution: 120, withdraw: 300, trials: 500
	}));
	for (const s of sim.stats) {
		assert.ok(s.p05 <= s.p25 && s.p25 <= s.p50 && s.p50 <= s.p75 && s.p75 <= s.p95,
			s.age + '歳で分位点の並びが逆転している');
		assert.ok(s.min <= s.p05 && s.p95 <= s.max, s.age + '歳で最小・最大が範囲外');
		assert.ok(s.ruinRate >= 0 && s.ruinRate <= 1);
	}
});

test('残高がマイナスになることはない', () => {
	const sim = simulate(cfg({
		ageNow: 60, ageRetire: 60, ageEnd: 95, assetNow: 100, withdraw: 500,
		risk: [30, 10, 1], ret: [7, 2.5, 0.7], trials: 200, taxOn: true
	}));
	for (const s of sim.stats) assert.ok(s.min >= 0, s.age + '歳で残高がマイナス');
});

/* ---------- 部品ごとの確認 ---------- */

test('logParams：算術平均リターンとして扱われる', () => {
	// 対数正規の期待値 exp(mu + sigma^2/2) が 1+r に一致すること
	for (const [r, s] of [[0.07, 0.18], [0.025, 0.06], [0.0, 0.2], [-0.02, 0.1]]) {
		const p = logParams(r, s);
		near(Math.exp(p.mu + p.sigma * p.sigma / 2), 1 + r, 1e-12, 'r=' + r + ' s=' + s);
	}
	// リスク0なら分布は1点に潰れる
	const flat = logParams(0.07, 0);
	near(flat.sigma, 0, 1e-15);
	near(Math.exp(flat.mu) - 1, 0.07, 1e-15);
});

test('cholesky3：無相関なら単位行列', () => {
	assert.deepStrictEqual(cholesky3(0, 0, 0), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test('cholesky3：相関1でもNaNにならない', () => {
	for (const v of cholesky3(1, 1, 1)) assert.ok(Number.isFinite(v), '相関1でNaN');
	for (const v of cholesky3(-1, -1, -1)) assert.ok(Number.isFinite(v), '相関−1でNaN');
});

test('percentile：ソート済み配列から線形補間で求める', () => {
	const a = [1, 2, 3, 4, 5];
	near(percentile(a, 0), 1);
	near(percentile(a, 1), 5);
	near(percentile(a, 0.5), 3);
	near(percentile(a, 0.25), 2);
	near(percentile(a, 0.125), 1.5, 1e-12, '補間');
	near(percentile([], 0.5), 0, 1e-12, '空配列');
});

test('portfolioStats：期待リターンと相関を考慮したリスク', () => {
	const ret = [10, 2, 0], risk = [18, 6, 0.5];
	near(portfolioStats([100, 0, 0], ret, risk, [0, 0, 0]).ret, 10);
	near(portfolioStats([100, 0, 0], ret, risk, [0, 0, 0]).risk, 18);

	const half = portfolioStats([50, 50, 0], ret, risk, [0, 0, 0]);
	near(half.ret, 6, 1e-12, '期待リターンは加重平均');
	near(half.risk, Math.sqrt(0.25 * 324 + 0.25 * 36), 1e-12, '無相関なら分散が加わる');

	// 相関1なら、リスクも単純な加重平均になる
	near(portfolioStats([50, 50, 0], ret, risk, [1, 0, 0]).risk, 12, 1e-12);
	// 相関が下がるほどリスクは小さくなる
	const lo = portfolioStats([50, 50, 0], ret, risk, [-0.5, 0, 0]).risk;
	assert.ok(lo < half.risk, '負の相関で分散効果が出ていない');
});

test('incomeAt：給与は「その年齢になるまで」、年金は「その年齢から」', () => {
	const c = { salary: 300, salaryUntil: 65, pension: 180, pensionFrom: 65, ageRetire: 60 };
	near(incomeAt(c, 64), 300, 1e-12, '64歳は給与のみ');
	near(incomeAt(c, 65), 180, 1e-12, '65歳は年金のみ');
	near(incomeAt(c, 66), 180, 1e-12);
	// 期間が重なれば両方受け取る
	near(incomeAt({ salary: 300, salaryUntil: 70, pension: 180, pensionFrom: 65, ageRetire: 60 }, 66), 480);
});

test('lumpAt：受け取る年齢の年だけ、名目か実質かで額が変わる', () => {
	const c = { lumpSum: 2000, lumpAge: 65, lumpBase: 'nominal', ageRetire: 65 };
	near(lumpAt(c, 65, 1.5), 2000, 1e-12, '名目');
	near(lumpAt(c, 64, 1.5), 0, 1e-12, '前年');
	near(lumpAt(c, 66, 1.5), 0, 1e-12, '翌年');
	near(lumpAt({ lumpSum: 2000, lumpAge: 65, lumpBase: 'real' }, 65, 1.5), 3000, 1e-12, '実質');
	near(lumpAt({ lumpSum: 0, lumpAge: 65, lumpBase: 'real' }, 65, 1.5), 0, 1e-12, '退職金なし');
});

test('mulberry32：同じ種なら同じ列、値は0以上1未満', () => {
	const a = mulberry32(42), b = mulberry32(42);
	for (let i = 0; i < 100; i++) {
		const v = a();
		assert.strictEqual(v, b(), i + '回目で列がずれた');
		assert.ok(v >= 0 && v < 1, i + '回目が範囲外: ' + v);
	}
	assert.notStrictEqual(mulberry32(43)(), mulberry32(42)(), '種が違えば値も違う');
});

test('makeNormal：平均0・標準偏差1に近い値を返す', () => {
	const norm = makeNormal(mulberry32(20260801));
	let sum = 0, sq = 0;
	const n = 20000;
	for (let i = 0; i < n; i++) { const z = norm(); sum += z; sq += z * z; }
	near(sum / n, 0, 0.05, '平均');
	near(Math.sqrt(sq / n), 1, 0.05, '標準偏差');
});
