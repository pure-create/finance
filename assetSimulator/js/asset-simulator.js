"use strict";

/* 画面の描画と入力の受け取り。計算は asset-core.js の simulate() を使う */

const $ = function (id) {
  return document.getElementById(id);
};

/* 入力欄の一覧：[要素のid, 初期値, 共有URLでの短いキー]。
   保存・共有・「入力をリセット」はすべてこの表を元にする */
const FIELDS = [
  ["ageNow", 40, "a"],
  ["ageRetire", 65, "ar"],
  ["ageEnd", 95, "ae"],
  ["assetNow", 1000, "as"],
  ["contribution", 120, "ct"],
  ["lumpSum", 0, "lp"],
  ["lumpAge", 65, "la"],
  ["lumpBase", "nominal", "lm"],
  ["wdMode", "fixed", "wm"],
  ["withdraw", 360, "wd"],
  ["wdRate", 4.0, "wr"],
  ["salary", 0, "sl"],
  ["salaryUntil", 65, "su"],
  ["pension", 180, "pn"],
  ["pensionFrom", 65, "pf"],
  ["allocStock", 70, "ls"],
  ["allocBond", 25, "lb"],
  ["allocCash", 5, "lc"],
  ["fee", 0.15, "fe"],
  ["retStock", 7.0, "rs"],
  ["riskStock", 18.0, "ks"],
  ["retBond", 2.5, "rb"],
  ["riskBond", 6.0, "kb"],
  ["retCash", 0.7, "rc"],
  ["riskCash", 0.5, "kc"],
  ["corrSB", 0.15, "sb"],
  ["corrSC", 0, "sc"],
  ["corrBC", 0.1, "bc"],
  ["inflation", 2.0, "if"],
  ["taxOn", true, "tx"],
  ["nisaOn", true, "ni"],
  ["nisaUsed", 0, "nu"],
  ["trials", 2000, "tr"],
  ["viewMode", "real", "vw"],
  ["seedFixed", true, "sd"],
  ["showPaths", true, "sp"],
];
function num(id) {
  const v = parseFloat($(id).value);
  return isFinite(v) ? v : 0;
}

function readConfig() {
  return {
    ageNow: Math.round(num("ageNow")),
    ageRetire: Math.round(num("ageRetire")),
    ageEnd: Math.round(num("ageEnd")),
    assetNow: num("assetNow"),
    contribution: num("contribution"),
    lumpSum: num("lumpSum"),
    lumpAge: Math.round(num("lumpAge")),
    lumpBase: $("lumpBase").value,
    wdMode: $("wdMode").value,
    withdraw: num("withdraw"),
    wdRate: num("wdRate"),
    salary: num("salary"),
    salaryUntil: Math.round(num("salaryUntil")),
    pension: num("pension"),
    pensionFrom: Math.round(num("pensionFrom")),
    alloc: [num("allocStock"), num("allocBond"), num("allocCash")],
    ret: [num("retStock"), num("retBond"), num("retCash")],
    risk: [num("riskStock"), num("riskBond"), num("riskCash")],
    corr: [num("corrSB"), num("corrSC"), num("corrBC")],
    fee: num("fee"),
    inflation: num("inflation"),
    taxOn: $("taxOn").checked,
    nisaOn: $("nisaOn").checked,
    nisaUsed: num("nisaUsed"),
    trials: Math.round(num("trials")),
    seed: $("seedFixed").checked
      ? 20260801
      : (Math.random() * 4294967296) >>> 0,
  };
}

/* ---------- 保存・共有 ---------- */
/* 保存・復元・共有URLの中身は common/state.js（Inputs）が持つ。
   上の FIELDS 表がそのまま「何を保存し、URLでは何という名前にするか」になる。
   保存先の名前と、URLでの短い名前は変えないこと（公開済みの共有リンクが
   開けなくなり、次に開いた人の入力も消えるため） */
const inputs = Inputs.create({
  fields: FIELDS,
  storageKey: "assetSimulator.v1",
});

// 現在の入力内容を反映した共有リンクのURLを組み立てる
function buildShareUrl() {
  return inputs.shareUrl();
}

function persistAndShare() {
  inputs.save();
  Share.refreshQr();
}

// --- 数値の書式 ---
function comma(v) {
  return Math.round(v).toLocaleString("ja-JP");
}
function money(v) {
  const a = Math.abs(v);
  if (a >= 100000) return (v / 10000).toFixed(0) + "億円";
  if (a >= 10000) return (v / 10000).toFixed(2) + "億円";
  return comma(v) + "万円";
}
function axisMoney(v) {
  if (v === 0) return "0";
  if (Math.abs(v) >= 10000) {
    const oku = v / 10000;
    return (Math.abs(oku) >= 10 ? oku.toFixed(0) : oku.toFixed(1)) + "億";
  }
  return comma(v);
}
function pctText(v) {
  return (v * 100).toFixed(1) + "%";
}

/* ---------- 数字のカウントアップ ---------- */
/* 条件を変えたときに結果が瞬時に飛ぶと、どの数字がどれだけ動いたか分かりにくい。
   0.5秒かけて動かす。key ごとに「いま画面に出ている値」を覚えておくので、
   途中でさらに条件が変わっても、その位置から続けて動く */
const NUM_ANIM_MS = 500;
const numShown = {}; // key -> 現在表示している数値
const numAnims = {}; // key -> 実行中のアニメーション
let numRaf = null;

const NUM_FMT = {
  money: money,
  comma: comma,
  fixed1: function (v) {
    return v.toFixed(1);
  },
  fixed2: function (v) {
    return v.toFixed(2);
  },
  int: function (v) {
    return String(Math.round(v));
  },
};

