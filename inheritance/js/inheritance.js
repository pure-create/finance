'use strict';

/* ---------- 状態 ---------- */
/* 入力の初期値。HTMLの value 属性と「入力をリセット」はこの表にそろえる。
   資産額は、配偶者の取得割合によって合計税額がはっきり動く額にしている
   （配偶者の税額軽減が効く一方、二次相続では基礎控除が減るため） */
/* 自宅の土地は初期値0（＝特例を使わない）にしてある。ここを0以外にすると、
   この項目を持たない既存の共有URLを開いたときに前と違う税額が出てしまうため */
const DEFAULTS = {
  me: 7000, sp: 3000, spouse: true, children: 1, delta: 0, years: 10,
  land: 0, area: 200, landFirst: 1, landSecond: 0,
};
const state = {
  hasSpouse: DEFAULTS.spouse,
  nChildren: DEFAULTS.children,
  spSharePct: 50,   // 一次相続で配偶者が取得する割合(%)
  userMoved: false, // スライダーを手動調整したか
};

/* 相続税の計算そのもの（totalTax / simulate）は js/inheritance-core.js にある。
   表示を持たない純粋な計算なので、テストから読み込めるよう分けてある */

/* ---------- ユーティリティ ---------- */
const $ = id => document.getElementById(id);
const fmt = v => Math.round(v).toLocaleString('ja-JP');
function statutoryPct() { return state.hasSpouse && state.nChildren > 0 ? 50 : 100; }
function getAssetMe() { return Math.max(0, +$('assetMe').value || 0); }
function getAssetSp() {
  const el = $('assetSp');
  return el ? Math.max(0, +el.value || 0) : 0;
}
function getDelta() { return +$('spDelta').value || 0; }
function getYears() { return Math.min(10, Math.max(0, Math.floor(+$('yearsGap').value || 0))); }
function getLandValue() { return Math.max(0, +$('landValue').value || 0); }
function getLandArea() { return Math.max(0, +$('landArea').value || 0); }

/* 特例を simulate へ渡す形にまとめる。
   一次相続は、配偶者がいれば自宅を配偶者が取得する前提なので無条件で適用できる
   （配偶者が取得する場合、同居などの要件は問われない）。配偶者がいないときだけ、
   子が要件を満たすかどうかをチェックで受け取る。 */
function getLand() {
  return {
    value: getLandValue(),
    area: getLandArea(),
    first: state.hasSpouse ? true : $('landFirst').checked,
    second: $('landSecond').checked,
  };
}

// 1億円以上の金額に「= ◯億◯万円」の補助表示
function okuText(v) {
  const a = Math.abs(v);
  if (a < 10000) return '';
  const oku = Math.floor(a / 10000), man = Math.round(a % 10000);
  return '= ' + (v < 0 ? '−' : '') + oku + '億' + (man ? fmt(man) + '万' : '') + '円';
}

