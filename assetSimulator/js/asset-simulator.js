"use strict";

/* 画面の描画と入力の受け取り。計算は asset-core.js の simulate() を使う */

const $ = function (id) { return document.getElementById(id); };

/* 入力欄の一覧：[要素のid, 初期値, 共有URLでの短いキー]。
   保存・共有・「初期値に戻す」はすべてこの表を元にする */
const FIELDS = [
	['ageNow', 40, 'a'], ['ageRetire', 65, 'ar'], ['ageEnd', 95, 'ae'],
	['assetNow', 1000, 'as'], ['contribution', 120, 'ct'],
	['wdMode', 'fixed', 'wm'], ['withdraw', 360, 'wd'], ['wdRate', 4.0, 'wr'],
	['salary', 0, 'sl'], ['salaryUntil', 65, 'su'], ['pension', 180, 'pn'], ['pensionFrom', 65, 'pf'],
	['allocStock', 70, 'ls'], ['allocBond', 25, 'lb'], ['allocCash', 5, 'lc'], ['fee', 0.15, 'fe'],
	['retStock', 7.0, 'rs'], ['riskStock', 18.0, 'ks'],
	['retBond', 2.5, 'rb'], ['riskBond', 6.0, 'kb'],
	['retCash', 0.7, 'rc'], ['riskCash', 0.5, 'kc'],
	['corrSB', 0.15, 'sb'], ['corrSC', 0, 'sc'], ['corrBC', 0.10, 'bc'],
	['inflation', 2.0, 'if'], ['taxOn', true, 'tx'], ['nisaOn', true, 'ni'], ['nisaUsed', 0, 'nu'],
	['trials', 2000, 'tr'], ['viewMode', 'real', 'vw'], ['seedFixed', true, 'sd'], ['showPaths', true, 'sp']
];
const DEFAULTS = {};
for (let i = 0; i < FIELDS.length; i++) DEFAULTS[FIELDS[i][0]] = FIELDS[i][1];

function num(id) { const v = parseFloat($(id).value); return isFinite(v) ? v : 0; }

function readConfig() {
	return {
		ageNow: Math.round(num('ageNow')),
		ageRetire: Math.round(num('ageRetire')),
		ageEnd: Math.round(num('ageEnd')),
		assetNow: num('assetNow'),
		contribution: num('contribution'),
		wdMode: $('wdMode').value,
		withdraw: num('withdraw'),
		wdRate: num('wdRate'),
		salary: num('salary'),
		salaryUntil: Math.round(num('salaryUntil')),
		pension: num('pension'),
		pensionFrom: Math.round(num('pensionFrom')),
		alloc: [num('allocStock'), num('allocBond'), num('allocCash')],
		ret: [num('retStock'), num('retBond'), num('retCash')],
		risk: [num('riskStock'), num('riskBond'), num('riskCash')],
		corr: [num('corrSB'), num('corrSC'), num('corrBC')],
		fee: num('fee'),
		inflation: num('inflation'),
		taxOn: $('taxOn').checked,
		nisaOn: $('nisaOn').checked,
		nisaUsed: num('nisaUsed'),
		trials: Math.round(num('trials')),
		seed: $('seedFixed').checked ? 20260801 : (Math.random() * 4294967296) >>> 0
	};
}

/* ---------- 保存・共有 ---------- */
const STORAGE_KEY = 'assetSimulator.v1';

// 入力欄の値を文字列で取り出す（チェックボックスは1/0）
function fieldValue(id) {
	const el = $(id);
	if (!el) return null;
	return el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
}

// 文字列を入力欄へ書き戻す。選択肢にない値・範囲外の値は受け付けない
function setField(id, v) {
	const el = $(id);
	if (el === null || v === null || v === undefined) return;
	if (el.type === 'checkbox') { el.checked = (v === true || v === '1'); return; }
	let s = String(v);
	if (el.tagName === 'SELECT') {
		for (let i = 0; i < el.options.length; i++) {
			if (el.options[i].value === s) { el.value = s; return; }
		}
		return; // 不正な値は無視して現在の選択を保つ
	}
	if (el.type === 'number' && s !== '') {
		let n = parseFloat(s);
		if (!isFinite(n)) return;
		// 共有URLに極端な値が入っていても壊れないよう min/max に収める
		const lo = parseFloat(el.min), hi = parseFloat(el.max);
		if (isFinite(lo)) n = Math.max(lo, n);
		if (isFinite(hi)) n = Math.min(hi, n);
		s = String(n);
	}
	el.value = s;
}