function reducedMotion() {
  return (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// タイルのHTMLに埋め込む数字。作った時点では最終値を書いておき、
// DOMに入れたあと startNumAnims() で前の値から動かし直す
function numSpan(key, value, fmt) {
  return (
    '<span data-num-key="' +
    key +
    '" data-num-to="' +
    value +
    '" data-num-fmt="' +
    fmt +
    '">' +
    NUM_FMT[fmt](value) +
    "</span>"
  );
}

// 値が出せないとき（「—」表示など）。次に現れたときは動かさず、その値から始める
function resetNum(key) {
  delete numAnims[key];
  delete numShown[key];
}

function animateNum(el) {
  const key = el.dataset.numKey;
  const to = parseFloat(el.dataset.numTo);
  const fmt = NUM_FMT[el.dataset.numFmt] || comma;
  const from = numShown[key];
  if (!isFinite(to)) {
    resetNum(key);
    return;
  }
  // 初回表示・値が同じ・動きを減らす設定のときは、動かさずそのまま出す
  if (from === undefined || !isFinite(from) || from === to || reducedMotion()) {
    delete numAnims[key];
    numShown[key] = to;
    el.textContent = fmt(to);
    return;
  }
  numAnims[key] = {
    el: el,
    from: from,
    to: to,
    fmt: fmt,
    t0: performance.now(),
  };
  el.textContent = fmt(from);
  if (numRaf === null) numRaf = requestAnimationFrame(numTick);
}

function numTick(now) {
  let active = false;
  for (const key in numAnims) {
    const a = numAnims[key];
    // タイルを作り直して消えた要素は追いかけない
    if (!a.el.isConnected) {
      delete numAnims[key];
      continue;
    }
    const p = Math.min(1, (now - a.t0) / NUM_ANIM_MS);
    const e = 1 - Math.pow(1 - p, 3); // 終わりに向かって減速
    const v = a.from + (a.to - a.from) * e;
    numShown[key] = v;
    a.el.textContent = a.fmt(v);
    if (p >= 1) {
      numShown[key] = a.to;
      delete numAnims[key];
    } else active = true;
  }
  numRaf = active ? requestAnimationFrame(numTick) : null;
}

function startNumAnims(root) {
  const els = root.querySelectorAll("[data-num-key]");
  for (let i = 0; i < els.length; i++) animateNum(els[i]);
}

// 作り直さない既存の要素の数字を動かす
function setNumEl(el, key, value, fmt) {
  el.dataset.numKey = key;
  el.dataset.numTo = value;
  el.dataset.numFmt = fmt;
  animateNum(el);
}

function css(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function niceTicks(max, count) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step =
    (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

// canvas を実ピクセルに合わせる
function setupCanvas(canvas, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth;
  canvas.style.height = cssHeight + "px";
  // width/height への代入は裏のピクセルを確保し直すので、変わっていないときは触らない
  // （ホバーやドラッグの1コマごとにここを通るため）
  const wantW = Math.max(1, Math.round(w * dpr));
  const wantH = Math.round(cssHeight * dpr);
  if (canvas.width !== wantW) canvas.width = wantW;
  if (canvas.height !== wantH) canvas.height = wantH;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, cssHeight);
  return { ctx: ctx, w: w, h: cssHeight };
}

let state = {
  sim: null,
  cfg: null,
  view: "real",
  fanGeom: null,
  histGeom: null,
  hist: null,
  range: null, // { lo, hi, fullN, baseAge } 表示する年インデックス（両端を含む）
  rangeGeom: null, // スライダーの当たり判定に使う座標
  drag: null, // { mode:'move'|'lo'|'hi', pointerId, grabY, grabLo, grabHi }
  rafPending: false,
};

/* ---------- ファンチャート ---------- */
function drawFan() {
  const sim = state.sim,
    cfg = state.cfg;
  if (!sim) return;
  const canvas = $("fanChart");
  const cssH = window.innerWidth < 700 ? 300 : 400;
  const g = setupCanvas(canvas, cssH);
  const ctx = g.ctx;
  const padL = 62,
    padR = 16,
    padT = 12,
    padB = 34;
  const plotW = Math.max(10, g.w - padL - padR);
  const plotH = Math.max(10, g.h - padT - padB);
  const N = sim.years;
  const real = state.view === "real";
  const conv = function (v, y) {
    return real ? v / sim.realFactor(y) : v;
  };

  // 下の帯で選んだ期間だけを描く（初回は範囲がまだ無いので全期間）
  const r = state.range || { lo: 0, hi: N };
  const lo = r.lo,
    hi = r.hi,
    span = Math.max(1, hi - lo);

  // 縦軸の上限。見えている範囲だけで取り直すが、0 は必ず底に残す
  let maxV = 0;
  for (let y = lo; y <= hi; y++) {
    maxV = Math.max(maxV, conv(sim.stats[y].p95, y), conv(sim.principal[y], y));
  }
  if (maxV <= 0) maxV = 1;
  const ticks = niceTicks(maxV * 1.06, 5);
  const top = ticks[ticks.length - 1];
  const X = function (y) {
    return padL + ((y - lo) / span) * plotW;
  };
  const Y = function (v) {
    return padT + plotH - (v / top) * plotH;
  };

  // グリッド
  ctx.strokeStyle = css("--grid");
  ctx.lineWidth = 1;
  ctx.fillStyle = css("--muted");
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i < ticks.length; i++) {
    const yy = Math.round(Y(ticks[i])) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(padL + plotW, yy);
    ctx.stroke();
    ctx.fillText(axisMoney(ticks[i]), padL - 8, yy);
  }

  // 帯（5–95 → 25–75 の順に重ねる）
  function band(lowKey, highKey, color) {
    ctx.beginPath();
    for (let y = lo; y <= hi; y++) {
      const p = conv(sim.stats[y][highKey], y);
      if (y === lo) ctx.moveTo(X(y), Y(p));
      else ctx.lineTo(X(y), Y(p));
    }
    for (let y = hi; y >= lo; y--) {
      const p = conv(sim.stats[y][lowKey], y);
      ctx.lineTo(X(y), Y(p));
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  band("p05", "p95", css("--band-outer"));
  band("p25", "p75", css("--band-inner"));

  // 個別の試行（識別に色を使わない薄い線）
  if ($("showPaths").checked) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, plotW, plotH);
    ctx.clip();
    ctx.strokeStyle = css("--path");
    ctx.lineWidth = 1;
    for (let k = 0; k < sim.samples.length; k++) {
      ctx.beginPath();
      for (let y = lo; y <= hi; y++) {
        const v = conv(sim.samples[k][y], y);
        if (y === lo) ctx.moveTo(X(y), Y(v));
        else ctx.lineTo(X(y), Y(v));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 取り崩し開始の目印
  const retY = cfg.ageRetire - cfg.ageNow;
  if (retY > lo && retY < hi) {
    const rx = Math.round(X(retY)) + 0.5;
    ctx.strokeStyle = css("--axis");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx, padT);
    ctx.lineTo(rx, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = css("--text-secondary");
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "top";
    // 期間を絞ると目印が右端に寄ることがあるので、はみ出すときは左向きに回す
    const retLabel = "取り崩し開始 " + cfg.ageRetire + "歳";
    if (rx + 5 + ctx.measureText(retLabel).width > padL + plotW) {
      ctx.textAlign = "right";
      ctx.fillText(retLabel, rx - 5, padT + 2);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(retLabel, rx + 5, padT + 2);
    }
  }

  // 運用しなかった場合（破線）
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();
  ctx.strokeStyle = css("--series-2");
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let y = lo; y <= hi; y++) {
    const v = conv(sim.principal[y], y);
    if (y === lo) ctx.moveTo(X(y), Y(v));
    else ctx.lineTo(X(y), Y(v));
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 中央値
  ctx.strokeStyle = css("--series-1");
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let y = lo; y <= hi; y++) {
    const v = conv(sim.stats[y].p50, y);
    if (y === lo) ctx.moveTo(X(y), Y(v));
    else ctx.lineTo(X(y), Y(v));
  }
  ctx.stroke();

  // 中央値の終端（表示している範囲の右端）に丸と直接ラベル
  const endV = conv(sim.stats[hi].p50, hi);
  ctx.beginPath();
  ctx.arc(X(hi), Y(endV), 4.5, 0, Math.PI * 2);
  ctx.fillStyle = css("--series-1");
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = css("--surface-1");
  ctx.stroke();
  ctx.fillStyle = css("--text-primary");
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(money(endV), X(hi) - 2, Y(endV) - 9);

  // 横軸
  ctx.strokeStyle = css("--axis");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, Math.round(padT + plotH) + 0.5);
  ctx.lineTo(padL + plotW, Math.round(padT + plotH) + 0.5);
  ctx.stroke();
  ctx.fillStyle = css("--muted");
  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "top";
  const ageStep = span <= 20 ? 5 : span <= 45 ? 10 : 15;
  // 両端はどんなに狭くても出す。間は刻みで間引いたうえ、
  // 端のラベルが占める幅を実測して、そこへ食い込むものを落とす
  const headLabel = cfg.ageNow + lo + "歳",
    tailLabel = cfg.ageNow + hi + "歳";
  const leftEnd = X(lo) + ctx.measureText(headLabel).width + 6;
  const rightEnd = X(hi) - ctx.measureText(tailLabel).width - 6;
  for (let y = lo + 1; y < hi; y++) {
    const age = cfg.ageNow + y;
    if (age % ageStep !== 0) continue;
    const label = age + "歳";
    const half = ctx.measureText(label).width / 2;
    if (X(y) - half < leftEnd || X(y) + half > rightEnd) continue;
    ctx.textAlign = "center";
    ctx.fillText(label, X(y), padT + plotH + 7);
  }
  ctx.textAlign = "left";
  ctx.fillText(headLabel, X(lo), padT + plotH + 7);
  ctx.textAlign = "right";
  ctx.fillText(tailLabel, X(hi), padT + plotH + 7);
  ctx.textAlign = "right";
  ctx.fillText(
    "（" + (real ? "実質・現在の物価" : "名目") + "／万円）",
    padL + plotW,
    padT + plotH + 20,
  );

  state.fanGeom = {
    padL: padL,
    padT: padT,
    plotW: plotW,
    plotH: plotH,
    N: N,
    lo: lo,
    hi: hi,
    span: span,
    X: X,
    Y: Y,
    conv: conv,
    top: top,
  };
}

/* ---------- 表示期間スライダー ----------
   全期間を縮めた帯の上に「窓」を重ね、つまんで動かすと上のグラフがその期間だけになる。
   範囲は年インデックス（整数）で持つ。stats も横軸のラベルもホバーの十字線も整数で
   引いているので、端数を許しても読みやすさは上がらない。 */

const RANGE_MIN_SPAN = 2; // 3点。帯が線ではなく面になる下限
const RANGE_HIT = 11; // 左右のつまみの当たり判定（px）

function fullRange(N) {
  return { lo: 0, hi: N, fullN: N, baseAge: state.cfg.ageNow };
}

function isFullRange() {
  const r = state.range;
  return !r || (r.lo === 0 && r.hi === r.fullN);
}

// lo/hi を整数・最小幅・0..N に収める唯一の入口。
// つまみが相手を追い越したときは入れ替えず手前で止める（掴んだ端が途中で入れ替わらないように）
function setRange(lo, hi, N) {
  const minSpan = Math.min(RANGE_MIN_SPAN, N);
  lo = Math.round(lo);
  hi = Math.round(hi);
  lo = Math.max(0, Math.min(N - minSpan, lo));
  hi = Math.max(lo + minSpan, Math.min(N, hi));
  if (hi - lo < minSpan) lo = Math.max(0, hi - minSpan);
  state.range = { lo: lo, hi: hi, fullN: N, baseAge: state.cfg.ageNow };
}

// 新しい計算結果に範囲を合わせる。期間の長さか開始年齢が変わったら
// 窓の下の年齢の意味が変わってしまうので、全期間に戻す
function syncRange(cfg, N) {
  const r = state.range;
  if (!r || r.fullN !== N || r.baseAge !== cfg.ageNow) {
    state.range = fullRange(N);
    return;
  }
  setRange(r.lo, r.hi, N);
}

function resetRange() {
  if (!state.sim) return;
  state.range = fullRange(state.sim.years);
  applyRange();
}

// 年齢の目盛の刻み。ラベルが「45歳」で10px、間を空けて46pxあれば窮屈にならない。
// 入らなくなったら次の刻みへ送る（5→10→15…）
function rangeAgeStep(plotW, N) {
  const STEPS = [5, 10, 15, 20, 25, 50];
  for (let i = 0; i < STEPS.length; i++) {
    if ((plotW * STEPS[i]) / Math.max(1, N) >= 46) return STEPS[i];
  }
  return STEPS[STEPS.length - 1];
}

function drawRange() {
  const sim = state.sim;
  if (!sim) return;
  const cssH = window.innerWidth < 700 ? 64 : 72;
  const g = setupCanvas($("rangeChart"), cssH);
  const ctx = g.ctx;
  // padL・padR は drawFan と同じ値にして、上のグラフと横位置をそろえる。
  // padT はドラッグ中に出す年齢の吹き出しのぶん（出ていなくても場所は空けておき、
  // 掴んだ瞬間に帯の高さが変わらないようにする）、padB は下の年齢の目盛のぶん
  const padL = 62,
    padR = 16,
    padT = 20,
    padB = 15;
  const plotW = Math.max(10, g.w - padL - padR);
  const plotH = Math.max(6, g.h - padT - padB);
  const N = sim.years;
  const real = state.view === "real";
  const conv = function (v, y) {
    return real ? v / sim.realFactor(y) : v;
  };
  const X = function (y) {
    return padL + (N === 0 ? 0 : (y / N) * plotW);
  };

  // 全期間の中央値だけを1本の面グラフにする。
  // 帯まで入れると上位側の伸びに引っ張られて中央値が底に張り付き、形が読めなくなる。
  // 縦の上限は常に全期間で取る（窓を動かしても形が動かないように）
  let maxV = 0;
  for (let y = 0; y <= N; y++) maxV = Math.max(maxV, conv(sim.stats[y].p50, y));
  if (maxV <= 0) maxV = 1;
  maxV *= 1.1;
  const Y = function (v) {
    return padT + plotH - (v / maxV) * plotH;
  };

  const base = padT + plotH;
  ctx.beginPath();
  ctx.moveTo(X(0), base);
  for (let y = 0; y <= N; y++) ctx.lineTo(X(y), Y(conv(sim.stats[y].p50, y)));
  ctx.lineTo(X(N), base);
  ctx.closePath();
  ctx.fillStyle = css("--band-outer");
  ctx.fill();

  ctx.strokeStyle = css("--series-1");
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let y = 0; y <= N; y++) {
    const v = conv(sim.stats[y].p50, y);
    if (y === 0) ctx.moveTo(X(y), Y(v));
    else ctx.lineTo(X(y), Y(v));
  }
  ctx.stroke();

  // 左の余白は上のグラフの縦軸ラベルと同じ幅を空けてあるので、そこに帯の名前を置く
  ctx.fillStyle = css("--muted");
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("表示期間", padL - 8, padT + plotH / 2);

  // 年齢の目盛。両端は必ず出し、間は 5歳・10歳… と切りのいい刻みで入るぶんだけ置く。
  // 窓を絞っても、全体のどこを見ているかが分かるように
  ctx.fillStyle = css("--muted");
  ctx.font = "10px system-ui, sans-serif";
  ctx.textBaseline = "top";
  const ty = base + 3;
  const headLabel = state.cfg.ageNow + "歳",
    tailLabel = state.cfg.ageNow + N + "歳";
  // 両端のラベルが実際に占める幅を測り、そこへ食い込むものは置かない
  const leftEnd = padL + ctx.measureText(headLabel).width + 6;
  const rightEnd = padL + plotW - ctx.measureText(tailLabel).width - 6;
  const ageStep = rangeAgeStep(plotW, N);
  ctx.textAlign = "center";
  for (let y = 1; y < N; y++) {
    const age = state.cfg.ageNow + y;
    if (age % ageStep !== 0) continue;
    const label = age + "歳";
    const half = ctx.measureText(label).width / 2;
    if (X(y) - half < leftEnd || X(y) + half > rightEnd) continue;
    ctx.fillText(label, X(y), ty);
  }
  ctx.textAlign = "left";
  ctx.fillText(headLabel, padL, ty);
  ctx.textAlign = "right";
  ctx.fillText(tailLabel, padL + plotW, ty);

  // 範囲の外を薄い膜で覆う（上下の余白の行は覆わない）
  const r = state.range || { lo: 0, hi: N };
  const xl = X(r.lo),
    xh = X(r.hi);
  ctx.fillStyle = css("--range-scrim");
  if (xl > padL) ctx.fillRect(padL, padT, xl - padL, plotH);
  if (xh < padL + plotW) ctx.fillRect(xh, padT, padL + plotW - xh, plotH);

  // 窓の枠と、左右のつまみ
  ctx.strokeStyle = css("--range-edge");
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(xl) + 0.5,
    padT + 0.5,
    Math.max(1, Math.round(xh - xl) - 1),
    plotH - 1,
  );

  const gw = 6,
    gh = plotH - 6,
    gy = padT + 3;
  ctx.fillStyle = css("--range-edge");
  ctx.strokeStyle = css("--range-grip");
  ctx.lineWidth = 1;
  [xl, xh].forEach(function (x) {
    const gx = Math.round(x - gw / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(gx, gy, gw, gh, 3);
    else ctx.rect(gx, gy, gw, gh);
    ctx.fill();
    // つまみの中の2本線。掴めることの目印
    ctx.beginPath();
    ctx.moveTo(gx + 2.5, gy + gh * 0.32);
    ctx.lineTo(gx + 2.5, gy + gh * 0.68);
    ctx.moveTo(gx + gw - 2.5, gy + gh * 0.32);
    ctx.lineTo(gx + gw - 2.5, gy + gh * 0.68);
    ctx.stroke();
  });

  // つまみを動かしている間だけ、その上に今の年齢を出す
  if (isRangePinned()) drawRangePins(ctx, r, xl, xh, padL, plotW, padT);

  state.rangeGeom = {
    padL: padL,
    padT: padT,
    plotW: plotW,
    plotH: plotH,
    N: N,
    X: X,
  };
}

// 年齢の吹き出しを出すのは、つまみをドラッグしている間と、
// キーボードで操作している間（＝キー操作でフォーカスの輪が出ている間）
function isRangePinned() {
  if (state.drag) return true;
  const wrap = $("rangeWrap");
  try {
    return wrap.matches(":focus-visible");
  } catch (e) {
    return false;
  }
}

function drawRangePins(ctx, r, xl, xh, padL, plotW, padT) {
  const age = function (y) {
    return state.cfg.ageNow + y + "歳";
  };
  const H = 15,
    PAD = 5,
    cy = (padT - H) / 2;
  ctx.font = "600 10px system-ui, sans-serif";
  ctx.textBaseline = "middle";

  function pin(text, cx) {
    const w = ctx.measureText(text).width + PAD * 2;
    // 帯からはみ出さないように収める
    let x = Math.max(padL, Math.min(padL + plotW - w, cx - w / 2));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, cy, w, H, 4);
    else ctx.rect(x, cy, w, H);
    ctx.fillStyle = css("--tooltip-bg");
    ctx.fill();
    ctx.strokeStyle = css("--tooltip-border");
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = css("--tooltip-text");
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, cy + H / 2 + 0.5);
    return { x: x, w: w };
  }

  // 2つが重なるほど窓が狭いときは、1つにまとめて範囲ごと出す
  const wl = ctx.measureText(age(r.lo)).width + PAD * 2;
  const wh = ctx.measureText(age(r.hi)).width + PAD * 2;
  if (xh - xl < (wl + wh) / 2 + 6) {
    pin(age(r.lo) + "〜" + age(r.hi), (xl + xh) / 2);
  } else {
    pin(age(r.lo), xl);
    pin(age(r.hi), xh);
  }
}