/* ---------- 保存・共有 ---------- */
const LS_KEY = 'inheritanceSim.v1';
function collectState() {
  return {
    me: getAssetMe(), sp: getAssetSp(), s: state.hasSpouse ? 1 : 0,
    c: state.nChildren, pct: state.spSharePct, mv: state.userMoved ? 1 : 0,
    d: getDelta(), y: getYears(),
    lv: getLandValue(), la: getLandArea(),
    l1: $('landFirst').checked ? 1 : 0, l2: $('landSecond').checked ? 1 : 0,
  };
}
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(collectState())); } catch (e) {}
}
// 現在の入力内容を反映した共有URLを組み立てる
function buildShareUrl() {
  const params = new URLSearchParams();
  const s = collectState();
  for (const k in s) params.set(k, s[k]);
  return Share.urlWithParams(params);
}
// URLパラメータ優先、なければlocalStorage。stateへ反映し、入力欄用の値を返す
function loadState() {
  let src = null;
  const q = new URLSearchParams(location.search);
  if (q.has('me')) {
    src = {};
    /* 自宅の土地（lv/la/l1/l2）は後から足した項目。これらを持たない
       古い共有URLでは初期値（＝特例なし）のままになり、当時と同じ結果が出る */
    for (const k of ['me', 'sp', 's', 'c', 'pct', 'mv', 'd', 'y', 'lv', 'la', 'l1', 'l2']) {
      if (q.has(k)) src[k] = +q.get(k);
    }
  } else {
    try { src = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
  }
  if (!src || typeof src !== 'object') return null;
  if (src.s != null) state.hasSpouse = src.s !== 0;
  if (Number.isFinite(src.c)) state.nChildren = Math.min(6, Math.max(1, Math.round(src.c)));
  state.userMoved = src.mv === 1;
  if (state.userMoved && Number.isFinite(src.pct)) state.spSharePct = Math.min(100, Math.max(0, src.pct));
  return src;
}
/* ---------- 家族の図の描画 ---------- */
function renderFamily() {
  const slot = $('spouseSlot');
  if (state.hasSpouse) {
    const prev = getAssetSp() || DEFAULTS.sp;
    slot.innerHTML = `
      <div class="person sp">
        <button class="remove-btn" id="delSpouse" title="配偶者を削除" aria-label="配偶者を削除">×</button>
        <svg class="avatar" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="15" r="9"/><path d="M24 27c-10 0-16 6-16 14h32c0-8-6-14-16-14z"/></svg>
        <span class="plabel">配偶者</span>
        <span class="asset-in"><input type="number" id="assetSp" value="${prev}" min="0" step="100" inputmode="numeric" aria-label="配偶者の資産額（万円）"><span class="unit">万円</span></span>
        <span class="oku" id="okuSp"></span>
      </div>`;
    $('delSpouse').onclick = () => { state.hasSpouse = false; state.userMoved = false; renderFamily(); update(); };
    $('assetSp').oninput = update;
    $('marriageLine').style.visibility = 'visible';
  } else {
    slot.innerHTML = `
      <button class="add-spouse" id="addSpouse">
        <span class="plus" aria-hidden="true">＋</span><span>配偶者を追加</span>
      </button>`;
    $('addSpouse').onclick = () => { state.hasSpouse = true; state.userMoved = false; renderFamily(); update(); };
    $('marriageLine').style.visibility = 'hidden';
  }

  const row = $('childrenRow');
  let html = '';
  for (let i = 0; i < state.nChildren; i++) {
    html += `
      <div class="person child">
        ${state.nChildren > 1 ? `<button class="remove-btn" data-del-child title="子${i + 1}を削除" aria-label="子${i + 1}を削除">×</button>` : ''}
        <svg class="avatar" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="15" r="9"/><path d="M24 27c-10 0-16 6-16 14h32c0-8-6-14-16-14z"/></svg>
        <span class="plabel">子${state.nChildren > 1 ? i + 1 : ''}</span>
      </div>`;
  }
  if (state.nChildren < 6) {
    // 子が多いとき、ラベル込みだと折り返して崩れるため＋アイコンのみにする
    const compact = state.nChildren >= 4;
    // 追加ボタンと同幅のスペーサーで左右を釣り合わせ、子の中心を＝の真下に保つ
    html = `<span class="child-spacer" aria-hidden="true"></span>` + html
      + `<button class="add-child" id="addChild"${compact ? ' aria-label="子を追加" title="子を追加"' : ''}><span class="plus" aria-hidden="true">＋</span>${compact ? '' : '<span>子を追加</span>'}</button>`;
  }
  row.innerHTML = html;
  row.querySelectorAll('[data-del-child]').forEach(btn => {
    btn.onclick = () => { state.nChildren--; state.userMoved = false; renderFamily(); update(); };
  });
  const addBtn = $('addChild');
  if (addBtn) addBtn.onclick = () => { state.nChildren++; state.userMoved = false; renderFamily(); update(); };
  drawTree();
}

/* 婚姻線（＝）の真下から横線を渡し、各子へ縦線を落とす。実座標を測るので
   子の増減・「子を追加」ボタンによる位置ずれ・折り返しにも追従する */
function drawTree() {
  const fam = $('famBox'), svg = $('treeSvg');
  const fr = fam.getBoundingClientRect();
  if (!fr.width) return;
  svg.setAttribute('viewBox', `0 0 ${fr.width} ${fr.height}`);
  let ax, ay;
  if (state.hasSpouse) {
    const m = $('marriageLine').getBoundingClientRect();
    ax = m.left + m.width / 2 - fr.left;
    ay = m.top + 6 - fr.top; // ＝の下側の線のすぐ下
  } else {
    const me = fam.querySelector('.person.me').getBoundingClientRect();
    ax = me.left + me.width / 2 - fr.left;
    ay = me.bottom - fr.top;
  }
  const kids = [...fam.querySelectorAll('.person.child')].map(el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - fr.left, y: r.top - fr.top };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  kids.forEach(k => {
    const row = rows.find(r => Math.abs(r.y - k.y) < 8);
    if (row) row.kids.push(k); else rows.push({ y: k.y, kids: [k] });
  });
  let d = '', prevY = ay;
  rows.forEach((row, i) => {
    const busY = row.y - (i === 0 ? 14 : 9);
    d += `M${ax} ${prevY}V${busY}`;
    const xs = row.kids.map(k => k.x).concat(ax);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    if (maxX - minX > 0.5) d += `M${minX} ${busY}H${maxX}`;
    row.kids.forEach(k => { d += `M${k.x} ${busY}V${k.y}`; });
    prevY = busY;
  });
  svg.innerHTML = `<path d="${d}" stroke="${Theme.color('--axis')}" stroke-width="2" fill="none"/>`;
}
new ResizeObserver(() => drawTree()).observe(document.getElementById('famBox'));

/* ---------- グラフ ---------- */
let chart = null;
const markerPlugin = {
  id: 'marker',
  afterDatasetsDraw(c) {
    const { top, bottom } = c.chartArea;
    const ctx = c.ctx;

    // 合計が最小になる範囲（緑の帯）とラベル
    if (state.bestLo != null && !(state.bestLo === 0 && state.bestHi === 100)) {
      const xLo = c.scales.x.getPixelForValue(state.bestLo);
      const xHi = c.scales.x.getPixelForValue(state.bestHi);
      ctx.save();
      ctx.fillStyle = Theme.color('--inh-band');
      ctx.fillRect(xLo, top, Math.max(xHi - xLo, 2), bottom - top);
      ctx.strokeStyle = Theme.color('--inh-keep'); ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(xLo, top); ctx.lineTo(xLo, bottom); ctx.stroke();
      if (xHi - xLo > 2) { ctx.beginPath(); ctx.moveTo(xHi, top); ctx.lineTo(xHi, bottom); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = Theme.color('--inh-keep');
      ctx.font = '700 12px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const cx = Math.min(Math.max((xLo + xHi) / 2, c.chartArea.left + 40), c.chartArea.right - 40);
      ctx.fillText(`合計最小 ${state.bestText}`, cx, top + 4);
      ctx.restore();
    }

    // 現在のスライダー位置（オレンジの点線）
    const x = c.scales.x.getPixelForValue(state.spSharePct);
    ctx.save();
    ctx.strokeStyle = Theme.color('--warn'); ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.restore();
  }
};
// sweep: update()で計算済みの0〜100%のシミュレーション結果（null=グラフ非表示）
function renderChart(sweep) {
  const card = $('chartCard');
  if (!sweep || typeof Chart === 'undefined') { card.style.display = 'none'; return; }
  card.style.display = '';
  const labels = [], d1 = [], d2 = [], dg = [];
  for (let p = 0; p <= 100; p++) {
    labels.push(p); d1.push(sweep[p].first); d2.push(sweep[p].second); dg.push(sweep[p].grand);
  }
  // 色はすべてCSSトークンから取る。テーマが変わったら chart を作り直す（下の Theme.onChange）
  const cFirst = Theme.color('--inh-first');
  const cSecond = Theme.color('--inh-second');
  const cText = Theme.color('--text');
  const cSub = Theme.color('--text-sub');
  const cGrid = Theme.color('--grid');
  // 合計の線は、カードの地色で縁取りして他の線と重なっても追えるようにしている
  const cHalo = Theme.color('--surface');
  const data = {
    labels,
    datasets: [
      { label: '一次相続の税額', data: d1, borderColor: cFirst, backgroundColor: cFirst, borderWidth: 2, pointRadius: 0, tension: .15 },
      { label: '二次相続の税額', data: d2, borderColor: cSecond, backgroundColor: cSecond, borderWidth: 2, pointRadius: 0, tension: .15 },
      { label: '合計', data: dg, borderColor: cHalo, backgroundColor: cHalo, borderWidth: 7, pointRadius: 0, tension: .15, order: 1, _halo: true },
      { label: '合計', data: dg, borderColor: cText, backgroundColor: cText, borderWidth: 4, pointRadius: 0, tension: .15, order: 0 },
    ]
  };
  if (chart) { chart.data = data; chart.update('none'); return; }
  chart = new Chart($('chart'), {
    type: 'line',
    data,
    plugins: [markerPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: '配偶者の取得割合（％）', font: { size: 11 }, color: cSub },
          ticks: {
            font: { size: 11 }, autoSkip: false, maxRotation: 0, color: cSub,
            callback: v => v % 10 === 0 ? v + '%' : null,
          },
          grid: { display: false },
          border: { color: cGrid },
        },
        y: {
          title: { display: true, text: '税額（万円）', font: { size: 11 }, color: cSub },
          ticks: { font: { size: 11 }, color: cSub, callback: v => v.toLocaleString('ja-JP') },
          grid: { color: cGrid },
          border: { color: cGrid },
          beginAtZero: true,
        }
      },
      plugins: {
        legend: {
          labels: {
            font: { size: 12 }, boxWidth: 14, boxHeight: 3, color: cSub,
            filter: item => !data.datasets[item.datasetIndex]._halo,
          }
        },
        tooltip: {
          filter: item => !item.dataset._halo,
          callbacks: {
            title: items => `配偶者の取得割合 ${items[0].label}%`,
            label: item => `${item.dataset.label}: ${fmt(item.parsed.y)}万円`,
          },
          // Chart.js の既定は明暗によらず黒地。ページの吹き出し（.tipbox）と
          // 食い違うので、テーマのトークンで塗り直す。地色が面と同系になるぶん、
          // 折れ線に埋もれないよう枠線を添える
          backgroundColor: Theme.color('--tooltip-bg'),
          titleColor: Theme.color('--tooltip-text'),
          bodyColor: Theme.color('--tooltip-text'),
          borderColor: Theme.color('--tooltip-border'),
          borderWidth: 1,
        }
      }
    }
  });
}