// 初期値と同じ欄は省いて短いURLにする
function isDefaultField(id) {
	const el = $(id), d = DEFAULTS[id];
	if (!el) return true;
	if (el.type === 'checkbox') return el.checked === d;
	if (el.type === 'number') return parseFloat(el.value) === parseFloat(d);
	return el.value === String(d);
}

function serializeState() {
	const params = new URLSearchParams();
	for (let i = 0; i < FIELDS.length; i++) {
		const id = FIELDS[i][0], key = FIELDS[i][2];
		if (!isDefaultField(id)) params.set(key, fieldValue(id));
	}
	return params;
}

function applyStateFromParams(params) {
	for (let i = 0; i < FIELDS.length; i++) {
		const id = FIELDS[i][0], key = FIELDS[i][2];
		if (params.has(key)) setField(id, params.get(key));
	}
}

function applyDefaults() {
	for (let i = 0; i < FIELDS.length; i++) setField(FIELDS[i][0], DEFAULTS[FIELDS[i][0]]);
}

// 現在の入力内容を反映した共有リンクのURLを組み立てる
function buildShareUrl() {
	const params = serializeState().toString();
	const base = window.location.href.split(/[?#]/)[0];
	return params ? base + '?' + params : base;
}

// 共有リンクのQRコードを描画する（スマートフォンへの共有用。広い画面でのみ表示）
function renderShareQr() {
	const el = $('shareQr');
	if (!el || typeof qrcode === 'undefined') return;
	try {
		const qr = qrcode(0, 'M');
		qr.addData(buildShareUrl());
		qr.make();
		el.innerHTML = qr.createSvgTag(4);
	} catch (e) {
		el.innerHTML = '';
	}
}

// 次回訪問時に同じ条件で開けるよう、入力内容をこのブラウザに保存する
function saveState() {
	try {
		localStorage.setItem(STORAGE_KEY, serializeState().toString());
	} catch (e) {
		// プライベートブラウジング等で保存できない場合は何もしない
	}
}

// 共有リンク（URLクエリ）を優先し、なければ前回の入力内容を復元する
function restoreState() {
	const urlParams = new URLSearchParams(window.location.search);
	if (urlParams.toString()) { applyStateFromParams(urlParams); return; }
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) applyStateFromParams(new URLSearchParams(saved));
	} catch (e) {
		// 読み込めない場合は初期値のまま
	}
}

function persistAndShare() {
	saveState();
	renderShareQr();
}

function copyToClipboard(text) {
	if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
	return new Promise(function (resolve, reject) {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
		catch (e) { reject(e); }
		finally { ta.remove(); }
	});
}

// --- 数値の書式 ---
function comma(v) { return Math.round(v).toLocaleString('ja-JP'); }
function money(v) {
	const a = Math.abs(v);
	if (a >= 100000) return (v / 10000).toFixed(0) + '億円';
	if (a >= 10000) return (v / 10000).toFixed(2) + '億円';
	return comma(v) + '万円';
}
function axisMoney(v) {
	if (v === 0) return '0';
	if (Math.abs(v) >= 10000) {
		const oku = v / 10000;
		return (Math.abs(oku) >= 10 ? oku.toFixed(0) : oku.toFixed(1)) + '億';
	}
	return comma(v);
}
function pctText(v) { return (v * 100).toFixed(1) + '%'; }

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function niceTicks(max, count) {
	if (!(max > 0)) return [0, 1];
	const raw = max / count;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const n = raw / mag;
	const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
	const ticks = [];
	for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
	return ticks;
}

// canvas を実ピクセルに合わせる
function setupCanvas(canvas, cssHeight) {
	const dpr = window.devicePixelRatio || 1;
	const w = canvas.parentElement.clientWidth;
	canvas.style.height = cssHeight + 'px';
	canvas.width = Math.max(1, Math.round(w * dpr));
	canvas.height = Math.round(cssHeight * dpr);
	const ctx = canvas.getContext('2d');
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, cssHeight);
	return { ctx: ctx, w: w, h: cssHeight };
}

let state = { sim: null, cfg: null, view: 'real', fanGeom: null, histGeom: null, hist: null };

