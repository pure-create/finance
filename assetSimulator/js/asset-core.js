"use strict";

/* 資産運用シミュレーターの計算部分。表示から独立していて、テストからも読み込める */

/* 表示から独立した計算部分（テストからも読み込めるようにしてある） */

// 高速な擬似乱数（シード固定で同じ結果を再現できる）
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Box–Muller 法（2個ずつ作れるので片方を保持しておく）
function makeNormal(rand) {
	let spare = null;
	return function () {
		if (spare !== null) { const v = spare; spare = null; return v; }
		let u = 0, v = 0, s = 0;
		do {
			u = rand() * 2 - 1;
			v = rand() * 2 - 1;
			s = u * u + v * v;
		} while (s >= 1 || s === 0);
		const f = Math.sqrt(-2 * Math.log(s) / s);
		spare = v * f;
		return u * f;
	};
}

// 3x3 相関行列のコレスキー分解（対角は1）
function cholesky3(r12, r13, r23) {
	const l21 = r12;
	const l22 = Math.sqrt(Math.max(1e-12, 1 - r12 * r12));
	const l31 = r13;
	const l32 = (r23 - r12 * r13) / l22;
	const l33 = Math.sqrt(Math.max(1e-12, 1 - l31 * l31 - l32 * l32));
	return [1, 0, 0, l21, l22, 0, l31, l32, l33];
}

// 算術平均リターン r・標準偏差 s から対数正規のパラメータへ
function logParams(r, s) {
	const m = 1 + r;
	if (m <= 1e-9) return { mu: Math.log(1e-9), sigma: 0 };
	const sigma = Math.sqrt(Math.log(1 + (s * s) / (m * m)));
	return { mu: Math.log(m) - sigma * sigma / 2, sigma: sigma };
}

