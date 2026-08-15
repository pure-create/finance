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
	['joinAge', 40, 'ja'], ['payAge', 65, 'pa'],
	['retireAmount', 2000, 'ra'], ['hireAge', 22, 'ha'], ['retireAge', 60, 'rt'],
	['annuityYears', 10, 'ay'], ['publicPension', 180, 'pp'], ['publicPensionAge', 65, 'ps']
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
		retireAmount: num('retireAmount') * 10000,
		hireAge: Math.round(num('hireAge')),
		retireAge: Math.round(num('retireAge')),
		annuityYears: Math.round(num('annuityYears')),
		publicPension: num('publicPension') * 10000,
		publicPensionStartAge: Math.round(num('publicPensionAge'))
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
		publicPension: cfg.publicPension,
		publicPensionStartAge: cfg.publicPensionStartAge,
		// 年金受取では残りの資産が運用を続けるので、利回りが出口にも効く
		yieldRate: cfg.yieldRate
	};
}

/* ---------- グラフ ---------- */
let chart = null;

/* 手取りが最大になる受取年齢と、今の受取年齢に縦線を引く。
   相続シミュレーターの markerPlugin と同じ考え方。

   横軸は年齢の一覧（60〜75）を並べたカテゴリ軸なので、getPixelForValue に
   年齢をそのまま渡すと「何番目か」として解釈され、線が図の外に出てしまう。
   目盛の番号で位置を取る（相続のグラフは 0〜100 で番号と値が偶然一致していた） */