/* ---------- ファンチャート ---------- */
function drawFan() {
	const sim = state.sim, cfg = state.cfg;
	if (!sim) return;
	const canvas = $('fanChart');
	const cssH = window.innerWidth < 700 ? 300 : 400;
	const g = setupCanvas(canvas, cssH);
	const ctx = g.ctx;
	const padL = 62, padR = 16, padT = 12, padB = 34;
	const plotW = Math.max(10, g.w - padL - padR);
	const plotH = Math.max(10, g.h - padT - padB);
	const N = sim.years;
	const real = state.view === 'real';
	const conv = function (v, y) { return real ? v / sim.realFactor(y) : v; };

	// 縦軸の上限
	let maxV = 0;
	for (let y = 0; y <= N; y++) {
		maxV = Math.max(maxV, conv(sim.stats[y].p95, y), conv(sim.principal[y], y));
	}
	if (maxV <= 0) maxV = 1;
	const ticks = niceTicks(maxV * 1.06, 5);
	const top = ticks[ticks.length - 1];
	const X = function (y) { return padL + (N === 0 ? 0 : (y / N) * plotW); };
	const Y = function (v) { return padT + plotH - (v / top) * plotH; };

	// グリッド
	ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
	ctx.fillStyle = css('--muted');
	ctx.font = '11px system-ui, sans-serif';
	ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
	for (let i = 0; i < ticks.length; i++) {
		const yy = Math.round(Y(ticks[i])) + 0.5;
		ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
		ctx.fillText(axisMoney(ticks[i]), padL - 8, yy);
	}

	// 帯（5–95 → 25–75 の順に重ねる）
	function band(lowKey, highKey, color) {
		ctx.beginPath();
		for (let y = 0; y <= N; y++) { const p = conv(sim.stats[y][highKey], y); if (y === 0) ctx.moveTo(X(y), Y(p)); else ctx.lineTo(X(y), Y(p)); }
		for (let y = N; y >= 0; y--) { const p = conv(sim.stats[y][lowKey], y); ctx.lineTo(X(y), Y(p)); }
		ctx.closePath();
		ctx.fillStyle = color;
		ctx.fill();
	}
	band('p05', 'p95', css('--band-outer'));
	band('p25', 'p75', css('--band-inner'));

	// 個別の試行（識別に色を使わない薄い線）
	if ($('showPaths').checked) {
		ctx.save();
		ctx.beginPath(); ctx.rect(padL, padT, plotW, plotH); ctx.clip();
		ctx.strokeStyle = css('--path'); ctx.lineWidth = 1;
		for (let k = 0; k < sim.samples.length; k++) {
			ctx.beginPath();
			for (let y = 0; y <= N; y++) {
				const v = conv(sim.samples[k][y], y);
				if (y === 0) ctx.moveTo(X(y), Y(v)); else ctx.lineTo(X(y), Y(v));
			}
			ctx.stroke();
		}
		ctx.restore();
	}

	// 取り崩し開始の目印
	const retY = cfg.ageRetire - cfg.ageNow;
	if (retY > 0 && retY < N) {
		const rx = Math.round(X(retY)) + 0.5;
		ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(rx, padT); ctx.lineTo(rx, padT + plotH); ctx.stroke();
		ctx.fillStyle = css('--text-secondary');
		ctx.font = '11px system-ui, sans-serif';
		ctx.textAlign = 'left'; ctx.textBaseline = 'top';
		ctx.fillText('取り崩し開始 ' + cfg.ageRetire + '歳', rx + 5, padT + 2);
	}

	// 運用しなかった場合（破線）
	ctx.save();
	ctx.beginPath(); ctx.rect(padL, padT, plotW, plotH); ctx.clip();
	ctx.strokeStyle = css('--series-2'); ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
	ctx.lineJoin = 'round'; ctx.lineCap = 'round';
	ctx.beginPath();
	for (let y = 0; y <= N; y++) { const v = conv(sim.principal[y], y); if (y === 0) ctx.moveTo(X(y), Y(v)); else ctx.lineTo(X(y), Y(v)); }
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.restore();

	// 中央値
	ctx.strokeStyle = css('--series-1'); ctx.lineWidth = 2;
	ctx.lineJoin = 'round'; ctx.lineCap = 'round';
	ctx.beginPath();
	for (let y = 0; y <= N; y++) { const v = conv(sim.stats[y].p50, y); if (y === 0) ctx.moveTo(X(y), Y(v)); else ctx.lineTo(X(y), Y(v)); }
	ctx.stroke();

	// 中央値の終端に丸と直接ラベル
	const endV = conv(sim.stats[N].p50, N);
	ctx.beginPath(); ctx.arc(X(N), Y(endV), 4.5, 0, Math.PI * 2);
	ctx.fillStyle = css('--series-1'); ctx.fill();
	ctx.lineWidth = 2; ctx.strokeStyle = css('--surface-1'); ctx.stroke();
	ctx.fillStyle = css('--text-primary');
	ctx.font = '600 12px system-ui, sans-serif';
	ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
	ctx.fillText(money(endV), X(N) - 2, Y(endV) - 9);

	// 横軸
	ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(padL, Math.round(padT + plotH) + 0.5); ctx.lineTo(padL + plotW, Math.round(padT + plotH) + 0.5);
	ctx.stroke();
	ctx.fillStyle = css('--muted');
	ctx.font = '11px system-ui, sans-serif';
	ctx.textAlign = 'center'; ctx.textBaseline = 'top';
	const ageStep = N <= 20 ? 5 : N <= 45 ? 10 : 15;
	for (let y = 0; y <= N; y++) {
		const age = cfg.ageNow + y;
		if (age % ageStep !== 0 && y !== N) continue;
		if (y !== N && (X(N) - X(y)) < 26) continue;
		ctx.fillText(age + '歳', X(y), padT + plotH + 7);
	}
	ctx.textAlign = 'right';
	ctx.fillText('（' + (real ? '実質・現在の物価' : '名目') + '／万円）', padL + plotW, padT + plotH + 20);

	state.fanGeom = { padL: padL, padT: padT, plotW: plotW, plotH: plotH, N: N, X: X, Y: Y, conv: conv, top: top };
}