/* 自宅の土地のカードの表示を、入力と家族構成に合わせて整える */
function updateLandCard(land, assetMe) {
  const on = land.value > 0;
  $('landUse').classList.toggle('off', !on);
  $('landArea').disabled = !on;
  $('landSecond').disabled = !on;

  /* 一次相続のチェックは、配偶者がいるときは選ぶ余地が無い（配偶者が取得すれば
     無条件で適用できる）。チェックを外せてしまうと、実際には起きない前提を
     選べることになるので、入れたまま操作できなくする */
  const firstEl = $('landFirst');
  firstEl.disabled = !on || state.hasSpouse;
  if (state.hasSpouse) firstEl.checked = true;
  $('landFirstLabel').textContent = state.hasSpouse
    ? '一次相続で適用する（配偶者が自宅を取得するため、要件を問わず適用）'
    : '一次相続で適用する（子が同居しているなど、要件を満たす場合）';

  // 限度面積を超えていれば、対象になるのは330㎡ぶんだけだと伝える
  const area = land.area;
  $('landAreaNote').textContent = (on && area > 330)
    ? `330㎡を超える部分は対象外です（評価額のうち ${Math.round(330 / area * 100)}% が80%減額）`
    : '330㎡までの部分が80%減額の対象です';

  // 入力の取り違え（自宅の土地だけを別に足してしまう）は結果が大きく狂うので気付かせる
  const note = $('landNote');
  if (on && land.value > assetMe) {
    note.className = 'assume-note warn';
    note.textContent = '自宅の土地の評価額が「自分の資産額」を超えています。自宅の土地は資産額に含めて入力してください';
  } else if (on && state.hasSpouse && !$('landSecond').checked) {
    note.className = 'assume-note';
    note.textContent = '二次相続では、配偶者が取得したぶんの自宅に特例を使えません。同居していない子が相続する場合はこのままにしてください';
  } else {
    note.className = 'assume-note';
    note.textContent = '';
  }
}