// ソート済み配列からパーセンタイル（線形補間）
function percentile(sorted, p) {
	if (sorted.length === 0) return 0;
	const idx = (sorted.length - 1) * p;
	const lo = Math.floor(idx), hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const NISA_ANNUAL = 360;    // 年間投資枠（万円・簿価）
const NISA_LIFETIME = 1800; // 生涯投資枠（万円・簿価）
const TAX_RATE = 0.20315;   // 譲渡益税
const SAMPLE_PATHS = 20;    // 重ね描きする個別試行の本数

/**
 * その年（年齢 startAge から1年間）に受け取る収入。単位は万円・現在の物価。
 * 給与などは指定した年齢になるまで、年金などは指定した年齢になった年から受け取る。
 * salaryUntil / pensionFrom が無い古い設定でも動くよう、既定を補って解釈する。
 */
function incomeAt(cfg, startAge) {
	const salaryUntil = isFinite(cfg.salaryUntil) ? cfg.salaryUntil : 0;
	const pensionFrom = isFinite(cfg.pensionFrom) ? cfg.pensionFrom : cfg.ageRetire;
	let v = 0;
	if (startAge < salaryUntil) v += cfg.salary || 0;
	if (startAge >= pensionFrom) v += cfg.pension || 0;
	return v;
}

/**
 * その年（年齢 startAge から1年間）の年初に受け取る一時金。単位は万円・名目。
 * 退職金は受け取る年齢の年初に一度だけ、全額が入る。
 *
 * lumpBase が 'real' のときだけ、入力額を現在の物価とみなして物価倍率 f で増額する。
 * 既定の 'nominal' は受け取る額そのままで、物価が上がっても増えない。
 * 退職手当は「退職時の給料月額 × 支給率」で決まり、その給料月額は物価に連動しないうえ、
 * 退職所得控除も名目で固定された金額なので、名目のまま扱うほうが実態に近い。
 */
function lumpAt(cfg, startAge, f) {
	const amount = cfg.lumpSum || 0;
	if (!(amount > 0)) return 0;
	const age = isFinite(cfg.lumpAge) ? Math.round(cfg.lumpAge) : cfg.ageRetire;
	if (startAge !== age) return 0;
	return cfg.lumpBase === 'real' ? amount * f : amount;
}

/**
 * 積立期→取り崩し期を通したモンテカルロ試算。
 * すべて名目（将来の金額）で計算し、実質への換算は表示側で行う。
 */
function simulate(cfg) {
	const N = Math.max(1, Math.round(cfg.ageEnd - cfg.ageNow)); // 年数
	const T = Math.max(1, Math.round(cfg.trials));
	const infl = cfg.inflation / 100;
	const fee = cfg.fee / 100;
	const taxRate = cfg.taxOn ? TAX_RATE : 0;

	// 配分を合計100%に正規化
	const rawW = [cfg.alloc[0], cfg.alloc[1], cfg.alloc[2]];
	const total = rawW[0] + rawW[1] + rawW[2];
	const w = total > 0 ? rawW.map(function (x) { return x / total; }) : [0, 0, 1];

	// 各資産の対数正規パラメータ
	const lp = [0, 1, 2].map(function (i) { return logParams(cfg.ret[i] / 100, cfg.risk[i] / 100); });
	const L = cholesky3(cfg.corr[0], cfg.corr[1], cfg.corr[2]);

	const rand = mulberry32(cfg.seed);
	const norm = makeNormal(rand);

	// byYear[y][t] = y年後の年末残高（名目）
	const byYear = [];
	for (let y = 0; y <= N; y++) byYear.push(new Float64Array(T));
	const sampleCount = Math.min(SAMPLE_PATHS, T);
	const samples = [];
	for (let k = 0; k < sampleCount; k++) samples.push(new Float64Array(N + 1));

	const depletionAge = [];       // 資産が尽きた年齢（尽きなかった試行は入れない）
	const finalWithdrawReal = new Float64Array(T); // 最終年の取り崩し額（実質）
	let shortfallTrials = 0;       // 生活費を賄えなかった試行

	for (let t = 0; t < T; t++) {
		let taxable = cfg.assetNow;  // 課税口座の時価
		let basis = cfg.assetNow;    // その簿価（含み益ゼロで開始）
		let nisa = 0;                // NISA口座の時価
		let nisaUsed = cfg.nisaUsed; // 生涯枠の使用済み（簿価）
		let depleted = false;

		byYear[0][t] = taxable + nisa;
		if (t < sampleCount) samples[t][0] = taxable + nisa;

		for (let y = 1; y <= N; y++) {
			const startAge = cfg.ageNow + y - 1;
			const f = Math.pow(1 + infl, y - 1); // 年初時点の物価倍率

			// 退職金は年初に課税口座へ入れる。取り崩しより先に足さないと、
			// 受け取る年と取り崩し開始が重なったときに資金切れを誤判定する。
			// 簿価も同額増やして、元本の部分に課税されないようにする
			const lump = lumpAt(cfg, startAge, f);
			if (lump > 0) { taxable += lump; basis += lump; }

			if (startAge < cfg.ageRetire) {
				// --- 積立期 ---
				let c = cfg.contribution * f;
				if (cfg.nisaOn) {
					const room = Math.max(0, Math.min(NISA_ANNUAL, NISA_LIFETIME - nisaUsed));
					const a = Math.min(c, room);
					nisa += a; nisaUsed += a; c -= a;
				}
				taxable += c; basis += c;
			} else {
				// --- 取り崩し期 ---
				let netTaken = 0;
				if (cfg.wdMode === 'rate') {
					// 残高の一定率を売却する（税引後が手取り）
					const bal = taxable + nisa;
					let gross = bal * (cfg.wdRate / 100);
					const fromTaxable = Math.min(taxable, gross * (taxable / (bal || 1)));
					const fromNisa = Math.min(nisa, gross - fromTaxable);
					if (taxable > 0 && fromTaxable > 0) {
						const gain = Math.max(0, (taxable - basis) / taxable);
						netTaken += fromTaxable * (1 - gain * taxRate);
						basis -= fromTaxable * (basis / taxable);
						taxable -= fromTaxable;
					}
					if (fromNisa > 0) { nisa -= fromNisa; netTaken += fromNisa; }
				} else {
					// 定額（実質）：収入で足りない分を売却で賄う
					let need = Math.max(0, cfg.withdraw - incomeAt(cfg, startAge)) * f;
					if (need > 0 && taxable > 0) {
						const gain = Math.max(0, (taxable - basis) / taxable);
						const eff = 1 - gain * taxRate;              // 売却1万円あたりの手取り
						let sell = Math.min(taxable, need / Math.max(eff, 1e-9));
						const net = sell * eff;
						basis -= sell * (basis / taxable);
						taxable -= sell;
						need -= net; netTaken += net;
					}
					if (need > 0 && nisa > 0) {
						const sell = Math.min(nisa, need);
						nisa -= sell; need -= sell; netTaken += sell;
					}
					if (need > 1e-6 && !depleted) {
						// 生活費を賄いきれなかった年 ＝ 資産が尽きた年
						depleted = true;
						depletionAge.push(startAge);
						shortfallTrials++;
					}
				}
				if (y === N) finalWithdrawReal[t] = netTaken / Math.pow(1 + infl, y - 1);
			}

			if (taxable < 0) { basis += -taxable; taxable = 0; }
			if (nisa < 0) nisa = 0;

			// --- 運用（1年分のリターン。毎年リバランスするので加重平均で合成） ---
			const z1 = norm(), z2 = norm(), z3 = norm();
			const y1 = L[0] * z1;
			const y2 = L[3] * z1 + L[4] * z2;
			const y3 = L[6] * z1 + L[7] * z2 + L[8] * z3;
			const r1 = Math.exp(lp[0].mu + lp[0].sigma * y1) - 1;
			const r2 = Math.exp(lp[1].mu + lp[1].sigma * y2) - 1;
			const r3 = Math.exp(lp[2].mu + lp[2].sigma * y3) - 1;
			const rp = w[0] * r1 + w[1] * r2 + w[2] * r3 - fee;

			taxable *= (1 + rp);
			nisa *= (1 + rp);
			if (taxable < 0) taxable = 0;
			if (nisa < 0) nisa = 0;

			const bal = taxable + nisa;
			byYear[y][t] = bal;
			if (t < sampleCount) samples[t][y] = bal;
		}
	}

	// --- 年ごとの統計 ---
	const stats = [];
	for (let y = 0; y <= N; y++) {
		const arr = byYear[y];
		let ruined = 0;
		for (let t = 0; t < arr.length; t++) if (arr[t] <= 1e-6) ruined++;
		const sorted = Float64Array.from(arr).sort();
		let sum = 0;
		for (let t = 0; t < sorted.length; t++) sum += sorted[t];
		stats.push({
			age: cfg.ageNow + y,
			year: y,
			p05: percentile(sorted, 0.05),
			p25: percentile(sorted, 0.25),
			p50: percentile(sorted, 0.50),
			p75: percentile(sorted, 0.75),
			p95: percentile(sorted, 0.95),
			mean: sum / sorted.length,
			min: sorted[0],
			max: sorted[sorted.length - 1],
			ruinRate: ruined / sorted.length
		});
	}

	// --- 運用しなかった場合の残高（名目） ---
	const principal = [cfg.assetNow];
	{
		let p = cfg.assetNow;
		for (let y = 1; y <= N; y++) {
			const startAge = cfg.ageNow + y - 1;
			const f = Math.pow(1 + infl, y - 1);
			p += lumpAt(cfg, startAge, f);
			if (startAge < cfg.ageRetire) {
				p += cfg.contribution * f;
			} else if (cfg.wdMode === 'fixed') {
				p -= Math.max(0, cfg.withdraw - incomeAt(cfg, startAge)) * f;
			} else {
				p -= p * (cfg.wdRate / 100);
			}
			principal.push(Math.max(0, p));
		}
	}

	const finals = Float64Array.from(byYear[N]).sort();
	const depSorted = depletionAge.slice().sort(function (a, b) { return a - b; });
	const wdSorted = Float64Array.from(finalWithdrawReal).sort();

	return {
		years: N,
		trials: T,
		stats: stats,
		principal: principal,
		samples: samples,
		finals: finals,
		successRate: 1 - shortfallTrials / T,
		depletionAges: depSorted,
		medianDepletionAge: depSorted.length ? percentile(depSorted, 0.5) : null,
		medianFinalWithdrawReal: percentile(wdSorted, 0.5),
		realFactor: function (y) { return Math.pow(1 + infl, y); },
		weights: w
	};
}

// 配分から見たポートフォリオ全体の期待リターンとリスク（相関考慮）
function portfolioStats(alloc, ret, risk, corr) {
	const total = alloc[0] + alloc[1] + alloc[2];
	const w = total > 0 ? alloc.map(function (x) { return x / total; }) : [0, 0, 1];
	const er = w[0] * ret[0] + w[1] * ret[1] + w[2] * ret[2];
	const c = [[1, corr[0], corr[1]], [corr[0], 1, corr[2]], [corr[1], corr[2], 1]];
	let v = 0;
	for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) v += w[i] * w[j] * risk[i] * risk[j] * c[i][j];
	return { ret: er, risk: Math.sqrt(Math.max(0, v)) };
}

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = { simulate: simulate, portfolioStats: portfolioStats, percentile: percentile, logParams: logParams, cholesky3: cholesky3, mulberry32: mulberry32, makeNormal: makeNormal, incomeAt: incomeAt, lumpAt: lumpAt, NISA_ANNUAL: NISA_ANNUAL, NISA_LIFETIME: NISA_LIFETIME, TAX_RATE: TAX_RATE };
}