/* ---------- ヒストグラム ---------- */
function buildHistogram() {
	const sim = state.sim;
	const real = state.view === 'real';
	const N = sim.years;
	const f = real ? sim.realFactor(N) : 1;
	const vals = new Float64Array(sim.finals.length);
	for (let i = 0; i < sim.finals.length; i++) vals[i] = sim.finals[i] / f;
	// 極端な外れ値で潰れないよう上限は99パーセンタイル
	const upper = Math.max(percentile(vals, 0.99), 1);
	const bins = 34;
	const width = upper / bins;
	const counts = new Array(bins + 1).fill(0); // 最後は「上限より大きい」
	for (let i = 0; i < vals.length; i++) {
		const b = Math.min(bins, Math.floor(vals[i] / width));
		counts[b]++;
	}
	return { counts: counts, width: width, bins: bins, vals: vals, upper: upper };
}

function drawHist() {
	const sim = state.sim;
	if (!sim) return;
	const h = state.hist = buildHistogram();
	const canvas = $('histChart');
	const g = setupCanvas(canvas, window.innerWidth < 700 ? 190 : 230);
	const ctx = g.ctx;
	const padL = 52, padR = 16, padT = 14, padB = 34;
	const plotW = Math.max(10, g.w - padL - padR);
	const plotH = Math.max(10, g.h - padT - padB);
	let maxC = 0;
	for (let i = 0; i < h.counts.length; i++) maxC = Math.max(maxC, h.counts[i]);
	if (maxC <= 0) maxC = 1;

	const nBars = h.counts.length;
	const slot = plotW / nBars;
	const gap = 2;
	const barW = Math.min(24, Math.max(1, slot - gap));

	// 度数の目盛
	const ticks = niceTicks(maxC, 4);
	const topC = ticks[ticks.length - 1];
	ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
	ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif';
	ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
	for (let i = 0; i < ticks.length; i++) {
		const yy = Math.round(padT + plotH - (ticks[i] / topC) * plotH) + 0.5;
		ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
		ctx.fillText(pctText(ticks[i] / sim.trials), padL - 8, yy);
	}

	// 棒（先端だけ 4px の丸み）
	ctx.fillStyle = css('--series-1');
	for (let i = 0; i < nBars; i++) {
		if (h.counts[i] === 0) continue;
		const bh = (h.counts[i] / topC) * plotH;
		const x = padL + i * slot + (slot - barW) / 2;
		const y = padT + plotH - bh;
		const r = Math.min(4, barW / 2, bh);
		ctx.beginPath();
		ctx.moveTo(x, padT + plotH);
		ctx.lineTo(x, y + r);
		ctx.quadraticCurveTo(x, y, x + r, y);
		ctx.lineTo(x + barW - r, y);
		ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
		ctx.lineTo(x + barW, padT + plotH);
		ctx.closePath();
		ctx.fill();
	}

	// 中央値の位置に注記
	const med = percentile(h.vals, 0.5);
	const mx = padL + Math.min(plotW, (med / h.upper) * plotW);
	ctx.strokeStyle = css('--text-primary'); ctx.lineWidth = 1.5;
	ctx.beginPath(); ctx.moveTo(mx, padT); ctx.lineTo(mx, padT + plotH); ctx.stroke();
	ctx.fillStyle = css('--text-primary');
	ctx.font = '600 11.5px system-ui, sans-serif';
	ctx.textBaseline = 'top';
	if (mx > padL + plotW * 0.6) { ctx.textAlign = 'right'; ctx.fillText('中央値 ' + money(med), mx - 5, padT); }
	else { ctx.textAlign = 'left'; ctx.fillText('中央値 ' + money(med), mx + 5, padT); }

	// 横軸
	ctx.strokeStyle = css('--axis'); ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(padL, Math.round(padT + plotH) + 0.5); ctx.lineTo(padL + plotW, Math.round(padT + plotH) + 0.5);
	ctx.stroke();
	ctx.fillStyle = css('--muted'); ctx.font = '11px system-ui, sans-serif';
	ctx.textAlign = 'center'; ctx.textBaseline = 'top';
	const xticks = niceTicks(h.upper, 5);
	for (let i = 0; i < xticks.length; i++) {
		if (xticks[i] > h.upper) continue;
		ctx.fillText(axisMoney(xticks[i]), padL + (xticks[i] / h.upper) * plotW, padT + plotH + 7);
	}
	ctx.textAlign = 'right';
	ctx.fillText('（' + (state.view === 'real' ? '実質' : '名目') + '／万円）', padL + plotW, padT + plotH + 20);

	state.histGeom = { padL: padL, padT: padT, plotW: plotW, plotH: plotH, slot: slot, nBars: nBars };
}