/* ---------- 画面更新 ---------- */
function update() {
  const assetMe = getAssetMe();
  const assetSp = getAssetSp();
  const spDelta = getDelta();
  const years = getYears();

  // 配偶者なし、または子がいない（＝分割の余地がない）ときはスライダー非表示
  const showSplit = state.hasSpouse && state.nChildren > 0;
  $('splitCard').style.display = showSplit ? '' : 'none';
  $('secondCard').style.display = state.hasSpouse ? '' : 'none';
  $('secondBox').style.display = state.hasSpouse ? '' : 'none';
  $('grandLabel').textContent = state.hasSpouse ? '一次＋二次の相続税合計' : '相続税の合計';
  $('yearsVal').textContent = years >= 10 ? '10年以上' : `${years}年`;

  if (!state.userMoved) state.spSharePct = statutoryPct();
  const pct = state.hasSpouse ? state.spSharePct : 0;
  $('spShare').value = pct;
  $('spShare').setAttribute('aria-valuetext', `配偶者${pct}%・子${100 - pct}%`);
  $('spShareVal').textContent = pct + '%';
  $('yearsGap').setAttribute('aria-valuetext', years >= 10 ? '10年以上' : `${years}年`);

  // 億換算の補助表示
  $('okuMe').textContent = okuText(getAssetMe());
  const okuSp = $('okuSp');
  if (okuSp) okuSp.textContent = okuText(getAssetSp());
  $('okuDelta').textContent = okuText(spDelta);
  $('okuLand').textContent = okuText(getLandValue());

  const land = getLand();
  updateLandCard(land, assetMe);

  const r = simulate(assetMe, assetSp, state.hasSpouse, state.nChildren, pct, spDelta, years, land);

  // 相次相続控除の適用可能性の表示
  // 配偶者に一次の税額が出るのは取得額が max(1.6億, 法定相続分) を超えるときだけ
  if (state.hasSpouse) {
    // 判定は特例で減額したあとの課税価格で見る（減額の結果1.6億円以下になることがある）
    const neverApplies = r.taxable1 <= 16000; // どの取得割合でも配偶者の税額は0
    $('yearsGap').disabled = neverApplies;
    $('yearsAssume').classList.toggle('off', neverApplies);
    if (neverApplies) {
      $('yearsNote').textContent = r.cut1 > 0
        ? '特例の適用後の課税価格が1.6億円以下の場合、一次相続で配偶者に税額が発生せず、相次相続控除は影響しません'
        : '遺産が1.6億円以下の場合、一次相続で配偶者に税額が発生せず、相次相続控除は影響しません';
    } else if (r.spTax < 1e-9) {
      const thPct = Math.floor(Math.max(16000, r.taxable1 / 2) / r.taxable1 * 100) + 1;
      $('yearsNote').textContent = `現在の取得割合では一次相続で配偶者に税額が発生しません（${thPct}%以上で相次相続控除が影響）`;
    } else {
      $('yearsNote').textContent = '10年未満の場合、相次相続控除（一次で配偶者が納めた税額の一部を二次で控除）を適用します';
    }
  }

  // 0〜100%を一括計算（最適割合ヒントとグラフで共用）
  let sweep = null;
  if (showSplit) {
    sweep = [];
    for (let p = 0; p <= 100; p++) sweep.push(simulate(assetMe, assetSp, true, state.nChildren, p, spDelta, years, land));
  }

  // 分割バー
  if (showSplit) {
    const spAmt = assetMe * pct / 100, chAmt = assetMe - spAmt;
    $('segSp').style.width = pct + '%';
    $('segCh').style.width = (100 - pct) + '%';
    $('segSp').textContent = pct >= 15 ? `配偶者 ${pct}%` : '';
    $('segCh').textContent = pct <= 85 ? `子 ${100 - pct}%` : '';
    $('legendSp').textContent = `配偶者 ${fmt(spAmt)}万円`;
    $('legendCh').innerHTML = `子 ${fmt(chAmt)}万円` + (state.nChildren > 1 ? `（1人あたり <b class="pc-num">${fmt(chAmt / state.nChildren)}万円</b>）` : '');

    // 合計が最小・最大になる割合（同額が続く場合は範囲で表示）
    const grands = sweep.map(x => x.grand);
    let bestV = Infinity, worstV = -Infinity;
    for (const v of grands) {
      if (v < bestV) bestV = v;
      if (v > worstV) worstV = v;
    }
    const EPS = 1e-6;
    let lo = 0; while (grands[lo] > bestV + EPS) lo++;
    let hi = lo; while (hi < 100 && grands[hi + 1] <= bestV + EPS) hi++;
    let rangeText, jumpP;
    if (lo === 0 && hi === 100) { rangeText = 'どの割合でも同額'; jumpP = statutoryPct(); }
    else if (lo === hi)   { rangeText = `${lo}%`;          jumpP = lo; }
    else if (lo === 0)    { rangeText = `${hi}%以下`;      jumpP = hi; }
    else if (hi === 100)  { rangeText = `${lo}%以上`;      jumpP = lo; }
    else                  { rangeText = `${lo}%〜${hi}%`;  jumpP = lo; }
    state.bestLo = lo; state.bestHi = hi; state.bestText = rangeText;

    let wLo = 0; while (grands[wLo] < worstV - EPS) wLo++;
    let wHi = wLo; while (wHi < 100 && grands[wHi + 1] >= worstV - EPS) wHi++;
    let worstRangeText;
    if (wLo === 0 && wHi === 100) worstRangeText = 'どの割合でも同額';
    else if (wLo === wHi)  worstRangeText = `${wLo}%`;
    else if (wLo === 0)    worstRangeText = `${wHi}%以下`;
    else if (wHi === 100)  worstRangeText = `${wLo}%以上`;
    else                   worstRangeText = `${wLo}%〜${wHi}%`;

    if (lo === 0 && hi === 100) {
      $('bestHint').innerHTML =
        `合計税額は配偶者の取得割合によらず <b>${fmt(bestV)}万円</b> です`;
    } else {
      $('bestHint').innerHTML =
        `<div class="hint-title">合計税額</div>` +
        `<span class="hint-item"><span class="tag min">最小</span><b>${fmt(bestV)}万円</b>（配偶者${rangeText}）</span>` +
        `<button id="jumpBest">この割合にする</button>` +
        `<span class="tilde">〜</span>` +
        `<span class="hint-item"><span class="tag max">最大</span><b>${fmt(worstV)}万円</b>（配偶者${worstRangeText}）</span>`;
      $('jumpBest').onclick = () => { state.spSharePct = jumpP; state.userMoved = true; update(); };
    }
  }

  // 一次相続の内訳
  const heirs1 = (state.hasSpouse ? 1 : 0) + state.nChildren;
  const ded1 = 3000 + 600 * heirs1;
  let h1 = `
    <div class="rline dim"><span>遺産総額</span><span class="v">${fmt(assetMe)}万円</span></div>`;
  if (r.cut1 > 0) {
    h1 += `<div class="rline dim"><span>小規模宅地等の特例</span><span class="v">−${fmt(r.cut1)}万円</span></div>`;
  }
  h1 += `<div class="rline dim"><span>基礎控除（法定相続人${heirs1}人）</span><span class="v">−${fmt(ded1)}万円</span></div>`;
  if (state.hasSpouse && state.nChildren > 0) {
    h1 += `
    <div class="rline"><span>配偶者の税額（軽減後）</span><span class="v">${fmt(r.spTax)}万円</span></div>
    <div class="rline"><span>子の税額 合計${state.nChildren > 1 ? `（1人 <b class="pc-num">${fmt(r.chTax1 / state.nChildren)}万円</b>）` : ''}</span><span class="v">${fmt(r.chTax1)}万円</span></div>`;
  } else if (state.hasSpouse) {
    h1 += `<div class="rline"><span>配偶者の税額（軽減後）</span><span class="v">${fmt(r.spTax)}万円</span></div>`;
  }
  h1 += `<div class="rline total"><span>一次相続の税額</span><span class="v">${fmt(r.first)}万円</span></div>`;
  if (r.taxable1 <= ded1) h1 += `<div class="zero-note">基礎控除以下のため相続税はかかりません</div>`;
  $('firstDetail').innerHTML = h1;

  // 二次相続の内訳
  if (state.hasSpouse) {
    const ded2 = 3000 + 600 * state.nChildren;
    let h2 = `
      <div class="rline dim"><span>配偶者の固有資産</span><span class="v">${fmt(assetSp)}万円</span></div>
      <div class="rline dim"><span>一次相続での取得額</span><span class="v">＋${fmt(r.spAcq)}万円</span></div>
      <div class="rline dim"><span>一次相続で納めた税額</span><span class="v">−${fmt(r.spTax)}万円</span></div>`;
    if (spDelta !== 0) {
      h2 += `<div class="rline dim"><span>二次相続までの資産増減</span><span class="v">${spDelta > 0 ? '＋' : '−'}${fmt(Math.abs(spDelta))}万円</span></div>`;
    }
    h2 += `<div class="rline"><span>二次相続の遺産額</span><span class="v">${fmt(r.estate2)}万円</span></div>`;
    if (r.cut2 > 0) {
      h2 += `<div class="rline dim"><span>小規模宅地等の特例</span><span class="v">−${fmt(r.cut2)}万円</span></div>`;
    }
    h2 += `<div class="rline dim"><span>基礎控除（法定相続人${state.nChildren}人）</span><span class="v">−${fmt(ded2)}万円</span></div>`;
    if (r.deduct > 0) {
      h2 += `<div class="rline"><span>相次相続控除（経過${years}年）</span><span class="v">−${fmt(r.deduct)}万円</span></div>`;
    }
    h2 += `<div class="rline total"><span>二次相続の税額${state.nChildren > 1 ? `（1人 <b class="pc-num">${fmt(r.second / state.nChildren)}万円</b>）` : ''}</span><span class="v">${fmt(r.second)}万円</span></div>`;
    if (r.taxable2 <= ded2) h2 += `<div class="zero-note">基礎控除以下のため相続税はかかりません</div>`;
    $('secondDetail').innerHTML = h2;
  }

  // 合計
  $('grandVal').innerHTML = `${fmt(r.grand)}<small>万円</small>`;

  // 最終的に残せる金額（税引後の子の手取り。資産増減も反映）
  const keepAmt = r.keep;
  $('keepLabel').textContent = state.hasSpouse
    ? '最終的に子に残せる金額（総資産＋資産増減−税額合計）'
    : '最終的に残せる金額（遺産総額−税額）';
  let keepHtml = `${fmt(keepAmt)}<small>万円</small>`;
  if (state.nChildren > 1) {
    keepHtml += `<span class="per-child">（1人あたり <b class="pc-num">${fmt(keepAmt / state.nChildren)}</b><small>万円</small>）</span>`;
  }
  $('keepVal').innerHTML = keepHtml;

  renderChart(sweep);
  if (chart && state.hasSpouse) chart.draw();
  Share.refreshQr();
  saveState();
}

