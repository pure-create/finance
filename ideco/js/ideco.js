'use strict';

/* iDeCoシミュレーターの画面。計算は js/ideco-core.js と common/tax-core.js に任せる。
   税額の関数は Tax（common/tax-core.js が公開）をそのまま渡す */

/* 入力欄の一覧：[要素のid, 初期値, 共有URLでの短いキー]。
   保存・共有・「入力をリセット」はすべてこの表を元にする
   （資産運用シミュレーターと同じ作り） */
const FIELDS = [
	['category', 'employee', 'ct'], ['monthly', 23000, 'mo'], ['otherPlan', 0, 'op'],
	['nowAge', 40, 'na'], ['balance', 0, 'bl'], ['yieldRate', 3, 'yr'],
	['taxableIncome', 400, 'ti'],
	['joinAge', 40, 'ja'], ['payAge', 65, 'pa'], ['payMethod', 'lump', 'pm'],
	['retireAmount', 2000, 'ra'], ['hireAge', 22, 'ha'], ['retireAge', 60, 'rt'],
	['annuityYears', 10, 'ay'], ['publicPension', 180, 'pp']
];
const DEFAULTS = {};
for (let i = 0; i < FIELDS.length; i++) DEFAULTS[FIELDS[i][0]] = FIELDS[i][1];

const $ = id => document.getElementById(id);
const fmt = v => Math.round(v).toLocaleString('ja-JP');
// 円で計算した額を万円の表示にする
const man = v => fmt(v / 10000);
const num = id => { const v = parseFloat($(id).value); return isFinite(v) ? v : 0; };

// このツールが基準にする「今年」。拠出限度額の切り替えに使う
const THIS_YEAR = new Date().getFullYear();

/* ---------- 保存・共有 ---------- */
const STORAGE_KEY = 'idecoSim.v1';

function fieldValue(id) {
	const el = $(id);
	return el ? el.value : null;
}