/* ---------- ホバー ---------- */
function setupHover() {
	const fanWrap = $('fanWrap'), fanTip = $('fanTip'), fanCanvas = $('fanChart');
	function fanMove(ev) {
		const geo = state.fanGeom, sim = state.sim;
		if (!geo || !sim) return;
		const rect = fanCanvas.getBoundingClientRect();
		const mx = ev.clientX - rect.left;
		const my = ev.clientY - rect.top;
		if (mx < geo.padL - 6 || mx > geo.padL + geo.plotW + 6 || my < 0 || my > geo.padT + geo.plotH + 6) { fanTip.style.opacity = 0; drawFan(); return; }
		const y = Math.max(0, Math.min(geo.N, Math.round(((mx - geo.padL) / geo.plotW) * geo.N)));
		const s = sim.stats[y];
		drawFan();
		// クロスヘア
		const ctx = fanCanvas.getContext('2d');
		const gx = Math.round(geo.X(y)) + 0.5;
		ctx.strokeStyle = css('--text-secondary'); ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(gx, geo.padT); ctx.lineTo(gx, geo.padT + geo.plotH); ctx.stroke();
		const cy = geo.Y(geo.conv(s.p50, y));
		ctx.beginPath(); ctx.arc(gx - 0.5, cy, 4.5, 0, Math.PI * 2);
		ctx.fillStyle = css('--series-1'); ctx.fill();
		ctx.lineWidth = 2; ctx.strokeStyle = css('--surface-1'); ctx.stroke();

		const rows = [
			['95%', money(geo.conv(s.p95, y))],
			['75%', money(geo.conv(s.p75, y))],
			['中央値', money(geo.conv(s.p50, y))],
			['25%', money(geo.conv(s.p25, y))],
			['5%', money(geo.conv(s.p05, y))],
			['運用なし', money(geo.conv(sim.principal[y], y))],
			['資金が尽きた割合', pctText(s.ruinRate)]
		];
		let html = '<div class="tt-title">' + s.age + '歳（' + y + '年後）</div><table>';
		for (let i = 0; i < rows.length; i++) html += '<tr><td>' + rows[i][0] + '</td><td>' + rows[i][1] + '</td></tr>';
		html += '</table>';
		fanTip.innerHTML = html;
		fanTip.style.opacity = 1;
		const tw = fanTip.offsetWidth, th = fanTip.offsetHeight;
		let left = geo.X(y) + 14;
		if (left + tw > fanCanvas.clientWidth) left = geo.X(y) - tw - 14;
		fanTip.style.left = Math.max(0, left) + 'px';
		fanTip.style.top = Math.max(0, Math.min(geo.padT + geo.plotH - th, my - th / 2)) + 'px';
	}
	fanWrap.addEventListener('mousemove', fanMove);
	fanWrap.addEventListener('mouseleave', function () { $('fanTip').style.opacity = 0; drawFan(); });

	const histWrap = $('histWrap'), histTip = $('histTip'), histCanvas = $('histChart');
	histWrap.addEventListener('mousemove', function (ev) {
		const geo = state.histGeom, h = state.hist, sim = state.sim;
		if (!geo || !h || !sim) return;
		const rect = histCanvas.getBoundingClientRect();
		const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
		const i = Math.floor((mx - geo.padL) / geo.slot);
		if (i < 0 || i >= geo.nBars || my > geo.padT + geo.plotH + 6) { histTip.style.opacity = 0; return; }
		const lo = i * h.width, hi = (i + 1) * h.width;
		const label = i === h.bins ? money(lo) + ' 以上' : money(lo) + ' 〜 ' + money(hi);
		histTip.innerHTML = '<div class="tt-title">' + label + '</div><table><tr><td>試行</td><td>' + comma(h.counts[i]) + '回</td></tr>' +
			'<tr><td>割合</td><td>' + pctText(h.counts[i] / sim.trials) + '</td></tr></table>';
		histTip.style.opacity = 1;
		const tw = histTip.offsetWidth;
		let left = geo.padL + i * geo.slot + geo.slot / 2 - tw / 2;
		left = Math.max(0, Math.min(histCanvas.clientWidth - tw, left));
		histTip.style.left = left + 'px';
		histTip.style.top = Math.max(0, my - histTip.offsetHeight - 12) + 'px';
	});
	histWrap.addEventListener('mouseleave', function () { $('histTip').style.opacity = 0; });
}

