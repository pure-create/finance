'use strict';

/* 年金の損益分岐点の計算部分。画面を一切触らないので、テストからも読み込める
   （資産運用の asset-core.js、相続の inheritance-core.js と同じ切り分け方）。

   金額はすべて「65歳受給開始時の年金額＝1」を基準にした倍数で持つ。
   実際の年金額を入れなくても比較できるようにするための作りで、
   グラフの縦軸が「年分」なのはこのため。 */

const TAX_RATE = 0.20315, MINA = 60, MAXA = 100, CALCA = 140;
const MAPM = (CALCA - MINA) * 12;

/* ── 受給開始年齢による増減率 ──
   繰上げは1か月あたり0.4%減（60歳まで＝最大24%減）、
   繰下げは1か月あたり0.7%増（75歳まで＝最大84%増）。 */
function pRate(a) {
	if (a < 65) return 1 - 0.004 * (65 - a) * 12;
	if (a > 65) return Math.min(1 + 0.007 * (a - 65) * 12, 1.84);
	return 1;
}

/* ── 月ごとの累積受取総額 ──
   sa: 受給開始年齢 / nr: 名目利回り / ia: 投資期間終了年齢 / tax: 課税するか */
function calcW(sa, nr, ia, tax) {
	const mr = Math.pow(1 + nr * (1 - tax), 1 / 12) - 1;
	const mp = pRate(sa) / 12;
	const base = pRate(65) / 12;   // 生活費の基準＝65歳受給開始時の年金額
	const sm = (sa - MINA) * 12, im = (ia - MINA) * 12;
	let pool = 0, spent = 0;
	const w = new Float64Array(MAPM + 1);
	for (let m = 0; m <= MAPM; m++) {
		w[m] = spent + pool;           // 記録：この月の年金受取り前の残高
		if (m >= sm) {
			if (m < im) {
				pool = (pool + mp) * (1 + mr);
			} else if (mp >= base) {
				// 基準額を超える分（繰下げの増加分）は運用に上乗せ
				spent += base;
				pool = (pool + (mp - base)) * (1 + mr);
			} else {
				// 基準額に満たない分（繰上げの減少分）は運用残高から取り崩して充当
				const draw = Math.min(base - mp, pool);
				spent += mp + draw;
				pool = (pool - draw) * (1 + mr);
			}
		}
	}
	return w;
}

/* ── どの受給開始年齢が有利かの推移 ──
   [{start, end, idx}] を開始年齢の順に返す。idx は ws の何番目が
   その期間で首位かを指す。首位が入れ替わる月は、前月との差を線形補間して
   交差する年齢を求める。 */
function leaderTimeline(ws) {
	const periods = [];
	let leader = -1;

	for (let m = 0; m <= MAPM; m++) {
		// Find argmax across all scenarios
		let best = 0;
		for (let i = 1; i < ws.length; i++) if (ws[i][m] > ws[best][m]) best = i;

		if (best !== leader) {
			let transAge = MINA + m / 12;

			if (leader !== -1 && m > 0) {
				// Interpolate precise crossover between old leader and new best
				const p = ws[leader][m - 1] - ws[best][m - 1];
				const c = ws[leader][m] - ws[best][m];
				if (p > 0 && (p - c) > 1e-10) {
					const f = Math.max(0, Math.min(1, p / (p - c)));
					transAge = MINA + (m - 1 + f) / 12;
				}
				periods[periods.length - 1].end = transAge;
			} else {
				// Very first period — start at MINA
				transAge = MINA;
			}

			periods.push({ start: transAge, end: CALCA, idx: best });
			leader = best;
		}
	}
	return periods;
}

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		pRate: pRate, calcW: calcW, leaderTimeline: leaderTimeline,
		TAX_RATE: TAX_RATE, MINA: MINA, MAXA: MAXA, CALCA: CALCA, MAPM: MAPM
	};
}