function updateRangeUi() {
  const cfg = state.cfg,
    sim = state.sim;
  if (!cfg || !sim) return;
  const r = state.range || fullRange(sim.years);
  const a1 = cfg.ageNow + r.lo,
    a2 = cfg.ageNow + r.hi;
  const full = isFullRange();
  $("rangeReset").hidden = full;
  const wrap = $("rangeWrap");
  wrap.setAttribute("aria-valuemin", cfg.ageNow);
  wrap.setAttribute("aria-valuemax", cfg.ageEnd);
  wrap.setAttribute("aria-valuenow", a1);
  wrap.setAttribute("aria-valuetext", a1 + "歳から" + a2 + "歳");
  $("fanSub").textContent = fanSubText();
}

// ドラッグ中の描き直しを1コマにまとめる（高頻度のポインタでも1フレーム1回）
function applyRange() {
  if (state.rafPending) return;
  state.rafPending = true;
  requestAnimationFrame(function () {
    state.rafPending = false;
    drawFan();
    drawRange();
    updateRangeUi();
  });
}

function setupRange() {
  const wrap = $("rangeWrap"),
    canvas = $("rangeChart");

  function pxToYear(clientX) {
    const geo = state.rangeGeom;
    const x = clientX - canvas.getBoundingClientRect().left;
    return Math.max(0, Math.min(geo.N, ((x - geo.padL) / geo.plotW) * geo.N));
  }

  // 押した場所から操作の種類を決める
  function pickMode(clientX) {
    const geo = state.rangeGeom,
      r = state.range;
    const x = clientX - canvas.getBoundingClientRect().left;
    const xl = geo.X(r.lo),
      xh = geo.X(r.hi);
    if (Math.abs(x - xl) <= RANGE_HIT) return "lo";
    if (Math.abs(x - xh) <= RANGE_HIT) return "hi";
    if (x > xl && x < xh) return "move";
    return "jump";
  }

  // 二度押しで全期間に戻す仕掛けは置かない。同じ場所から続けて掴み直したときに
  // 意図せず範囲が飛ぶため、戻す道は「全期間に戻す」ボタンと Esc の2つに絞る
  wrap.addEventListener("pointerdown", function (ev) {
    if (!state.sim || !state.rangeGeom || !state.range) return;
    if (ev.button !== undefined && ev.button !== 0) return; // 右・中クリックは相手にしない
    const N = state.rangeGeom.N;
    const yr = pxToYear(ev.clientX);
    let mode = pickMode(ev.clientX);
    if (mode === "jump") {
      // 窓の外を押したら、いまの幅のままそこへ飛ばして、そのまま動かせるようにする
      const half = (state.range.hi - state.range.lo) / 2;
      setRange(yr - half, yr + half, N);
      mode = "move";
    }
    state.drag = {
      mode: mode,
      pointerId: ev.pointerId,
      grabY: yr,
      grabLo: state.range.lo,
      grabHi: state.range.hi,
    };
    try {
      wrap.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* すでに離れている */
    }
    wrap.classList.add("dragging");
    $("fanTip").style.opacity = 0; // 直前のホバーの吹き出しを残さない
    ev.preventDefault();
    applyRange();
  });

  wrap.addEventListener("pointermove", function (ev) {
    const d = state.drag;
    if (!d || d.pointerId !== ev.pointerId || !state.rangeGeom) return;
    const N = state.rangeGeom.N;
    const yr = pxToYear(ev.clientX);
    if (d.mode === "lo") {
      setRange(yr, d.grabHi, N);
    } else if (d.mode === "hi") {
      setRange(d.grabLo, yr, N);
    } else {
      // 端に当たっても幅を保つ。先に lo を収めてから hi を導く
      const sp = d.grabHi - d.grabLo;
      let lo = Math.round(d.grabLo + (yr - d.grabY));
      lo = Math.max(0, Math.min(N - sp, lo));
      setRange(lo, lo + sp, N);
    }
    applyRange();
  });

  function endDrag(ev) {
    const d = state.drag;
    if (
      !d ||
      (ev && ev.pointerId !== undefined && d.pointerId !== ev.pointerId)
    )
      return;
    state.drag = null;
    wrap.classList.remove("dragging");
    try {
      wrap.releasePointerCapture(d.pointerId);
    } catch (e) {
      /* すでに離れている */
    }
    applyRange();
  }
  wrap.addEventListener("pointerup", endDrag);
  wrap.addEventListener("pointercancel", endDrag);
  wrap.addEventListener("lostpointercapture", endDrag);

  wrap.addEventListener("keydown", function (ev) {
    if (!state.sim || !state.range) return;
    const N = state.sim.years,
      r = state.range;
    const step = ev.shiftKey ? 5 : 1;
    const sp = r.hi - r.lo;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      const d = ev.key === "ArrowLeft" ? -step : step;
      if (ev.altKey) {
        setRange(r.lo, r.hi + d, N); // 右端だけ動かして幅を変える
      } else {
        // 幅を保って窓ごと動かす。端に当たっても縮まないよう lo を先に収める
        const lo = Math.max(0, Math.min(N - sp, r.lo + d));
        setRange(lo, lo + sp, N);
      }
    } else if (ev.key === "Home") {
      setRange(0, sp, N);
    } else if (ev.key === "End") {
      setRange(N - sp, N, N);
    } else if (ev.key === "Escape") {
      state.range = fullRange(N);
    } else {
      return;
    }
    ev.preventDefault();
    applyRange();
  });

  $("rangeReset").addEventListener("click", resetRange);
}