/* ---------- タイル・テーブル ---------- */
function renderTiles() {
	const sim = state.sim, cfg = state.cfg;
	const real = state.view === 'real';
	const N = sim.years;
	const f = real ? sim.realFactor(N) : 1;
	const s = sim.stats[N];
	const rate = sim.successRate;
	const color = rate >= 0.9 ? 'var(--good)' : rate >= 0.75 ? 'var(--warning)' : 'var(--critical)';
	const word = rate >= 0.9 ? '余裕あり' : rate >= 0.75 ? '注意' : '見直しが必要';

	const tiles = [];
	if (cfg.wdMode === 'fixed') {
		tiles.push('<div class="tile hero"><div class="label">' + cfg.ageEnd + '歳まで資金が尽きない確率</div>' +
			'<div class="value" style="color:' + color + '">' + (rate * 100).toFixed(1) + '<span style="font-size:24px">%</span></div>' +
			'<div class="sub"><span class="status-dot" style="background:' + color + '"></span>' + word +
			'　（' + comma(sim.trials) + '回中 ' + comma(Math.round((1 - rate) * sim.trials)) + '回が不足）</div></div>');
	} else {
		tiles.push('<div class="tile hero"><div class="label">最終年の取り崩し額（実質・中央値）</div>' +
			'<div class="value">' + comma(sim.medianFinalWithdrawReal) + '<span style="font-size:20px">万円</span></div>' +
			'<div class="sub">定率方式では資金は理論上尽きませんが、金額が変動します</div></div>');
	}
	tiles.push('<div class="tile"><div class="label">' + cfg.ageEnd + '歳時点の資産（中央値）</div>' +
		'<div class="value">' + money(s.p50 / f) + '</div><div class="sub">' + (real ? '実質・現在の物価' : '名目') + '</div></div>');
	tiles.push('<div class="tile"><div class="label">同・下位5%（悪いケース）</div>' +
		'<div class="value">' + money(s.p05 / f) + '</div><div class="sub">20回に1回はこれ以下</div></div>');
	tiles.push('<div class="tile"><div class="label">同・上位5%（良いケース）</div>' +
		'<div class="value">' + money(s.p95 / f) + '</div><div class="sub">20回に1回はこれ以上</div></div>');
	if (cfg.wdMode === 'fixed') {
		const dep = sim.medianDepletionAge;
		tiles.push('<div class="tile"><div class="label">資金が尽きる年齢（中央値）</div>' +
			'<div class="value">' + (dep === null ? '—' : Math.round(dep) + '<span style="font-size:18px">歳</span>') + '</div>' +
			'<div class="sub">' + (dep === null ? '尽きた試行はありません' : '尽きた ' + comma(sim.depletionAges.length) + '回のうちの中央値') + '</div></div>');
	}
	$('tiles').innerHTML = tiles.join('');
}