const tickX = (c, age) => c.scales.x.getPixelForTick(age - state.chartFrom);

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
			ctx.fillText('税金が最も少ない ' + state.bestAge + '歳', cx, top + 4);
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
	const cOut = Theme.color('--idc-out');   // 一時金（結果の欄と同じ色）
	const cIn = Theme.color('--idc-in');     // 年金
	const cSub = Theme.color('--text-sub');
	const cGrid = Theme.color('--grid');

	const cfg = {
		labels: labels,
		datasets: [
			{
				label: '一時金',
				data: sweep.map(s => Math.round(s.lump / 10000)),
				borderColor: cOut, backgroundColor: cOut,
				borderWidth: 3, pointRadius: 0, tension: .1
			},
			{
				label: '年金',
				data: sweep.map(s => Math.round(s.annuity / 10000)),
				borderColor: cIn, backgroundColor: cIn,
				borderWidth: 3, pointRadius: 0, tension: .1
			}
		]
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
					title: { display: true, text: 'iDeCoによって増える税金（万円）', font: { size: 11 }, color: cSub },
					ticks: { font: { size: 11 }, color: cSub, callback: v => v.toLocaleString('ja-JP') },
					grid: { color: cGrid },
					border: { color: cGrid }
				}
			},
			plugins: {
				legend: {
					labels: { font: { size: 12 }, boxWidth: 14, boxHeight: 3, color: cSub }
				},
				tooltip: {
					callbacks: {
						title: items => items[0].label + '歳で受け取る',
						label: item => item.dataset.label + '：' + fmt(item.parsed.y) + '万円'
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
const state = { payAge: 65, bestAge: null, chartFrom: PAYOUT_AGE_MIN };

function describeRule(lump) {
	/* 今の受取順で、どちらの控除がどれだけ削られるかを言葉で出す。
	   数字だけ見ても「なぜ減ったか」が分からないため */
	const box = $('ruleNote');
	if (!(lump.retire.amount > 0) && !lump.sameYear) {
		box.className = 'note rule-note safe';
		box.textContent = '退職金が無いので、iDeCoの加入年数（' + lump.idecoYears + '年）分の退職所得控除をそのまま使えます。';
		return;
	}
	if (lump.sameYear) {
		box.className = 'note rule-note';
		box.innerHTML = '同じ年に両方を受け取るため、<b>合算して1回分の退職所得控除</b>になります' +
			'（重なる' + lump.overlap + '年を除いた通算' +
			(lump.idecoYears + lump.retireYears - lump.overlap) + '年で計算）。';
		return;
	}
	if (lump.adjusted === 'ideco') {
		/* 調整を外すにはiDeCoを「遅らせる」必要がある（退職金より20年以上後にする）。
		   ただし受給は75歳までなので、退職金が55歳より後ならどう遅らせても届かない。
		   何のためにずらすのかを先に書く（ずらす動機が分からないと意味が通らない） */
		const needAge = lump.retireAge + OVERLAP_YEARS_RETIRE_FIRST + 1;
		const escape = needAge <= PAYOUT_AGE_MAX
			? '削られた控除を満額に戻すには、iDeCoの受け取りを<b>' + needAge + '歳まで遅らせる</b>必要があります。'
			: '削られた控除を満額に戻すには、iDeCoの受け取りを' + needAge +
			  '歳まで遅らせる必要がありますが、受給は' + PAYOUT_AGE_MAX +
			  '歳までなので、この退職年齢では避けられません。年金で受け取れば退職所得控除を使わないので、この調整も起きません。';
		box.className = 'note rule-note';
		box.innerHTML = '退職金を先に受け取り、' + Math.abs(lump.gap) + '年後にiDeCoを受け取ります。' +
			'退職金が先の場合は<b>前年以前19年内</b>が対象なので、重なる' + lump.overlap +
			'年分、<b>iDeCo側の控除が削られます</b>。' + escape;
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
			'年分、<b>退職金側の控除が削られます</b>。' + escape;
		return;
	}
	/* 調整が起きない場合。どちらが先かで、必要な間隔（10年／20年）も
	   文の主語も変わるので、gap の向きで書き分ける */
	const apart = Math.abs(lump.gap);
	box.className = 'note rule-note safe';
	box.innerHTML = lump.gap > 0
		? '退職金を先に受け取り、' + apart + '年後にiDeCoを受け取ります。' +
		  '退職金が先の場合に対象となる' + OVERLAP_YEARS_RETIRE_FIRST + '年より後なので、' +
		  '<b>控除の調整はありません</b>。どちらも満額の退職所得控除を使えます。'
		: 'iDeCoを先に受け取り、' + apart + '年後に退職金を受け取ります。' +
		  'iDeCoが先の場合に対象となる' + OVERLAP_YEARS_IDECO_FIRST + '年より後なので、' +
		  '<b>控除の調整はありません</b>。どちらも満額の退職所得控除を使えます。';
}

function update() {
	const cfg = readConfig();
	state.payAge = cfg.payAge;

	// 利回りの表示と、区分に応じた入力欄の出し入れ
	$('yieldVal').textContent = cfg.yieldRate.toFixed(1);
	const shared = ['employee', 'corporate', 'publicSv'].indexOf(cfg.category) >= 0;
	$('otherPlanField').style.display = shared ? '' : 'none';

	/* 加入した年齢は、これから拠出を始める「現在の年齢」より後には置けない。
	   積立は現在の年齢から始まるので、後ろに置くと積立期間はそのままで
	   退職所得控除の年数だけが短くなり、食い違ったまま計算されてしまう。
	   受給開始年齢もこの値から決まるので、下の判定より前に直しておく */
	const joinAgeEl = $('joinAge');
	joinAgeEl.max = String(cfg.startAge);
	const joinWarn = $('joinAgeWarn');
	if (cfg.idecoJoinAge > cfg.startAge) {
		joinWarn.className = 'note warn';
		joinWarn.textContent = '加入した年齢は現在の年齢（' + cfg.startAge +
			'歳）より後にはできません。' + cfg.startAge + '歳から加入するものとして計算しています。';
		cfg.idecoJoinAge = cfg.startAge;
	} else {
		joinWarn.className = 'note';
		joinWarn.textContent = '';
	}

	/* 受給を始められる年齢は、加入した年齢（＝通算加入者等期間）で決まる。
	   入力欄の下限をその場で動かし、下回っていれば知らせたうえで、
	   計算は受け取れる最も早い年齢に寄せる（選べない条件の数字を出さない） */
	const earliest = earliestPayoutAge(cfg.idecoJoinAge);
	const payAgeEl = $('payAge');
	payAgeEl.min = String(earliest);
	const payWarn = $('payAgeWarn');
	if (cfg.payAge < earliest) {
		const years = Math.max(0, LATE_JOIN_AGE - cfg.idecoJoinAge);
		payWarn.className = 'note warn';
		payWarn.textContent = cfg.idecoJoinAge >= LATE_JOIN_AGE
			? LATE_JOIN_AGE + '歳以降に加入した場合、受け取れるのは加入から' + LATE_JOIN_WAIT +
			  '年後の' + earliest + '歳からです。' + earliest + '歳で受け取るものとして計算しています。'
			: cfg.idecoJoinAge + '歳加入だと' + LATE_JOIN_AGE + '歳時点の通算加入者等期間が' + years +
			  '年で、受け取れるのは' + earliest + '歳からです。' + earliest + '歳で受け取るものとして計算しています。';
		cfg.payAge = earliest;
	} else {
		payWarn.className = 'note';
		payWarn.textContent = '';
	}
	state.payAge = cfg.payAge;

	/* 拠出限度額（今年と改正後）。第1号・第3号は60歳で国民年金の被保険者で
	   なくなり枠が変わるので、その年に何歳かも渡す */
	const ageIn = year => cfg.startAge + (year - THIS_YEAR);
	const limitNow = contributionLimit(cfg.category, THIS_YEAR, cfg.otherPlanMonthly, ageIn(THIS_YEAR));
	const limitNext = contributionLimit(cfg.category, LIMIT_REFORM_YEAR, cfg.otherPlanMonthly, ageIn(LIMIT_REFORM_YEAR));
	let limitHtml = limitNow > 0 ? '今年の上限 <b>' + fmt(limitNow) + '円/月</b>' : '今年は拠出できません';
	if (limitNext !== limitNow) {
		limitHtml += '　→　2027年から <b class="reformed">' + fmt(limitNext) + '円/月</b>';
	}
	$('limitNote').innerHTML = limitHtml;

	/* 断りは重なることがある（60歳以降の枠の話と、掛金が上限を超えている話）。
	   集めてから並べる */
	const warns = [];
	const endsAt60 = CONTRIBUTION_LIMITS[cfg.category].endsAt60;
	if (endsAt60 && limitNow === 0) {
		warns.push('第1号・第3号被保険者は60歳未満までなので、今年は拠出できません。' +
			LIMIT_REFORM_YEAR + '年からは60歳以上70歳未満でも「第5号加入者」として月' +
			fmt(LATE_JOIN_CATEGORY_LIMIT) + '円まで拠出できます。');
	} else if (endsAt60 && cfg.startAge < NATIONAL_PENSION_END_AGE && cfg.payAge > NATIONAL_PENSION_END_AGE) {
		warns.push('第1号・第3号被保険者は60歳未満までです。60歳以降は「第5号加入者」として月' +
			fmt(LATE_JOIN_CATEGORY_LIMIT) + '円までの枠で計算します。');
	}
	// 拠出できない年（上限0）は、その理由を上で断っているので重ねて言わない
	if (limitNow > 0 && cfg.monthly > limitNow && cfg.monthly <= limitNext) {
		warns.push('今の掛金は今年の上限（' + fmt(limitNow) + '円）を超えています。' +
			LIMIT_REFORM_YEAR + '年からは出せる額ですが、それまでは上限までで計算します。');
	} else if (cfg.monthly > limitNext && limitNext > 0) {
		warns.push('今の掛金は改正後の上限（' + fmt(limitNext) + '円）も超えています。上限までで計算します。');
	}
	const warn = $('limitWarn');
	warn.className = warns.length ? 'note warn' : 'note';
	warn.textContent = warns.join('');

	/* 老齢年金の受給開始年齢。入力する見込額は65歳時点の額なので、
	   繰上げ・繰下げで実際にいくらになるかを添える（65歳なら増減はない） */
	const pensionNote = $('pensionAgeNote');
	const pRate = publicPensionRate(cfg.publicPensionStartAge);
	if (cfg.publicPension > 0 && pRate !== 1) {
		const pct = Math.round(Math.abs(pRate - 1) * 1000) / 10;
		pensionNote.innerHTML = cfg.publicPensionStartAge + '歳からなら <b>' +
			man(cfg.publicPension * pRate) + '万円/年</b>（' +
			(pRate > 1 ? pct + '%増' : pct + '%減') + '）';
	} else {
		pensionNote.innerHTML = '';
	}

	// 積立（入口）
	const acc = accumulate({
		startAge: cfg.startAge, payAge: cfg.payAge, startYear: cfg.startYear,
		category: cfg.category, monthly: cfg.monthly, otherPlanMonthly: cfg.otherPlanMonthly,
		yieldRate: cfg.yieldRate, taxableIncome: cfg.taxableIncome,
		initialBalance: cfg.initialBalance
	}, Tax);

	/* 節税額。判断に効くのは毎年の額より累計なので、累計を主役に出す。
	   拠出できる年が無い（受取年齢まで年数がない）ときや課税所得が無いときは
	   どちらも0になるので、額を並べず一言で済ませる */
	const perYearSaving = acc.rows.length ? acc.rows[0].saving : 0;
	$('savingLine').innerHTML = acc.saved > 0
		? '毎年 <b>' + man(perYearSaving) + '万円</b> の節税（' + acc.rows.length +
		  '年の拠出で累計 <b class="total">' + man(acc.saved) + '万円</b>）'
		: 'この条件では、掛金による節税はありません。';

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

	const hasInitial = cfg.initialBalance > 0;
	const lgInitial = $('lgInitial');
	lgInitial.hidden = !hasInitial;
	lgInitial.textContent = '今ある残高 ' + man(cfg.initialBalance) + '万円';
	$('lgCost').textContent = '実質の負担 ' + man(acc.netCost) + '万円';
	$('lgSave').textContent = '節税で戻る分 ' + man(acc.saved) + '万円';
	$('lgGain').textContent = '運用益 ' + man(acc.gain) + '万円';

	/* 「実質の負担」と「節税で戻る分」は、これから拠出する分だけの話。
	   すでにある残高は中身を分けずにそのまま置くので、
	   どこまでが「これから」なのかが読み取れるように書き分ける */
	const note = $('stackNote');
	if (acc.paid > 0 && hasInitial) {
		note.innerHTML = 'これから払う掛金は' + acc.rows.length + '年で <b>' + man(acc.paid) +
			'万円</b>、うち <b>' + man(acc.saved) + '万円</b> は税金が軽くなって戻るので、' +
			'実質の負担は <b>' + man(acc.netCost) + '万円</b> です。' +
			'今ある残高 <b>' + man(cfg.initialBalance) + '万円</b> と運用益を合わせて <b>' +
			man(acc.balance) + '万円</b> を受け取ります。';
	} else if (acc.paid > 0) {
		note.innerHTML = '払う掛金は' + acc.rows.length + '年で <b>' + man(acc.paid) +
			'万円</b> ですが、そのうち <b>' + man(acc.saved) + '万円</b> は税金が軽くなって戻るので、' +
			'実質の負担は <b>' + man(acc.netCost) + '万円</b> です。' +
			'これに運用益を足した <b>' + man(acc.balance) + '万円</b> を受け取ります。';
	} else if (hasInitial) {
		// 拠出が終わっている（受取年齢まで運用するだけ）場合
		note.innerHTML = '今ある残高 <b>' + man(cfg.initialBalance) + '万円</b> を運用して、' +
			'<b>' + man(acc.balance) + '万円</b> を受け取ります。';
	} else {
		note.innerHTML = '';
	}

	// 出口
	const idecoAmount = acc.balance;
	const cmp = compare(payoutCfg(cfg, idecoAmount, cfg.payAge), Tax);
	describeRule(cmp.lump);

	/* 受け取り方ごとの内訳。

	   退職金の税額は受け取り方で変わる（一時金だと控除が調整されうるが、
	   年金なら退職所得控除を使わないので調整が起きない）ので、両方の欄に
	   退職金を出す必要がある。ただし合計だけを出すと、iDeCoの話をしている欄に
	   退職金がまぎれて読み取れないので、それぞれの手取りを小計で分ける */
	const rline = (label, value, cls) =>
		'<div class="rline ' + (cls || '') + '"><span>' + label + '</span><span class="v">' + value + '</span></div>';
	const yen = v => man(v) + '万円';

	/* 「iDeCoをやらなかった場合」との差。同じ年に受け取ると税額を按分できないが、
	   この差なら出せる。退職金側の控除が削られた分も、原因はiDeCoなのでここに乗る。
	   加入期間が勤続期間より長いと控除が増えて税額が下がることもあるので、
	   増減の向きで文を変える */
	function diffNote(r, lead) {
		if (!(r.retire.amount > 0)) return '';
		const base = 'iDeCoを受け取らなければ、退職金にかかる税額は <b>' + yen(r.taxWithoutIdeco) + '</b> でした。';
		// 減る場合は直感に反するので、理由を添える（金額は上の行に出ている）
		const why = r.taxByIdeco < -5000
			? '加入期間のぶん通算の勤続年数が延び、退職所得控除がむしろ大きくなるためです。'
			: '';
		return '<div class="split-note">' + lead + base + why + '</div>';
	}

	/* 各欄の最後に置く、受け取り方を比べるための行。
	   退職金があると、退職金側の控除が削られた分もiDeCoが原因なので
	   「増えた税金」で見る。退職金が無ければiDeCoの税額そのもの。
	   加入期間が勤続期間より長いと減ることもあるので、向きで文と色を変える */
	function idecoTaxRow(amount) {
		const down = amount < -5000;
		const label = !hasRetire ? 'iDeCoの税金'
			: (down ? 'iDeCoで減った税金' : 'iDeCoで増えた税金');
		return rline(label, yen(Math.abs(amount)), 'headline' + (down ? ' down' : ''));
	}

	// 退職金の欄。手取りを返し、行はそのまま h に足す
	function retireLines(amount, deduction, taxAmount, adjusted) {
		return rline('退職金', yen(amount), 'dim') +
			rline('退職所得控除' + (adjusted ? '（調整後）' : ''), '−' + yen(deduction), 'dim') +
			rline('税額', '−' + yen(taxAmount), 'dim') +
			rline('退職金の手取り', yen(amount - taxAmount), 'sub');
	}

	// 一時金の内訳
	const L = cmp.lump;
	const hasRetire = L.retire.amount > 0;
	let h = '';
	if (L.sameYear) {
		/* 同じ年に受け取ると1つの退職所得に合算されるので、
		   iDeCo分と退職金分に税額を割り振れない。分けずに出す */
		h = rline('iDeCoの受取額', yen(idecoAmount), 'dim') +
			rline('退職金', '＋' + yen(L.retire.amount), 'dim') +
			rline('退職所得控除（通算）', '−' + yen(L.combined.deduction), 'dim') +
			rline('税額', '−' + yen(L.tax), 'dim') +
			rline('手取り合計', yen(L.net), 'total');
	} else {
		const idecoTax = L.ideco.tax + L.ideco.inhabitTax;
		h = rline('iDeCoの受取額', yen(idecoAmount), 'dim') +
			rline('退職所得控除' + (L.adjusted === 'ideco' ? '（調整後）' : ''), '−' + yen(L.ideco.deduction), 'dim') +
			rline('税額', '−' + yen(idecoTax), 'dim') +
			rline('iDeCoの手取り', yen(idecoAmount - idecoTax), hasRetire ? 'sub' : 'total');
		if (hasRetire) {
			h += retireLines(L.retire.amount, L.retire.deduction,
				L.retire.tax + L.retire.inhabitTax, L.adjusted === 'retire');
			h += rline('合計', yen(L.net), 'total');
		}
	}
	h += idecoTaxRow(L.taxByIdeco);
	/* 加入5年以下は短期退職手当等になり、控除を引いた残りのうち300万円を
	   超える部分が半分にならない。税額だけでは急に増えた理由が読み取れない */
	if (L.shortTenure) {
		h += '<div class="split-note">' +
			(L.sameYear ? '合算した勤続年数が' : '加入期間が') + L.shortTenureYears +
			'年しかないため<b>短期退職手当等</b>にあたり、' +
			'退職所得控除を引いた残りのうち' + man(Tax.SHORT_TENURE_HALF_LIMIT) +
			'万円を超える部分は半分になりません。</div>';
	}
	if (L.tax === 0) h += '<div class="zero-note">控除の範囲に収まるため非課税です</div>';
	if (hasRetire) {
		h += diffNote(L, L.sameYear
			? '同じ年に受け取るため、iDeCoと退職金は合算して1つの退職所得になります。'
			  + '税額をどちらの分か割り振ることはできませんが、'
			: '');
	}
	$('lumpDetail').innerHTML = h;

	// 年金の内訳
	const A = cmp.annuity;
	const d = A.detail;
	let h2 = rline('1年あたりの受取額', man(d.perYear) + '万円 × ' + d.years + '年', 'dim');
	/* 受け取り終わるまで残りの資産は運用が続くので、総額は受給開始時の残高より多い。
	   一時金と比べるときにここが効くので、増える分を明示する */
	if (d.growth > 0) {
		h2 += rline('受取中の運用で増える分', '＋' + yen(d.growth), 'dim') +
			rline('受け取る総額', yen(d.gross), 'dim');
	}
	/* 老齢年金が出はじめる65歳の前後で、増える雑所得は変わる。
	   1年目だけ出すと、その先が同じ額だと読まれてしまう */
	const miscFrom = d.rows.length ? d.rows[0].misc : 0;
	const miscTo = d.rows.length ? d.rows[d.rows.length - 1].misc : 0;
	const miscChanges = man(miscFrom) !== man(miscTo);
	h2 += rline('増える雑所得（年）',
			miscChanges ? yen(miscFrom) + ' → ' + yen(miscTo) : yen(miscFrom), 'dim') +
		rline('税額（' + d.years + '年の合計）', '−' + yen(d.tax), 'dim') +
		rline('iDeCoの手取り', yen(d.net), hasRetire ? 'sub' : 'total');
	if (hasRetire) {
		/* 年金で受け取る場合、iDeCoは退職所得控除を使わないので
		   退職金側の控除は調整されない（満額のまま） */
		h2 += retireLines(cfg.retireAmount, Tax.retireDeduction(L.retireYears),
			A.tax - d.tax, false);
		h2 += rline('合計', yen(A.net), 'total');
	}
	h2 += idecoTaxRow(A.taxByIdeco);
	if (miscChanges) {
		h2 += '<div class="split-note">老齢年金が出はじめる' + d.pensionAge +
			'歳から公的年金等控除を分け合うので、そこで雑所得の増え方が変わります。</div>';
	}
	if (d.tax === 0) h2 += '<div class="zero-note">公的年金等控除の範囲に収まるため非課税です</div>';
	$('annuityDetail').innerHTML = h2;

	/* 比べるのは「iDeCoによって増える税金」。
	   手取りで比べると、年金は受け取り終わるまで運用が続くぶん必ず多くなり、
	   受け取り方の違いではなく運用期間の差を見ていることになってしまう。
	   税額なら、退職所得控除の調整や公的年金等控除の効き方をそのまま比べられる */
	const lumpAdd = L.taxByIdeco, annuityAdd = A.taxByIdeco;
	const lighter = Math.min(lumpAdd, annuityAdd);
	const gapTax = Math.abs(annuityAdd - lumpAdd);
	const lighterName = lumpAdd < annuityAdd ? '一時金' : '年金';
	/* 加入期間が勤続期間より長いと控除が増えて、税金がむしろ減ることがある。
	   そのときは符号付きで出さず、「減る」と言葉で伝える */
	const taxDown = lighter < -5000;
	const sub = '<span class="gsub">もう一方より ' + man(gapTax) +
		'万円 少ない（iDeCoを受け取らない場合との差）</span>';
	$('grandLabel').innerHTML = gapTax < 10000
		? '一時金と年金で税金の変わり方はほぼ同じ<span class="gsub">iDeCoを受け取らない場合との差</span>'
		: (taxDown ? '税金が減るのは <b>' + lighterName + '</b>' + sub
		           : '増える税金が少ないのは <b>' + lighterName + '</b>' + sub);
	$('grandVal').innerHTML = man(Math.abs(lighter)) + '<small>万円</small>';

	/* 入口で軽くなった税金から、出口で増える税金を引いた正味。
	   運用期間に左右されない、iDeCoの税制上の損得そのもの。
	   出口で減る場合は引き算ではなく足し算になるので、記号も変える */
	$('totalLabel').innerHTML = '掛金の節税額 ' + man(acc.saved) + '万円 ' +
		(taxDown ? '＋ 減る税金 ' : '− 増える税金 ') + man(Math.abs(lighter)) + '万円';
	$('totalVal').innerHTML = man(acc.saved - lighter) + '<small>万円</small>';

	/* 手取りを大きく出さない理由を書いておく。数字自体は結果の欄に出ている */
	const scope = hasRetire ? 'iDeCo＋退職金' : 'iDeCo';
	const netGap = A.net - L.net;
	$('netNote').className = 'note';
	if (Math.abs(netGap) < 10000) {
		$('netNote').innerHTML = '手取り（' + scope + '）は一時金・年金ともほぼ同じ ' + man(L.net) + '万円 です。';
	} else if (netGap > 0) {
		/* 年金のほうが多いのが普通。受け取り終わるまで運用が続くためで、
		   受け取り方そのものの違いではないと断っておく */
		$('netNote').innerHTML = '手取り（' + scope + '）だけを見ると年金のほうが ' + man(netGap) +
			'万円 多くなりますが、これは年金が受け取り終わるまで運用を続ける前提によるところが大きく、' +
			'受け取り方そのものの違いではありません。判断には上の税額の差をご覧ください。';
	} else {
		// 税額の差が運用のぶんを上回ると、手取りでも一時金が勝つ
		$('netNote').innerHTML = '手取り（' + scope + '）でも一時金のほうが ' + man(-netGap) +
			'万円 多くなります。年金は受け取り終わるまで運用が続くぶん有利になりますが、' +
			'この条件では税額の差がそれを上回っています。';
	}

	/* グラフ：受取年齢を60〜75歳で振り、一時金と年金を2本並べる。
	   受け取り方を選ばせて1本だけ描いていたが、下に両方の内訳が出ている以上
	   選ばせる意味が薄く、2本にしたほうが「どの年齢でどちらが有利か」が直接見える */
	const sweep = [];
	for (let age = earliest; age <= PAYOUT_AGE_MAX; age++) {
		// その年齢まで積み立てたときの残高で計算する（長く置けば残高も増える）
		const a = accumulate({
			startAge: cfg.startAge, payAge: age, startYear: cfg.startYear,
			category: cfg.category, monthly: cfg.monthly, otherPlanMonthly: cfg.otherPlanMonthly,
			yieldRate: cfg.yieldRate, taxableIncome: cfg.taxableIncome,
			initialBalance: cfg.initialBalance
		}, Tax);
		const c = compare(payoutCfg(cfg, a.balance, age), Tax);
		sweep.push({ age: age, lump: c.lump.taxByIdeco, annuity: c.annuity.taxByIdeco });
	}
	// 税金は少ないほうがよいので、最小の組み合わせを探す
	let best = Infinity, bestAge = null, bestName = '';
	for (const s of sweep) {
		if (s.lump < best) { best = s.lump; bestAge = s.age; bestName = '一時金'; }
		if (s.annuity < best) { best = s.annuity; bestAge = s.age; bestName = '年金'; }
	}
	state.bestAge = bestAge;
	state.chartFrom = sweep[0].age;
	$('chartNote').textContent =
		'受け取る年齢を遅らせると残高が増えて税金も増える一方、加入年数が延びて退職所得控除も大きくなり、' +
		'退職金との間隔が変わって控除の調整も動きます。' +
		'iDeCoによって増える税金が最も少ないのは、' + bestAge + '歳に' + bestName +
		'で受け取る場合（' + man(best) + '万円）です。';
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

/* 印刷の前にツールチップを消す。

   ツールチップは canvas に描き込まれるので、出したまま印刷すると紙にも載る。
   ふだんは beforeprint でテーマがライトに固定され、上の Theme.onChange が
   グラフを作り直すので消えるが、theme.js は二重に動かないよう
   「前の印刷が終わっていなければ何もしない」という作りになっている。
   afterprint が来ないまま次の印刷に入ると再描画が飛ばされ、残ってしまう。
   刷り直しは利かないので、ここでも消しておく。

   消し方は作り直し。setActiveElements で選択を外して update() しても消えず、
   Chart.js が持っている選択の状態（getActiveElements）も、canvas に残っている
   絵とは一致しないので当てにできない。毎回そのまま作り直す */
function clearChartTooltip() {
	if (!chart) return;
	chart.destroy();
	chart = null;
	update();
}
window.addEventListener('beforeprint', clearChartTooltip);
/* beforeprint を出さないブラウザ向け。印刷用のスタイルに切り替わった時点で拾う */
if (window.matchMedia) {
	const printQuery = window.matchMedia('print');
	if (printQuery.addEventListener) {
		printQuery.addEventListener('change', e => { if (e.matches) clearChartTooltip(); });
	}
}

restoreState();
update();