/* ---------- ヒストグラム ---------- */

// 100万・200万・500万・1000万… と切りのいい刻み幅（1・2・5 × 10^n）
function niceWidth(raw) {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

const HIST_TARGET_BINS = 34; // 刻み幅を丸めるので、実際の本数はこの半分〜同数になる

function buildHistogram() {
  const sim = state.sim;
  const real = state.view === "real";
  const N = sim.years;
  const f = real ? sim.realFactor(N) : 1;
  // sim.finals は昇順。同じ数で割っても順序は変わらない
  const vals = new Float64Array(sim.finals.length);
  for (let i = 0; i < sim.finals.length; i++) vals[i] = sim.finals[i] / f;

  // 資金が尽きた試行（0円）は左端の別の棒にまとめる。
  // 2割を超えることも珍しくなく、他の棒と同じ目盛に載せると分布が潰れて読めないため
  let zeroCount = 0;
  while (zeroCount < vals.length && vals[zeroCount] <= 1e-6) zeroCount++;
  const alive = vals.subarray(zeroCount);

  // 右の裾が非常に長いので、中央値の3倍あたりで切って低い側を細かく刻む。
  // 超えた分は最右の「〜以上」の棒にまとめる（裾が短い分布では95パーセンタイルまで）
  let width, bins;
  if (alive.length === 0) {
    width = 100;
    bins = 1;
  } else {
    let center = percentile(vals, 0.5);
    if (!(center > 0)) center = percentile(alive, 0.5);
    const p95 = percentile(alive, 0.95);
    let upper = center * 3;
    if (!(upper > 0) || upper > p95) upper = p95;
    if (!(upper > 0)) upper = alive[alive.length - 1];
    if (!(upper > 0)) upper = 100;
    width = niceWidth(upper / HIST_TARGET_BINS);
    bins = Math.max(1, Math.ceil(upper / width));
  }
  const counts = new Array(bins + 1).fill(0); // 最後は「上限以上」
  for (let i = 0; i < alive.length; i++)
    counts[Math.min(bins, Math.floor(alive[i] / width))]++;

  return {
    counts: counts,
    width: width,
    bins: bins,
    vals: vals,
    zeroCount: zeroCount,
    cutoff: bins * width,
  };
}

function drawHist() {
  const sim = state.sim;
  if (!sim) return;
  const h = (state.hist = buildHistogram());
  const canvas = $("histChart");
  const g = setupCanvas(canvas, window.innerWidth < 700 ? 190 : 230);
  const ctx = g.ctx;
  const padL = 52,
    padR = 16,
    padT = 24,
    padB = 34;
  const plotW = Math.max(10, g.w - padL - padR);
  const plotH = Math.max(10, g.h - padT - padB);

  const nBars = h.counts.length; // 金額のビン（最後は「〜以上」）
  const hasZero = h.zeroCount > 0; // 0円の棒を左端に置くか
  const slots = nBars + (hasZero ? 1 : 0);
  const slot = plotW / slots;
  const x0 = padL + (hasZero ? slot : 0); // 金額0の位置（ビンの左端）
  const gap = 2.5; // 棒どうしの隙間
  const barW = Math.min(48, Math.max(1, slot - gap));

  // 度数の目盛。両端は「0円」「〜以上」をまとめた棒で突出しやすいので、
  // 目盛は間のビンだけを基準にして、はみ出す棒は上端で断ち切る
  let maxC = 0;
  for (let i = 0; i < h.bins; i++) maxC = Math.max(maxC, h.counts[i]);
  if (maxC <= 0) maxC = Math.max(1, h.zeroCount, h.counts[h.bins]);
  const ticks = niceTicks(maxC, 4);
  // niceTicks は最大値以下までしか刻まないので、一番高い棒が収まるまで伸ばす
  while (ticks[ticks.length - 1] < maxC) {
    ticks.push(
      ticks[ticks.length - 1] +
        (ticks.length > 1 ? ticks[1] - ticks[0] : Math.max(1, maxC)),
    );
  }
  const topC = ticks[ticks.length - 1];
  ctx.strokeStyle = css("--grid");
  ctx.lineWidth = 1;
  ctx.fillStyle = css("--muted");
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i < ticks.length; i++) {
    const yy = Math.round(padT + plotH - (ticks[i] / topC) * plotH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(padL + plotW, yy);
    ctx.stroke();
    ctx.fillText(pctText(ticks[i] / sim.trials), padL - 8, yy);
  }

  // 棒（先端だけ 4px の丸み）。目盛を超える棒は上端で断ち切り、割合を上に書く
  function drawBar(cx, count, color) {
    if (count <= 0) return;
    const full = (count / topC) * plotH;
    const cut = full > plotH + 0.5;
    const bh = cut ? plotH : full;
    const x = cx - barW / 2;
    const y = padT + plotH - bh;
    const r = cut ? 0 : Math.min(4, barW / 2, bh);
    ctx.beginPath();
    ctx.moveTo(x, padT + plotH);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, padT + plotH);
    ctx.closePath();
    // 中は薄く塗り、輪郭だけをはっきりした色で描く
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!cut) return;
    // 断ち切りの印（背景色のギザギザ）と実際の割合
    ctx.fillStyle = css("--surface-1");
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x + barW / 2, y + 5);
    ctx.lineTo(x + barW, y + 8);
    ctx.lineTo(x + barW, y + 12);
    ctx.lineTo(x + barW / 2, y + 9);
    ctx.lineTo(x, y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(pctText(count / sim.trials), cx, y - 3);
  }

  // まとめた棒（両端）と分布そのものの棒を、破線で区切って見分けられるようにする
  function divider(x) {
    ctx.strokeStyle = css("--grid");
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) - 0.5, padT);
    ctx.lineTo(Math.round(x) - 0.5, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 0円（資金が尽きた）の棒を左端に置く
  if (hasZero) {
    drawBar(padL + slot / 2, h.zeroCount, css("--critical"));
    divider(x0);
  }
  for (let i = 0; i < nBars; i++)
    drawBar(x0 + (i + 0.5) * slot, h.counts[i], css("--series-1"));
  if (h.counts[h.bins] > 0) divider(x0 + h.bins * slot);

  // 中央値の注記。目盛は棒の位置に合わせてあるので、線も中央値が入る棒の中心に引く
  const med = percentile(h.vals, 0.5);
  const mx =
    med <= 1e-6 && hasZero
      ? padL + slot / 2
      : x0 + (Math.min(h.bins, Math.floor(med / h.width)) + 0.5) * slot;
  ctx.strokeStyle = css("--text-primary");
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(mx, padT);
  ctx.lineTo(mx, padT + plotH);
  ctx.stroke();
  ctx.fillStyle = css("--text-primary");
  ctx.font = "600 11.5px system-ui, sans-serif";
  ctx.textBaseline = "top";
  if (mx > padL + plotW * 0.6) {
    ctx.textAlign = "right";
    ctx.fillText("中央値 " + money(med), mx - 5, padT);
  } else {
    ctx.textAlign = "left";
    ctx.fillText("中央値 " + money(med), mx + 5, padT);
  }

  // 横軸
  ctx.strokeStyle = css("--axis");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, Math.round(padT + plotH) + 0.5);
  ctx.lineTo(padL + plotW, Math.round(padT + plotH) + 0.5);
  ctx.stroke();
  ctx.fillStyle = css("--muted");
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // 目盛は棒の真下に、その棒の上限の金額を置く（0〜500万の棒なら「500」）。
  // 1・2・5・10本おきに間引くので、間隔も金額の刻みも一定になる
  const every = niceWidth(Math.max(1, 52 / slot));
  const tickBins = [];
  for (let i = every - 1; i < h.bins; i += every) {
    // 最後のビンの上限は「◯以上」の境目と同じ金額。重なるものは省く
    if (i === h.bins - 1 || (h.bins - i) * slot < 46) continue;
    tickBins.push(i);
  }
  const tickVals = tickBins
    .map(function (i) {
      return (i + 1) * h.width;
    })
    .concat([h.cutoff]);
  // 億表示の小数桁は、丸めても値が変わらないところまで増やす（1.1億が並ぶのを防ぐ）
  let digits = 0;
  while (
    digits < 3 &&
    tickVals.some(function (v) {
      return (
        v >= 10000 &&
        Math.abs(v / 10000 - Number((v / 10000).toFixed(digits))) > 1e-9
      );
    })
  )
    digits++;
  const tickLabel = function (v) {
    return v >= 10000 ? (v / 10000).toFixed(digits) + "億" : axisMoney(v);
  };
  for (let k = 0; k < tickBins.length; k++) {
    ctx.fillText(
      tickLabel(tickVals[k]),
      x0 + (tickBins[k] + 0.5) * slot,
      padT + plotH + 7,
    );
  }
  ctx.fillText(
    tickLabel(h.cutoff) + "〜",
    x0 + (h.bins + 0.5) * slot,
    padT + plotH + 7,
  );
  if (hasZero) {
    ctx.fillStyle = css("--critical");
    ctx.fillText("0円", padL + slot / 2, padT + plotH + 7);
    ctx.fillStyle = css("--muted");
  }
  ctx.textAlign = "right";
  ctx.fillText(
    "（" + (state.view === "real" ? "実質" : "名目") + "／万円）",
    padL + plotW,
    padT + plotH + 20,
  );

  state.histGeom = {
    padL: padL,
    padT: padT,
    plotW: plotW,
    plotH: plotH,
    slot: slot,
    slots: slots,
    hasZero: hasZero,
  };

  // 刻み幅と上限は分布に合わせて変わるので、説明も一緒に書き換える
  $("histSub").textContent =
    state.cfg.ageEnd +
    "歳時点の資産の分布。棒1本が " +
    money(h.width) +
    "ごと（目盛はその棒の上限）。" +
    (hasZero ? "左端は資金が尽きた（0円の）試行、" : "") +
    "右端は " +
    money(h.cutoff) +
    " 以上をまとめた棒です。" +
    (state.ms !== undefined ? "計算 " + state.ms.toFixed(0) + "ms。" : "");
}