/* ---------- イベント ---------- */
$('assetMe').oninput = update;
$('spDelta').oninput = update;
$('yearsGap').oninput = update;
$('landValue').oninput = update;
$('landArea').oninput = update;
$('landFirst').onchange = update;
$('landSecond').onchange = update;
$('spShare').oninput = e => {
  state.spSharePct = +e.target.value;
  state.userMoved = true;
  update();
};
$('resetBtn').onclick = () => { state.userMoved = false; update(); };

// 家族構成も含めてすべてを初期値に戻す
$('resetAllBtn').onclick = () => {
  state.hasSpouse = DEFAULTS.spouse;
  state.nChildren = DEFAULTS.children;
  state.userMoved = false;
  $('assetMe').value = DEFAULTS.me;
  $('spDelta').value = DEFAULTS.delta;
  $('yearsGap').value = DEFAULTS.years;
  $('landValue').value = DEFAULTS.land;
  $('landArea').value = DEFAULTS.area;
  $('landFirst').checked = DEFAULTS.landFirst === 1;
  $('landSecond').checked = DEFAULTS.landSecond === 1;
  renderFamily();
  // 配偶者の欄は renderFamily で作り直されるが、値は直前の入力を引き継ぐので明示的に戻す
  $('assetSp').value = DEFAULTS.sp;
  // 共有リンクで開いていた場合、再読み込みで元の条件に戻らないようクエリを外す
  try {
    if (history.replaceState) history.replaceState(null, '', location.pathname);
  } catch (e) { /* file:// などで履歴を操作できない場合は何もしない */ }
  update(); // 保存内容も初期値で上書きされる
};

Share.init({ buildUrl: buildShareUrl });

// グラフと家系図はCSS変数に自動では追従しないので、テーマが変わったら作り直す。
// Chart.js の scales / legend の色は生成時にしか設定されないため update() では足りない。
Theme.onChange(() => {
  if (chart) { chart.destroy(); chart = null; }
  drawTree();
  update();
});

/* ---------- 初期化 ---------- */
const saved = loadState();
renderFamily();
if (saved) {
  if (Number.isFinite(saved.me)) $('assetMe').value = saved.me;
  const spEl = $('assetSp');
  if (spEl && Number.isFinite(saved.sp)) spEl.value = saved.sp;
  if (Number.isFinite(saved.d)) $('spDelta').value = saved.d;
  if (Number.isFinite(saved.y)) $('yearsGap').value = Math.min(10, Math.max(0, saved.y));
  if (Number.isFinite(saved.lv)) $('landValue').value = Math.max(0, saved.lv);
  if (Number.isFinite(saved.la)) $('landArea').value = Math.max(0, saved.la);
  if (saved.l1 != null) $('landFirst').checked = saved.l1 !== 0;
  if (saved.l2 != null) $('landSecond').checked = saved.l2 !== 0;
}
update();