function renderTable() {
	const sim = state.sim, cfg = state.cfg;
	const real = state.view === 'real';
	const all = $('allYears').checked;
	const N = sim.years;
	const head = '<tr><th>年齢</th><th>経過</th><th>運用なし</th><th>下位5%</th><th>25%</th><th>中央値</th><th>75%</th><th>上位95%</th><th>資金切れ</th></tr>';
	let body = '';
	for (let y = 0; y <= N; y++) {
		const age = cfg.ageNow + y;
		const isRetire = age === cfg.ageRetire;
		if (!all && y !== 0 && y !== N && !isRetire && age % 5 !== 0) continue;
		const s = sim.stats[y];
		const f = real ? sim.realFactor(y) : 1;
		const p = sim.principal[y] / f;
		const cell = function (v) {
			const cls = (v < p && y > 0) ? ' class="neg"' : '';
			return '<td' + cls + '>' + comma(v) + '</td>';
		};
		body += '<tr' + (isRetire ? ' class="retire-row"' : '') + '>' +
			'<td>' + age + '歳' + (isRetire ? '（取り崩し開始）' : '') + '</td>' +
			'<td>' + y + '年</td>' +
			'<td>' + comma(p) + '</td>' +
			cell(s.p05 / f) + cell(s.p25 / f) + cell(s.p50 / f) + cell(s.p75 / f) + cell(s.p95 / f) +
			'<td>' + (s.ruinRate > 0 ? pctText(s.ruinRate) : '—') + '</td></tr>';
	}
	$('dataTable').querySelector('thead').innerHTML = head;
	$('dataTable').querySelector('tbody').innerHTML = body;
	$('tableSub').textContent = '金額は万円（' + (real ? '実質・現在の物価' : '名目') + '）。赤字は「運用しなかった場合」を下回る水準です。';
}

/* ---------- 実行 ---------- */
function validate(cfg) {
	if (cfg.ageRetire < cfg.ageNow) return '「取り崩し開始」は現在の年齢以上にしてください。';
	if (cfg.ageEnd <= cfg.ageNow) return '「シミュレーション終了」は現在の年齢より後にしてください。';
	if (cfg.ageEnd - cfg.ageNow > 90) return 'シミュレーション期間が長すぎます（90年以内にしてください）。';
	if (cfg.alloc[0] + cfg.alloc[1] + cfg.alloc[2] <= 0) return '資産配分を1つ以上入力してください。';
	return null;
}

/* 収入欄の下の注意書き。取り崩し期に効かない入力と、収入が途切れる期間を知らせる */
function renderIncomeNotes(cfg) {
	const notes = [];  // [種類, 文言]
	if (cfg.wdMode === 'fixed') {
		// 取り崩し開始より前の収入は年間積立額に含まれる前提のため、計算には使われない
		if (cfg.salary > 0 && cfg.salaryUntil <= cfg.ageRetire) {
			notes.push(['ignored', '給与などは取り崩し開始（' + cfg.ageRetire +
				'歳）より前に終わるため、計算に影響しません。']);
		}
		if (cfg.pension > 0 && cfg.pensionFrom >= cfg.ageEnd) {
			notes.push(['ignored', '年金などが始まる前にシミュレーションが終わる（' + cfg.ageEnd +
				'歳まで）ため、計算に影響しません。']);
		} else if (cfg.pension > 0 && Math.max(cfg.pensionFrom, cfg.ageNow) < cfg.ageRetire) {
			notes.push(['ignored', '年金などのうち' + Math.max(cfg.pensionFrom, cfg.ageNow) + '歳〜' +
				(cfg.ageRetire - 1) + '歳の分は、取り崩し開始（' + cfg.ageRetire +
				'歳）より前のため計算に影響しません。']);
		}

		// 取り崩し開始から年金が始まるまでの、収入が途切れる期間
		// （年金がない場合や、始まる前に終わる場合は「空白」ではないので知らせない）
		if (cfg.pension > 0 && cfg.pensionFrom < cfg.ageEnd) {
			let lo = null, hi = null;
			for (let age = cfg.ageRetire; age < cfg.ageEnd && age < cfg.pensionFrom; age++) {
				if (incomeAt(cfg, age) > 0) { if (lo !== null) break; continue; }
				if (lo === null) lo = age;
				hi = age;
			}
			if (lo !== null) {
				notes.push(['gap', lo + '歳〜' + hi + '歳は収入がないため、生活費 ' + money(cfg.withdraw) +
					'（現在の物価）の全額を資産から取り崩します。']);
			}
		}
	}
	$('incomeNotes').innerHTML = notes.map(function (n) {
		return '<p class="hint side-note' + (n[0] === 'ignored' ? ' ignored' : '') + '">' + n[1] + '</p>';
	}).join('');
}