/* ---------- ホバー ---------- */
function setupHover() {
  const fanWrap = $("fanWrap"),
    fanTip = $("fanTip"),
    fanCanvas = $("fanChart");
  function fanMove(ev) {
    const geo = state.fanGeom,
      sim = state.sim;
    if (!geo || !sim) return;
    const rect = fanCanvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    if (
      mx < geo.padL - 6 ||
      mx > geo.padL + geo.plotW + 6 ||
      my < 0 ||
      my > geo.padT + geo.plotH + 6
    ) {
      fanTip.style.opacity = 0;
      drawFan();
      return;
    }
    const y = Math.max(
      geo.lo,
      Math.min(
        geo.hi,
        geo.lo + Math.round(((mx - geo.padL) / geo.plotW) * geo.span),
      ),
    );
    const s = sim.stats[y];
    drawFan();
    // クロスヘア
    const ctx = fanCanvas.getContext("2d");
    const gx = Math.round(geo.X(y)) + 0.5;
    ctx.strokeStyle = css("--text-secondary");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx, geo.padT);
    ctx.lineTo(gx, geo.padT + geo.plotH);
    ctx.stroke();
    const cy = geo.Y(geo.conv(s.p50, y));
    ctx.beginPath();
    ctx.arc(gx - 0.5, cy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = css("--series-1");
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = css("--surface-1");
    ctx.stroke();

    const rows = [
      ["上位5%", money(geo.conv(s.p95, y))],
      ["上位25%", money(geo.conv(s.p75, y))],
      ["中央値", money(geo.conv(s.p50, y))],
      ["下位25%", money(geo.conv(s.p25, y))],
      ["下位5%", money(geo.conv(s.p05, y))],
      ["運用なし", money(geo.conv(sim.principal[y], y))],
      ["資金が尽きた割合", pctText(s.ruinRate)],
    ];
    let html =
      '<div class="tt-title">' + s.age + "歳（" + y + "年後）</div><table>";
    for (let i = 0; i < rows.length; i++)
      html += "<tr><td>" + rows[i][0] + "</td><td>" + rows[i][1] + "</td></tr>";
    html += "</table>";
    fanTip.innerHTML = html;
    fanTip.style.opacity = 1;
    const tw = fanTip.offsetWidth,
      th = fanTip.offsetHeight;
    let left = geo.X(y) + 14;
    if (left + tw > fanCanvas.clientWidth) left = geo.X(y) - tw - 14;
    fanTip.style.left = Math.max(0, left) + "px";
    fanTip.style.top =
      Math.max(0, Math.min(geo.padT + geo.plotH - th, my - th / 2)) + "px";
  }
  fanWrap.addEventListener("mousemove", fanMove);
  fanWrap.addEventListener("mouseleave", function () {
    $("fanTip").style.opacity = 0;
    drawFan();
  });

  const histWrap = $("histWrap"),
    histTip = $("histTip"),
    histCanvas = $("histChart");
  histWrap.addEventListener("mousemove", function (ev) {
    const geo = state.histGeom,
      h = state.hist,
      sim = state.sim;
    if (!geo || !h || !sim) return;
    const rect = histCanvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left,
      my = ev.clientY - rect.top;
    const j = Math.floor((mx - geo.padL) / geo.slot);
    if (j < 0 || j >= geo.slots || my > geo.padT + geo.plotH + 6) {
      histTip.style.opacity = 0;
      return;
    }
    // 左端に 0円 の棒がある場合、その1枠ぶんだけビン番号がずれる
    const i = geo.hasZero ? j - 1 : j;
    let label, count;
    if (i < 0) {
      label = "0円（資金が尽きた）";
      count = h.zeroCount;
    } else {
      const lo = i * h.width,
        hi = (i + 1) * h.width;
      label =
        i === h.bins ? money(lo) + " 以上" : money(lo) + " 〜 " + money(hi);
      count = h.counts[i];
    }
    histTip.innerHTML =
      '<div class="tt-title">' +
      label +
      "</div><table><tr><td>試行</td><td>" +
      comma(count) +
      "回</td></tr>" +
      "<tr><td>割合</td><td>" +
      pctText(count / sim.trials) +
      "</td></tr></table>";
    histTip.style.opacity = 1;
    const tw = histTip.offsetWidth;
    let left = geo.padL + j * geo.slot + geo.slot / 2 - tw / 2;
    left = Math.max(0, Math.min(histCanvas.clientWidth - tw, left));
    histTip.style.left = left + "px";
    histTip.style.top = Math.max(0, my - histTip.offsetHeight - 12) + "px";
  });
  histWrap.addEventListener("mouseleave", function () {
    $("histTip").style.opacity = 0;
  });
}