function setField(id, v) {
	const el = $(id);
	if (el === null || v === null || v === undefined) return;
	let s = String(v);
	if (el.tagName === 'SELECT') {
		for (let i = 0; i < el.options.length; i++) {
			if (el.options[i].value === s) { el.value = s; return; }
		}
		return; // 選択肢にない値は無視して今の選択を保つ
	}
	if (el.type === 'number' || el.type === 'range') {
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
	if (el.type === 'number' || el.type === 'range') return parseFloat(el.value) === parseFloat(d);
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

function buildShareUrl() { return Share.urlWithParams(serializeState()); }

function saveState() {
	try {
		localStorage.setItem(STORAGE_KEY, serializeState().toString());
	} catch (e) {
		// プライベートブラウジング等で保存できない場合は何もしない
	}
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

// URLクエリ（共有リンク）優先、なければlocalStorageから復元する
function restoreState() {
	const q = new URLSearchParams(location.search);
	if (q.toString()) { applyStateFromParams(q); return; }
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) applyStateFromParams(new URLSearchParams(saved));
	} catch (e) {
		// 読み込めない場合は初期値のまま
	}
}

/* ---------- 入力の読み取り ---------- */

/* 画面は掛金を円、資産額を万円で受け取る。計算部分はすべて円で扱うので、
   ここで単位をそろえる */
function readConfig() {
	return {
		category: $('category').value,
		monthly: Math.round(num('monthly')),
		otherPlanMonthly: Math.round(num('otherPlan')),
		startAge: Math.round(num('nowAge')),
		startYear: THIS_YEAR,
		initialBalance: num('balance') * 10000,
		yieldRate: num('yieldRate'),
		taxableIncome: num('taxableIncome') * 10000,

		idecoJoinAge: Math.round(num('joinAge')),
		payAge: Math.round(num('payAge')),
		payMethod: $('payMethod').value,
		retireAmount: num('retireAmount') * 10000,
		hireAge: Math.round(num('hireAge')),
		retireAge: Math.round(num('retireAge')),
		annuityYears: Math.round(num('annuityYears')),
		publicPension: num('publicPension') * 10000
	};
}

// 出口の計算に渡す形（受取年齢だけ差し替えてグラフを描くので分けてある）
function payoutCfg(cfg, idecoAmount, payAge) {
	return {
		idecoAmount: idecoAmount,
		idecoJoinAge: cfg.idecoJoinAge,
		idecoPayAge: payAge,
		retireAmount: cfg.retireAmount,
		hireAge: cfg.hireAge,
		retireAge: cfg.retireAge,
		annuityYears: cfg.annuityYears,
		publicPension: cfg.publicPension
	};
}

/* ---------- グラフ ---------- */
let chart = null;

/* 手取りが最大になる受取年齢と、今の受取年齢に縦線を引く。
   相続シミュレーターの markerPlugin と同じ考え方。

   横軸は年齢の一覧（60〜75）を並べたカテゴリ軸なので、getPixelForValue に
   年齢をそのまま渡すと「何番目か」として解釈され、線が図の外に出てしまう。
   目盛の番号で位置を取る（相続のグラフは 0〜100 で番号と値が偶然一致していた） */
const tickX = (c, age) => c.scales.x.getPixelForTick(age - PAYOUT_AGE_MIN);

const markerPlugin = {
	id: 'marker',
	afterDatasetsDraw(c) {
		const { top, bottom } = c.chartArea;
		const ctx = c.ctx;
		if (state.bestAge != null) {
			const x = tickX(c, state.bestAge);
			ctx.save();
			ctx.strokeStyle = Theme.color('--idc-gain');
			ctx.lineWidth = 1.5;
			ctx.setLineDash([3, 3]);
			ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = Theme.color('--idc-gain');
			ctx.font = '700 12px sans-serif';
			ctx.textAlign = 'center'; ctx.textBaseline = 'top';
			const cx = Math.min(Math.max(x, c.chartArea.left + 44), c.chartArea.right - 44);
			ctx.fillText('手取り最大 ' + state.bestAge + '歳', cx, top + 4);
			ctx.restore();
		}
		const xNow = tickX(c, state.payAge);
		ctx.save();
		ctx.strokeStyle = Theme.color('--warn');
		ctx.lineWidth = 2;
		ctx.setLineDash([5, 4]);
		ctx.beginPath(); ctx.moveTo(xNow, top); ctx.lineTo(xNow, bottom); ctx.stroke();
		ctx.restore();
	}
};

function renderChart(sweep) {
	if (typeof Chart === 'undefined') { $('chartCard').style.display = 'none'; return; }
	const labels = sweep.map(s => s.age);
	const data = sweep.map(s => Math.round(s.net / 10000));

	const cOut = Theme.color('--idc-out');
	const cSub = Theme.color('--text-sub');
	const cGrid = Theme.color('--grid');

	const cfg = {
		labels: labels,
		datasets: [{
			label: '手取り合計',
			data: data,
			borderColor: cOut, backgroundColor: cOut,
			borderWidth: 3, pointRadius: 0, tension: .1
		}]
	};
	if (chart) { chart.data = cfg; chart.update('none'); return; }
	chart = new Chart($('chart'), {
		type: 'line',
		data: cfg,
		plugins: [markerPlugin],
		options: {
			responsive: true, maintainAspectRatio: false, animation: false,
			interaction: { mode: 'index', intersect: false },
			scales: {
				x: {
					title: { display: true, text: 'iDeCoを受け取る年齢', font: { size: 11 }, color: cSub },
					ticks: { font: { size: 11 }, color: cSub, callback: (v, i) => labels[i] + '歳' },
					grid: { display: false },
					border: { color: cGrid }
				},
				y: {
					title: { display: true, text: '手取り合計（万円）', font: { size: 11 }, color: cSub },
					ticks: { font: { size: 11 }, color: cSub, callback: v => v.toLocaleString('ja-JP') },
					grid: { color: cGrid },
					border: { color: cGrid }
				}
			},
			plugins: {
				legend: { display: false },
				tooltip: {
					callbacks: {
						title: items => items[0].label + '歳で受け取る',
						label: item => '手取り合計 ' + fmt(item.parsed.y) + '万円'
					},
					// Chart.js の既定は明暗によらず黒地。ページの吹き出しと合わせる
					backgroundColor: Theme.color('--tooltip-bg'),
					titleColor: Theme.color('--tooltip-text'),
					bodyColor: Theme.color('--tooltip-text'),
					borderColor: Theme.color('--tooltip-border'),
					borderWidth: 1
				}
			}
		}
	});
}

/* ---------- 画面更新 ---------- */
const state = { payAge: 65, bestAge: null };

function describeRule(lump) {
	/* 今の受取順で、どちらの控除がどれだけ削られるかを言葉で出す。
	   数字だけ見ても「なぜ減ったか」が分からないため */
	const box = $('ruleNote');
	if (!(lump.retire.amount > 0) && !lump.sameYear) {
		box.className = 'note rule-note safe';
		box.textContent = '退職金が無いので、iDeCoの加入年数（' + lump.idecoYears + '年）ぶんの退職所得控除をそのまま使えます。';
		return;
	}
	if (lump.sameYear) {
		box.className = 'note rule-note';
		box.innerHTML = '同じ年に両方を受け取るため、<b>合算して1回ぶんの退職所得控除</b>になります' +
			'（重なる' + lump.overlap + '年を除いた通算' +
			(lump.idecoYears + lump.retireYears - lump.overlap) + '年で計算）。';
		return;
	}
	if (lump.adjusted === 'ideco') {
		box.className = 'note rule-note';
		box.innerHTML = '退職金を先に受け取り、' + Math.abs(lump.gap) + '年後にiDeCoを受け取ります。' +
			'退職金が先の場合は<b>前年以前19年内</b>が対象なので、重なる' + lump.overlap +
			'年ぶん、<b>iDeCo側の控除が削られます</b>。19年より後にずらす必要がありますが、受給は75歳までです。';
		return;
	}
	if (lump.adjusted === 'retire') {
		/* 調整を外すにはiDeCoを「早める」必要がある（退職金より10年以上前にする）。
		   ただし受給は60歳からなので、退職金が70歳より前なら早めても届かない */
		const needAge = lump.retireAge - (OVERLAP_YEARS_IDECO_FIRST + 1);
		const escape = needAge >= PAYOUT_AGE_MIN
			? 'iDeCoの受け取りを<b>' + needAge + '歳まで早めれば</b>、10年以上空いて調整はなくなります。'
			: '調整を外すには退職金の10年以上前に受け取る必要がありますが、iDeCoの受給は' +
			  PAYOUT_AGE_MIN + '歳からなので、この退職年齢では避けられません。';
		box.className = 'note rule-note';
		box.innerHTML = 'iDeCoを先に受け取り、' + Math.abs(lump.gap) + '年後に退職金を受け取ります。' +
			'iDeCoが先の場合は<b>前年以前9年内</b>が対象なので、重なる' + lump.overlap +
			'年ぶん、<b>退職金側の控除が削られます</b>。' + escape;
		return;
	}
	box.className = 'note rule-note safe';
	box.innerHTML = 'iDeCoを先に受け取り、' + Math.abs(lump.gap) +
		'年後に退職金を受け取ります。10年以上空いているため<b>控除の調整はありません</b>。どちらも満額の退職所得控除を使えます。';
}

function update() {
	const cfg = readConfig();
	state.payAge = cfg.payAge;

	// 利回りの表示と、区分に応じた入力欄の出し入れ
	$('yieldVal').textContent = cfg.yieldRate.toFixed(1);
	const shared = ['employee', 'corporate', 'publicSv'].indexOf(cfg.category) >= 0;
	$('otherPlanField').style.display = shared ? '' : 'none';
	const isAnnuity = cfg.payMethod === 'annuity';
	$('annuityFields').style.display = '';

	// 拠出限度額（今年と改正後）
	const limitNow = contributionLimit(cfg.category, THIS_YEAR, cfg.otherPlanMonthly);
	const limitNext = contributionLimit(cfg.category, LIMIT_REFORM_YEAR, cfg.otherPlanMonthly);
	let limitHtml = '今年の上限 <b>' + fmt(limitNow) + '円/月</b>';
	if (limitNext !== limitNow) {
		limitHtml += '　→　2027年から <b class="reformed">' + fmt(limitNext) + '円/月</b>';
	}
	$('limitNote').innerHTML = limitHtml;

	const warn = $('limitWarn');
	if (cfg.monthly > limitNow && cfg.monthly <= limitNext) {
		warn.className = 'note warn';
		warn.textContent = '今の掛金は今年の上限（' + fmt(limitNow) + '円）を超えています。2027年からは出せる額ですが、それまでは上限までで計算します。';
	} else if (cfg.monthly > limitNext) {
		warn.className = 'note warn';
		warn.textContent = '今の掛金は改正後の上限（' + fmt(limitNext) + '円）も超えています。上限までで計算します。';
	} else {
		warn.className = 'note';
		warn.textContent = '';
	}

	// 積立（入口）
	const acc = accumulate({
		startAge: cfg.startAge, payAge: cfg.payAge, startYear: cfg.startYear,
		category: cfg.category, monthly: cfg.monthly, otherPlanMonthly: cfg.otherPlanMonthly,
		yieldRate: cfg.yieldRate, taxableIncome: cfg.taxableIncome,
		initialBalance: cfg.initialBalance
	}, Tax);

	const perYearSaving = acc.rows.length ? acc.rows[0].saving : 0;
	$('savingLine').innerHTML =
		'毎年 <b>' + man(perYearSaving) + '万円</b> の節税' +
		'<span class="sub">' + acc.rows.length + '年の拠出で累計 ' + man(acc.saved) + '万円</span>';

	/* 受け取る残高の内訳。節税額は掛金とは別に増える額ではなく、
	   払った掛金のうち税金が軽くなって戻ってくる分なので、
	   掛金を「実質の負担」と「節税で戻る分」に割って並べる。
	   4つを足すと、そのまま受け取る残高（＝出口の受取額）になる */
	const total = acc.balance;
	const pct = v => total > 0 ? (v / total * 100) : 0;
	$('segInitial').style.width = pct(cfg.initialBalance) + '%';
	$('segCost').style.width = pct(acc.netCost) + '%';
	$('segSave').style.width = pct(acc.saved) + '%';
	$('segGain').style.width = pct(acc.gain) + '%';

	const lgInitial = $('lgInitial');
	lgInitial.hidden = !(cfg.initialBalance > 0);
	lgInitial.textContent = '元の残高 ' + man(cfg.initialBalance) + '万円';
	$('lgCost').textContent = '実質の負担 ' + man(acc.netCost) + '万円';
	$('lgSave').textContent = '節税で戻る分 ' + man(acc.saved) + '万円';
	$('lgGain').textContent = '運用益 ' + man(acc.gain) + '万円';

	$('stackNote').innerHTML = acc.paid > 0
		? '払う掛金は' + acc.rows.length + '年で <b>' + man(acc.paid) + '万円</b> ですが、' +
		  'そのうち <b>' + man(acc.saved) + '万円</b> は税金が軽くなって戻るので、' +
		  '実質の負担は <b>' + man(acc.netCost) + '万円</b> です。' +
		  'これに運用益を足した <b>' + man(acc.balance) + '万円</b> を受け取ります。'
		: '';

	// 出口
	const idecoAmount = acc.balance;
	const cmp = compare(payoutCfg(cfg, idecoAmount, cfg.payAge), Tax);
	describeRule(cmp.lump);

	// 一時金の内訳
	const L = cmp.lump;
	let h = '<div class="rline dim"><span>iDeCoの受取額</span><span class="v">' + man(idecoAmount) + '万円</span></div>';
	if (L.sameYear) {
		h += '<div class="rline dim"><span>退職金と合算</span><span class="v">＋' + man(L.retire.amount) + '万円</span></div>' +
			'<div class="rline dim"><span>退職所得控除（通算）</span><span class="v">−' + man(L.combined.deduction) + '万円</span></div>' +
			'<div class="rline"><span>所得税・住民税</span><span class="v">' + man(L.tax) + '万円</span></div>';
	} else {
		h += '<div class="rline dim"><span>退職所得控除' + (L.adjusted === 'ideco' ? '（調整後）' : '') + '</span><span class="v">−' + man(L.ideco.deduction) + '万円</span></div>' +
			'<div class="rline"><span>iDeCoの税額</span><span class="v">' + man(L.ideco.tax + L.ideco.inhabitTax) + '万円</span></div>';
		if (L.retire.amount > 0) {
			h += '<div class="rline dim"><span>退職金の控除' + (L.adjusted === 'retire' ? '（調整後）' : '') + '</span><span class="v">−' + man(L.retire.deduction) + '万円</span></div>' +
				'<div class="rline"><span>退職金の税額</span><span class="v">' + man(L.retire.tax + L.retire.inhabitTax) + '万円</span></div>';
		}
	}
	h += '<div class="rline total"><span>手取り合計</span><span class="v">' + man(L.net) + '万円</span></div>';
	if (L.tax === 0) h += '<div class="zero-note">控除の範囲に収まるため非課税です</div>';
	$('lumpDetail').innerHTML = h;

	// 年金の内訳
	const A = cmp.annuity;
	const d = A.detail;
	let h2 = '<div class="rline dim"><span>1年あたりの受取額</span><span class="v">' + man(d.perYear) + '万円 × ' + d.years + '年</span></div>' +
		'<div class="rline dim"><span>増える雑所得（年）</span><span class="v">' + man(d.rows.length ? d.rows[0].misc : 0) + '万円</span></div>' +
		'<div class="rline"><span>iDeCoの税額（' + d.years + '年の合計）</span><span class="v">' + man(d.tax) + '万円</span></div>';
	if (cfg.retireAmount > 0) {
		h2 += '<div class="rline"><span>退職金の税額</span><span class="v">' + man(A.tax - d.tax) + '万円</span></div>';
	}
	h2 += '<div class="rline total"><span>手取り合計</span><span class="v">' + man(A.net) + '万円</span></div>';
	if (d.tax === 0) h2 += '<div class="zero-note">公的年金等控除の範囲に収まるため非課税です</div>';
	$('annuityDetail').innerHTML = h2;

	// 選んでいるほうを立て、選んでいないほうは沈める
	$('lumpBox').classList.toggle('dim', isAnnuity);
	$('annuityBox').classList.toggle('dim', !isAnnuity);

	const chosen = isAnnuity ? A : L;
	$('grandLabel').textContent = isAnnuity
		? '年金で受け取ったときの手取り合計'
		: '一時金で受け取ったときの手取り合計';
	$('grandVal').innerHTML = man(chosen.net) + '<small>万円</small>';
	/* 受け取る額と、拠出の途中で軽くなった税金の合計。
	   掛金そのものは自分で出しているので「得」ではない（節税分だけが得）。
	   足し合わせた額に「得」と名前を付けないよう、ラベルは事実だけを書く */
	$('totalVal').innerHTML = man(chosen.net + acc.saved) + '<small>万円</small>';

	// グラフ：受取年齢を60〜75歳で振る
	const sweep = [];
	for (let age = PAYOUT_AGE_MIN; age <= PAYOUT_AGE_MAX; age++) {
		// その年齢まで積み立てたときの残高で計算する（長く置けば残高も増える）
		const a = accumulate({
			startAge: cfg.startAge, payAge: age, startYear: cfg.startYear,
			category: cfg.category, monthly: cfg.monthly, otherPlanMonthly: cfg.otherPlanMonthly,
			yieldRate: cfg.yieldRate, taxableIncome: cfg.taxableIncome,
			initialBalance: cfg.initialBalance
		}, Tax);
		const c = compare(payoutCfg(cfg, a.balance, age), Tax);
		const picked = isAnnuity ? c.annuity : c.lump;
		sweep.push({ age: age, net: picked.net + a.saved });
	}
	let best = -Infinity, bestAge = null;
	for (const s of sweep) if (s.net > best) { best = s.net; bestAge = s.age; }
	state.bestAge = bestAge;
	$('chartNote').textContent =
		'受け取る年齢を遅らせると運用期間と拠出期間が延びる一方、退職金との間隔が変わって控除の調整も動きます。' +
		'手取りと節税額を合わせた額では ' + bestAge + '歳 が最大（' + man(best) + '万円）です。';
	renderChart(sweep);
	if (chart) chart.draw();

	Share.refreshQr();
	saveState();
}

/* ---------- イベント ---------- */
for (let i = 0; i < FIELDS.length; i++) {
	const el = $(FIELDS[i][0]);
	if (!el) continue;
	el.addEventListener('input', update);
	el.addEventListener('change', update);
}

$('resetAllBtn').onclick = () => {
	applyDefaults();
	// 共有リンクで開いていた場合、再読み込みで元の条件に戻らないようクエリを外す
	try {
		if (history.replaceState) history.replaceState(null, '', location.pathname);
	} catch (e) { /* file:// などで履歴を操作できない場合は何もしない */ }
	update();
};

Share.init({ buildUrl: buildShareUrl });

/* グラフはCSS変数に自動では追従しないので、テーマが変わったら作り直す。
   Chart.js の scales / legend の色は生成時にしか設定されないため update() では足りない */
Theme.onChange(() => {
	if (chart) { chart.destroy(); chart = null; }
	update();
});

restoreState();
update();