function run() {
	const cfg = readConfig();
	state.view = $('viewMode').value;

	// 配分の合計とポートフォリオ全体の期待値を表示
	const sum = cfg.alloc[0] + cfg.alloc[1] + cfg.alloc[2];
	$('allocSum').textContent = Math.round(sum * 10) / 10;
	$('allocSum').className = Math.abs(sum - 100) > 0.01 ? 'warn' : '';
	const ps = portfolioStats(cfg.alloc, cfg.ret, cfg.risk, cfg.corr);
	$('portRet').textContent = ps.ret.toFixed(2);
	$('portRisk').textContent = ps.risk.toFixed(2);

	// 方式に応じて入力欄を出し分け
	$('rowWithdraw').style.display = cfg.wdMode === 'fixed' ? '' : 'none';
	$('rowRate').style.display = cfg.wdMode === 'rate' ? '' : 'none';
	// 定率方式は残高の一定率を取り崩すので、収入は結果に影響しない
	$('incomeSection').style.display = cfg.wdMode === 'fixed' ? '' : 'none';
	$('rowNisaUsed').style.display = cfg.nisaOn ? '' : 'none';
	$('legendPaths').style.display = $('showPaths').checked ? '' : 'none';
	renderIncomeNotes(cfg);

	persistAndShare();

	const err = validate(cfg);
	const alertBox = $('alert');
	if (err) { alertBox.textContent = err; alertBox.style.display = 'block'; return; }
	alertBox.style.display = 'none';

	const t0 = performance.now();
	state.cfg = cfg;
	state.sim = simulate(cfg);
	const ms = performance.now() - t0;

	const sim = state.sim;
	$('fanSub').textContent = comma(sim.trials) + '回の試行、' + cfg.ageNow + '歳から' + cfg.ageEnd + '歳まで' + sim.years + '年間。金額は' +
		(state.view === 'real' ? '実質（現在の物価）' : '名目') + '。';
	$('histSub').textContent = cfg.ageEnd + '歳時点の資産の分布（上位1%は最右の棒にまとめています）。計算 ' + ms.toFixed(0) + 'ms。';

	renderTiles();
	drawFan();
	drawHist();
	renderTable();
}

let timer = null;
function scheduleRun() {
	clearTimeout(timer);
	timer = setTimeout(run, 180);
}

function redrawOnly() {
	if (!state.sim) return;
	drawFan();
	drawHist();
}

window.addEventListener('DOMContentLoaded', function () {
	// 共有リンク、なければ前回の入力内容を復元してから計算する
	restoreState();

	// 入力の変更をすべて拾う。表示の切り替えだけなら再計算せず描き直す
	const VIEW_ONLY = { viewMode: 1, showPaths: 1 };
	function onFieldChange(e) {
		if (VIEW_ONLY[e.target.id] && state.sim) {
			state.view = $('viewMode').value;
			$('legendPaths').style.display = $('showPaths').checked ? '' : 'none';
			renderTiles();
			renderTable();
			redrawOnly();
			persistAndShare();
			return;
		}
		scheduleRun();
	}
	const inputs = document.querySelectorAll('.panel input, .panel select');
	for (let i = 0; i < inputs.length; i++) {
		inputs[i].addEventListener('input', onFieldChange);
		inputs[i].addEventListener('change', onFieldChange);
	}
	$('allYears').addEventListener('change', renderTable);

	$('resetBtn').addEventListener('click', function () {
		applyDefaults();
		try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 何もしない */ }
		try {
			// 共有リンクで開いていた場合、再読み込みで元の条件に戻らないようクエリを外す
			if (window.history && window.history.replaceState) {
				window.history.replaceState(null, '', window.location.pathname);
			}
		} catch (e) { /* file:// などで履歴を操作できない場合は何もしない */ }
		run();
	});

	let shareMsgTimer = null;
	$('shareBtn').addEventListener('click', function () {
		const url = buildShareUrl();
		const msg = $('shareMsg');
		const flash = function (text) {
			clearTimeout(shareMsgTimer);
			msg.textContent = text;
			msg.classList.add('show');
			shareMsgTimer = setTimeout(function () { msg.classList.remove('show'); }, 3000);
		};
		copyToClipboard(url).then(
			function () { flash('共有リンクをコピーしました。リンクには入力内容が含まれます。'); },
			function () { flash('コピーできませんでした。URL: ' + url); }
		);
	});

	$('themeToggle').addEventListener('click', function () {
		const cur = document.documentElement.getAttribute('data-theme');
		const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const next = cur ? (cur === 'dark' ? 'light' : 'dark') : (dark ? 'light' : 'dark');
		document.documentElement.setAttribute('data-theme', next);
		redrawOnly();
	});

	let rt = null;
	window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(redrawOnly, 120); });
	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawOnly);

	setupHover();
	run();
});