/* ---------- タイル・テーブル ---------- */
function renderTiles() {
  const sim = state.sim,
    cfg = state.cfg;
  const real = state.view === "real";
  const N = sim.years;
  const f = real ? sim.realFactor(N) : 1;
  const s = sim.stats[N];
  const rate = sim.successRate;
  const color =
    rate >= 0.9
      ? "var(--good)"
      : rate >= 0.75
        ? "var(--warning)"
        : "var(--critical)";
  const word =
    rate >= 0.9 ? "余裕あり" : rate >= 0.75 ? "注意" : "見直しが必要";

  const tiles = [];
  if (cfg.wdMode === "fixed") {
    tiles.push(
      '<div class="tile hero"><div class="label">' +
        cfg.ageEnd +
        "歳まで資金が尽きない確率</div>" +
        '<div class="value" style="color:' +
        color +
        '">' +
        numSpan("rate", rate * 100, "fixed1") +
        '<span style="font-size:24px">%</span></div>' +
        '<div class="sub"><span class="status-dot" style="background:' +
        color +
        '"></span>' +
        word +
        "　（" +
        comma(sim.trials) +
        "回中 " +
        comma(Math.round((1 - rate) * sim.trials)) +
        "回が不足）</div></div>",
    );
  } else {
    tiles.push(
      '<div class="tile hero"><div class="label">最終年の取り崩し額（実質・中央値）</div>' +
        '<div class="value">' +
        numSpan("wdFinal", sim.medianFinalWithdrawReal, "comma") +
        '<span style="font-size:20px">万円</span></div>' +
        '<div class="sub">定率方式では資金は理論上尽きませんが、金額が変動します</div></div>',
    );
  }
  tiles.push(
    '<div class="tile"><div class="label">' +
      cfg.ageEnd +
      "歳時点の資産（中央値）</div>" +
      '<div class="value">' +
      numSpan("p50", s.p50 / f, "money") +
      '</div><div class="sub">' +
      (real ? "実質・現在の物価" : "名目") +
      "</div></div>",
  );
  tiles.push(
    '<div class="tile"><div class="label">同・下位5%（悪いケース）</div>' +
      '<div class="value">' +
      numSpan("p05", s.p05 / f, "money") +
      '</div><div class="sub">20回に1回はこれ以下</div></div>',
  );
  tiles.push(
    '<div class="tile"><div class="label">同・上位5%（良いケース）</div>' +
      '<div class="value">' +
      numSpan("p95", s.p95 / f, "money") +
      '</div><div class="sub">20回に1回はこれ以上</div></div>',
  );
  if (cfg.wdMode === "fixed") {
    const dep = sim.medianDepletionAge;
    if (dep === null) resetNum("depAge");
    tiles.push(
      '<div class="tile"><div class="label">資金が尽きる年齢（中央値）</div>' +
        '<div class="value">' +
        (dep === null
          ? "—"
          : numSpan("depAge", dep, "int") +
            '<span style="font-size:18px">歳</span>') +
        "</div>" +
        '<div class="sub">' +
        (dep === null
          ? "尽きた試行はありません"
          : "尽きた " + comma(sim.depletionAges.length) + "回のうちの中央値") +
        "</div></div>",
    );
  }
  $("tiles").innerHTML = tiles.join("");
  startNumAnims($("tiles"));
}

function renderTable() {
  const sim = state.sim,
    cfg = state.cfg;
  const real = state.view === "real";
  const all = $("allYears").checked;
  const N = sim.years;
  const head =
    "<tr><th>年齢</th><th>経過</th><th>運用なし</th><th>下位5%</th><th>下位25%</th><th>中央値</th><th>上位25%</th><th>上位5%</th><th>資金切れ</th></tr>";
  let body = "";
  for (let y = 0; y <= N; y++) {
    const age = cfg.ageNow + y;
    const isRetire = age === cfg.ageRetire;
    if (!all && y !== 0 && y !== N && !isRetire && age % 5 !== 0) continue;
    const s = sim.stats[y];
    const f = real ? sim.realFactor(y) : 1;
    const p = sim.principal[y] / f;
    const cell = function (v) {
      const cls = v < p && y > 0 ? ' class="neg"' : "";
      return "<td" + cls + ">" + comma(v) + "</td>";
    };
    body +=
      "<tr" +
      (isRetire ? ' class="retire-row"' : "") +
      ">" +
      "<td>" +
      age +
      "歳" +
      (isRetire ? "（取り崩し開始）" : "") +
      "</td>" +
      "<td>" +
      y +
      "年</td>" +
      "<td>" +
      comma(p) +
      "</td>" +
      cell(s.p05 / f) +
      cell(s.p25 / f) +
      cell(s.p50 / f) +
      cell(s.p75 / f) +
      cell(s.p95 / f) +
      "<td>" +
      (s.ruinRate > 0 ? pctText(s.ruinRate) : "—") +
      "</td></tr>";
  }
  $("dataTable").querySelector("thead").innerHTML = head;
  $("dataTable").querySelector("tbody").innerHTML = body;
  $("tableSub").textContent =
    "金額は万円（" +
    (real ? "実質・現在の物価" : "名目") +
    "）。赤字は「運用しなかった場合」を下回る水準です。";
}

/* ---------- 実行 ---------- */
function validate(cfg) {
  if (cfg.ageRetire < cfg.ageNow)
    return "「取り崩し開始」は現在の年齢以上にしてください。";
  if (cfg.ageEnd <= cfg.ageNow)
    return "「シミュレーション終了」は現在の年齢より後にしてください。";
  if (cfg.ageEnd - cfg.ageNow > 90)
    return "シミュレーション期間が長すぎます（90年以内にしてください）。";
  if (cfg.alloc[0] + cfg.alloc[1] + cfg.alloc[2] <= 0)
    return "資産配分を1つ以上入力してください。";
  if (!isValidCorrelation3(cfg.corr[0], cfg.corr[1], cfg.corr[2]))
    return "3つの相関係数の組み合わせが成立しません。値を調整してください。";
  return null;
}

const ALLOC_IDS = ["allocStock", "allocBond", "allocCash"];
const ALLOC_NAMES = ["株式", "債券", "現金"];

/* 配分の合計が100%でないときの注記。
   計算は合計で割って比率に直しているので結果は間違っていないが、
   そのままだと「105%ぶん投資した」と読めてしまうため、何を計算したかを書き出す */
function renderAllocNote(alloc, sum) {
  const off = sum > 0 && Math.abs(sum - 100) > 0.01;
  $("allocFix").hidden = !off;
  if (!off) {
    $("allocNotes").innerHTML = "";
    return;
  }
  const raw = [],
    norm = [];
  for (let i = 0; i < 3; i++) {
    raw.push(ALLOC_NAMES[i] + " " + Math.round(alloc[i] * 10) / 10);
    norm.push(ALLOC_NAMES[i] + " " + ((alloc[i] / sum) * 100).toFixed(1) + "%");
  }
  $("allocNotes").innerHTML =
    '<p class="hint alloc-note"><strong>合計が ' +
    Math.round(sum * 10) / 10 +
    "% です。</strong>" +
    raw.join(" : ") +
    " の比率とみなして計算しています（" +
    norm.join(" / ") +
    "）。</p>";
}

// 比率を保ったまま合計をちょうど100%にする
function normalizeAlloc() {
  const v = ALLOC_IDS.map(num);
  const sum = v[0] + v[1] + v[2];
  if (!(sum > 0)) return;
  // 0.1%刻みに丸め、丸めの端数は一番大きい資産に寄せて合計を100%ちょうどにする
  const p = v.map(function (x) {
    return Math.round((x / sum) * 1000) / 10;
  });
  let big = 0;
  for (let i = 1; i < 3; i++) if (p[i] > p[big]) big = i;
  p[big] = Math.round((p[big] + 100 - (p[0] + p[1] + p[2])) * 10) / 10;
  for (let i = 0; i < 3; i++) $(ALLOC_IDS[i]).value = String(p[i]);
  run();
}

/* 退職金の下の注意書き。効かない入力と、受け取る年にいくらとして扱うかを知らせる */
function renderLumpNote(cfg) {
  const notes = [];
  if (cfg.lumpSum > 0) {
    if (cfg.lumpAge < cfg.ageNow) {
      // すでに受け取っているなら「現在の運用資産」に含まれているはず
      notes.push([
        "ignored",
        "受け取る年齢（" +
          cfg.lumpAge +
          "歳）が現在の年齢より前のため、計算に影響しません。" +
          "受け取り済みの分は「現在の運用資産」に含めてください。",
      ]);
    } else if (cfg.lumpAge >= cfg.ageEnd) {
      notes.push([
        "ignored",
        "受け取る前にシミュレーションが終わる（" +
          cfg.ageEnd +
          "歳まで）ため、計算に影響しません。",
      ]);
    } else {
      // 名目と実質は長期では大きく食い違うので、選んでいない側の金額も必ず見せる
      const real = cfg.lumpBase === "real";
      const factor = Math.pow(
        1 + cfg.inflation / 100,
        cfg.lumpAge - cfg.ageNow,
      );
      const other = real ? cfg.lumpSum * factor : cfg.lumpSum / factor;
      let text =
        money(cfg.lumpSum) +
        (real ? "（現在の物価）" : "") +
        "を" +
        cfg.lumpAge +
        "歳の年初に受け取り、全額を課税口座で運用します。";
      if (Math.abs(other - cfg.lumpSum) / Math.max(1, cfg.lumpSum) > 0.005) {
        text +=
          "インフレ" +
          cfg.inflation +
          "%が続くと、" +
          (real
            ? "受け取る年の金額では " + money(other) + " になります。"
            : "現在の物価では " + money(other) + " の価値になります。");
      }
      notes.push(["info", text]);
    }
  }
  $("lumpNotes").innerHTML = notes
    .map(function (n) {
      return n[0] === "info"
        ? '<p class="hint">' + n[1] + "</p>"
        : '<p class="hint side-note ignored">' + n[1] + "</p>";
    })
    .join("");
}

/* 収入欄の下の注意書き。取り崩し期に効かない入力と、収入が途切れる期間を知らせる */
function renderIncomeNotes(cfg) {
  const notes = []; // [種類, 文言]
  if (cfg.wdMode === "fixed") {
    // 取り崩し開始より前の収入は年間積立額に含まれる前提のため、計算には使われない
    if (cfg.salary > 0 && cfg.salaryUntil <= cfg.ageRetire) {
      notes.push([
        "ignored",
        "給与などは取り崩し開始（" +
          cfg.ageRetire +
          "歳）より前に終わるため、計算に影響しません。",
      ]);
    }
    if (cfg.pension > 0 && cfg.pensionFrom >= cfg.ageEnd) {
      notes.push([
        "ignored",
        "年金などが始まる前にシミュレーションが終わる（" +
          cfg.ageEnd +
          "歳まで）ため、計算に影響しません。",
      ]);
    } else if (
      cfg.pension > 0 &&
      Math.max(cfg.pensionFrom, cfg.ageNow) < cfg.ageRetire
    ) {
      notes.push([
        "ignored",
        "年金などのうち" +
          Math.max(cfg.pensionFrom, cfg.ageNow) +
          "歳〜" +
          (cfg.ageRetire - 1) +
          "歳の分は、取り崩し開始（" +
          cfg.ageRetire +
          "歳）より前のため計算に影響しません。",
      ]);
    }

    // 取り崩し開始から年金が始まるまでの、収入が途切れる期間
    // （年金がない場合や、始まる前に終わる場合は「空白」ではないので知らせない）
    if (cfg.pension > 0 && cfg.pensionFrom < cfg.ageEnd) {
      let lo = null,
        hi = null;
      for (
        let age = cfg.ageRetire;
        age < cfg.ageEnd && age < cfg.pensionFrom;
        age++
      ) {
        if (incomeAt(cfg, age) > 0) {
          if (lo !== null) break;
          continue;
        }
        if (lo === null) lo = age;
        hi = age;
      }
      if (lo !== null) {
        notes.push([
          "gap",
          lo +
            "歳〜" +
            hi +
            "歳は収入がないため、生活費 " +
            money(cfg.withdraw) +
            "（現在の物価）の全額を資産から取り崩します。",
        ]);
      }
    }
  }
  $("incomeNotes").innerHTML = notes
    .map(function (n) {
      return (
        '<p class="hint side-note' +
        (n[0] === "ignored" ? " ignored" : "") +
        '">' +
        n[1] +
        "</p>"
      );
    })
    .join("");
}

function run() {
  const cfg = readConfig();
  state.view = $("viewMode").value;

  // 配分の合計とポートフォリオ全体の期待値を表示
  const sum = cfg.alloc[0] + cfg.alloc[1] + cfg.alloc[2];
  $("allocSum").textContent = Math.round(sum * 10) / 10;
  $("allocSum").className = Math.abs(sum - 100) > 0.01 ? "warn" : "";
  renderAllocNote(cfg.alloc, sum);
  if (isValidCorrelation3(cfg.corr[0], cfg.corr[1], cfg.corr[2])) {
    const ps = portfolioStats(cfg.alloc, cfg.ret, cfg.risk, cfg.corr);
    setNumEl($("portRet"), "portRet", ps.ret, "fixed2");
    setNumEl($("portRisk"), "portRisk", ps.risk, "fixed2");
  } else {
    $("portRet").textContent = "—";
    $("portRisk").textContent = "—";
  }

  // 方式に応じて入力欄を出し分け
  $("rowWithdraw").style.display = cfg.wdMode === "fixed" ? "" : "none";
  $("rowRate").style.display = cfg.wdMode === "rate" ? "" : "none";
  // 定率方式は残高の一定率を取り崩すので、収入は結果に影響しない
  $("incomeSection").style.display = cfg.wdMode === "fixed" ? "" : "none";
  $("rowNisaUsed").style.display = cfg.nisaOn ? "" : "none";
  $("legendPaths").style.display = $("showPaths").checked ? "" : "none";
  renderLumpNote(cfg);
  renderIncomeNotes(cfg);

  persistAndShare();

  const err = validate(cfg);
  const alertBox = $("alert");
  if (err) {
    alertBox.textContent = err;
    alertBox.style.display = "block";
    return;
  }
  alertBox.style.display = "none";

  const t0 = performance.now();
  state.cfg = cfg;
  state.sim = simulate(cfg);
  const ms = performance.now() - t0;

  syncRange(cfg, state.sim.years);
  $("fanSub").textContent = fanSubText();
  state.ms = ms;

  renderTiles();
  drawFan();
  drawRange();
  updateRangeUi();
  drawHist();
  renderTable();
}

function fanSubText() {
  const sim = state.sim,
    cfg = state.cfg,
    r = state.range;
  let s =
    comma(sim.trials) +
    "回の試行、" +
    cfg.ageNow +
    "歳から" +
    cfg.ageEnd +
    "歳まで" +
    sim.years +
    "年間。金額は" +
    (state.view === "real" ? "実質（現在の物価）" : "名目") +
    "。";
  if (r && !isFullRange())
    s +=
      "グラフは " +
      (cfg.ageNow + r.lo) +
      "歳〜" +
      (cfg.ageNow + r.hi) +
      "歳 を表示中。";
  return s;
}

let timer = null;
function scheduleRun() {
  clearTimeout(timer);
  timer = setTimeout(run, 180);
}

function redrawOnly() {
  if (!state.sim) return;
  drawFan();
  drawRange();
  updateRangeUi();
  drawHist();
}

window.addEventListener("DOMContentLoaded", function () {
  // 共有リンク、なければ前回の入力内容を復元してから計算する
  inputs.restore();

  // 入力の変更をすべて拾う。表示の切り替えだけなら再計算せず描き直す
  const VIEW_ONLY = { viewMode: 1, showPaths: 1 };
  function onFieldChange(e) {
    if (VIEW_ONLY[e.target.id] && state.sim) {
      state.view = $("viewMode").value;
      $("legendPaths").style.display = $("showPaths").checked ? "" : "none";
      renderTiles();
      renderTable();
      redrawOnly();
      persistAndShare();
      return;
    }
    scheduleRun();
  }
  /* 入力欄そのもの。上の inputs（保存・共有を引き受ける Inputs）と
	   紛らわしいので別の名前にしている */
  const fieldEls = document.querySelectorAll(".panel input, .panel select");
  for (let i = 0; i < fieldEls.length; i++) {
    fieldEls[i].addEventListener("input", onFieldChange);
    fieldEls[i].addEventListener("change", onFieldChange);
  }
  $("allYears").addEventListener("change", renderTable);
  $("allocFix").addEventListener("click", normalizeAlloc);

  $("resetBtn").addEventListener("click", function () {
    inputs.applyDefaults();
    inputs.clearSaved();
    try {
      // 共有リンクで開いていた場合、再読み込みで元の条件に戻らないようクエリを外す
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch (e) {
      /* file:// などで履歴を操作できない場合は何もしない */
    }
    run();
  });

  Share.init({ buildUrl: buildShareUrl });

  // canvas は CSS 変数の変更に追従しないので、テーマが変わったら描き直す
  // （テーマ切替・OS設定の変更・印刷前後のライト固定がすべてここに来る）
  Theme.onChange(redrawOnly);

  let rt = null;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(redrawOnly, 120);
  });

  setupHover();
  setupRange();
  run();
});
