'use strict';

/* iDeCoシミュレーターの計算部分。表示から独立していて、テストからも読み込める
   （資産運用の asset-core.js、相続の inheritance-core.js と同じ切り分け方）。

   税額の計算そのもの（所得税の速算表・退職所得控除・公的年金等控除）は
   common/tax-core.js にある。ここに置くのは iDeCo 固有の制度だけ。

   金額の単位は円。 */

/* ---------- 拠出限度額 ----------

   2026年12月1日の改正で限度額が上がる（適用は2027年1月拠出分から）。
   公開時点（2026年8月）から4か月後に変わるので、現行と改正後を両方持ち、
   拠出する年で切り替える。改正で数字を直すときは下の表だけを見ればよい。 */
const LIMIT_REFORM_YEAR = 2027; // この年から改正後の限度額を使う

/* 区分ごとの月額限度額。第2号は改正後、企業型DCの事業主掛金と
   確定給付企業年金の他制度掛金相当額を差し引いた残りが使える枠になる */
const CONTRIBUTION_LIMITS = {
	self:      { label: '第1号（自営業者など）',        current: 68000, reformed: 75000, sharedWithDb: false },
	employee:  { label: '第2号（会社員・企業年金なし）', current: 23000, reformed: 62000, sharedWithDb: true },
	corporate: { label: '第2号（会社員・企業年金あり）', current: 20000, reformed: 62000, sharedWithDb: true },
	publicSv:  { label: '第2号（公務員）',              current: 20000, reformed: 62000, sharedWithDb: true },
	spouse:    { label: '第3号（専業主婦・主夫）',       current: 23000, reformed: 23000, sharedWithDb: false }
};

/* 加入できる年齢の上限。改正で65歳未満から70歳未満に広がる
   （老齢基礎年金・iDeCoの老齢給付金を受け取っていない人） */
const JOIN_AGE_LIMIT = { current: 65, reformed: 70 };

// 受給を始められる年齢の範囲
const PAYOUT_AGE_MIN = 60;
const PAYOUT_AGE_MAX = 75;

/**
 * その年に拠出できる月額の上限。
 * otherPlanMonthly は企業型DCの事業主掛金＋他制度掛金相当額（月額）。
 * 改正後の第2号はこれを差し引いた残りが枠になる。
 */
function contributionLimit(category, year, otherPlanMonthly) {
	const c = CONTRIBUTION_LIMITS[category];
	if (!c) return 0;
	const reformed = year >= LIMIT_REFORM_YEAR;
	const base = reformed ? c.reformed : c.current;
	if (reformed && c.sharedWithDb) {
		return Math.max(0, base - Math.max(0, otherPlanMonthly || 0));
	}
	return base;
}

// その年に加入していられる年齢の上限（未満）
function joinAgeLimit(year) {
	return year >= LIMIT_REFORM_YEAR ? JOIN_AGE_LIMIT.reformed : JOIN_AGE_LIMIT.current;
}

/* ---------- 入口：掛金の所得控除による節税 ----------

   iDeCoの掛金は全額が小規模企業共済等掛金控除になる。
   節税額は「税率×掛金」ではなく、掛金を引く前後の税額の差で出す。
   限界税率の区分をまたぐときに、前者では合わないため。 */
function taxSaving(taxableIncome, annualContribution, tax) {
	const before = Math.max(0, taxableIncome);
	const after = Math.max(0, before - Math.max(0, annualContribution));
	return {
		income: tax.incomeTax(before) - tax.incomeTax(after),
		inhabitant: tax.inhabitantTax(before) - tax.inhabitantTax(after),
		get total() { return this.income + this.inhabitant; }
	};
}

/* ---------- 積立 ---------- */

/**
 * 拠出と運用の積み上げ。年ごとの残高・拠出累計・節税累計を返す。
 * 掛金は年初にまとめて入れ、その年の利回りが付くものとして扱う。
 */
function accumulate(cfg, tax) {
	const startYear = cfg.startYear;
	const years = Math.max(0, cfg.payAge - cfg.startAge);
	const rate = cfg.yieldRate / 100;

	const rows = [];
	let balance = cfg.initialBalance || 0;
	let paid = 0;
	let saved = 0;

	for (let i = 0; i < years; i++) {
		const age = cfg.startAge + i;
		const year = startYear + i;
		const limit = contributionLimit(cfg.category, year, cfg.otherPlanMonthly);
		// 加入できる年齢を過ぎたら拠出は止まるが、運用は続く
		const canPay = age < joinAgeLimit(year);
		const monthly = canPay ? Math.min(cfg.monthly, limit) : 0;
		const annual = monthly * 12;

		const s = canPay ? taxSaving(cfg.taxableIncome, annual, tax).total : 0;

		balance = (balance + annual) * (1 + rate);
		paid += annual;
		saved += s;
		rows.push({ age: age, year: year, limit: limit, contribution: annual, saving: s, balance: balance });
	}
	const initial = cfg.initialBalance || 0;
	return {
		rows: rows,
		balance: balance,
		paid: paid,
		saved: saved,
		gain: balance - paid - initial,
		/* 実際に自分の懐から出ていく額。掛金の一部は所得控除で税金が軽くなって
		   戻ってくるので、その分は負担ではない。
		   「掛金」と「節税額」を並べて足すと二重に数えることになる */
		netCost: Math.max(0, paid - saved)
	};
}

/* ---------- 出口：重複期間と退職所得控除の調整 ----------

   前に退職手当等を受けていると、勤続期間の重なり分だけ退職所得控除が減る
   （国税庁 No.2732）。対象になる期間は受け取る順で違う。 */
const OVERLAP_YEARS_IDECO_FIRST = 9;   // iDeCoが先→退職金が後（令和8年1月1日以後。従来は4年）
const OVERLAP_YEARS_RETIRE_FIRST = 19; // 退職金が先→iDeCoが後（据え置き）

/* 2つの期間の重なりの年数。1年未満は切り捨て、重ならなければ0。
   期間は [開始, 終了] の年（または年齢）で受け取る */
function overlapYears(aStart, aEnd, bStart, bEnd) {
	const start = Math.max(aStart, bStart);
	const end = Math.min(aEnd, bEnd);
	return Math.max(0, Math.floor(end - start));
}

/* 重複期間を差し引いた退職所得控除。
   「自分の年数の控除額 − 重複年数の控除額」。マイナスにはしない */
function adjustedDeduction(ownYears, overlap, tax) {
	const full = tax.retireDeduction(ownYears);
	if (!(overlap > 0)) return full;
	return Math.max(0, full - tax.retireDeduction(overlap));
}

/**
 * 一時金で受け取ったときの税額。iDeCoと退職金の受取順・間隔で、
 * どちらの控除が削られるかが変わる。
 *
 * cfg: { idecoAmount, idecoJoinAge, idecoPayAge,
 *        retireAmount, hireAge, retireAge }
 */
function lumpSumTax(cfg, tax) {
	const idecoYears = Math.max(0, Math.floor(cfg.idecoPayAge - cfg.idecoJoinAge));
	const retireYears = Math.max(0, Math.floor(cfg.retireAge - cfg.hireAge));
	const gap = cfg.idecoPayAge - cfg.retireAge; // ＋ならiDeCoが後
	const overlap = overlapYears(cfg.idecoJoinAge, cfg.idecoPayAge, cfg.hireAge, cfg.retireAge);

	const r = { idecoYears: idecoYears, retireYears: retireYears, overlap: 0, sameYear: false, adjusted: null };

	// 退職金が無ければ、iDeCoだけを普通に計算する
	if (!(cfg.retireAmount > 0)) {
		const koujo = tax.retireDeduction(idecoYears);
		const t = tax.calcTax(cfg.idecoAmount, koujo);
		r.ideco = { amount: cfg.idecoAmount, deduction: koujo, tax: t.tax, inhabitTax: t.inhabitTax };
		r.retire = { amount: 0, deduction: 0, tax: 0, inhabitTax: 0 };
	} else if (gap === 0) {
		/* 同じ年に両方受け取ると、合算して1つの退職所得になる。
		   控除は、重なりを除いた通算の勤続年数で1回分だけ使える */
		r.sameYear = true;
		r.overlap = overlap;
		const totalYears = idecoYears + retireYears - overlap;
		const koujo = tax.retireDeduction(Math.max(0, totalYears));
		const amount = cfg.idecoAmount + cfg.retireAmount;
		const t = tax.calcTax(amount, koujo);
		r.combined = { amount: amount, deduction: koujo, tax: t.tax, inhabitTax: t.inhabitTax };
		r.ideco = { amount: cfg.idecoAmount, deduction: koujo, tax: 0, inhabitTax: 0 };
		r.retire = { amount: cfg.retireAmount, deduction: 0, tax: 0, inhabitTax: 0 };
	} else if (gap > 0) {
		/* 退職金が先 → iDeCoが後。iDeCo側の控除が削られる（19年内） */
		const within = gap <= OVERLAP_YEARS_RETIRE_FIRST;
		r.overlap = within ? overlap : 0;
		r.adjusted = within ? 'ideco' : null;
		const retireKoujo = tax.retireDeduction(retireYears);
		const idecoKoujo = adjustedDeduction(idecoYears, r.overlap, tax);
		const rt = tax.calcTax(cfg.retireAmount, retireKoujo);
		const it = tax.calcTax(cfg.idecoAmount, idecoKoujo);
		r.retire = { amount: cfg.retireAmount, deduction: retireKoujo, tax: rt.tax, inhabitTax: rt.inhabitTax };
		r.ideco = { amount: cfg.idecoAmount, deduction: idecoKoujo, tax: it.tax, inhabitTax: it.inhabitTax };
	} else {
		/* iDeCoが先 → 退職金が後。退職金側の控除が削られる（9年内） */
		const within = -gap <= OVERLAP_YEARS_IDECO_FIRST;
		r.overlap = within ? overlap : 0;
		r.adjusted = within ? 'retire' : null;
		const idecoKoujo = tax.retireDeduction(idecoYears);
		const retireKoujo = adjustedDeduction(retireYears, r.overlap, tax);
		const it = tax.calcTax(cfg.idecoAmount, idecoKoujo);
		const rt = tax.calcTax(cfg.retireAmount, retireKoujo);
		r.ideco = { amount: cfg.idecoAmount, deduction: idecoKoujo, tax: it.tax, inhabitTax: it.inhabitTax };
		r.retire = { amount: cfg.retireAmount, deduction: retireKoujo, tax: rt.tax, inhabitTax: rt.inhabitTax };
	}

	// 画面が「あと何年ずらせば調整が外れるか」を出すのに使う
	r.gap = gap;
	r.retireAge = cfg.retireAge;
	r.idecoPayAge = cfg.idecoPayAge;
	r.tax = r.sameYear
		? r.combined.tax + r.combined.inhabitTax
		: r.ideco.tax + r.ideco.inhabitTax + r.retire.tax + r.retire.inhabitTax;
	r.gross = cfg.idecoAmount + (cfg.retireAmount || 0);
	r.net = r.gross - r.tax;
	return r;
}

/* ---------- 出口：年金（分割）で受け取る ----------

   公的年金等の収入として、老齢年金と合算して公的年金等控除を当てる。
   控除枠を分け合うので、老齢年金が多いほどiDeCo側の税負担は重くなる。 */
function annuityTax(cfg, tax) {
	const years = Math.max(1, Math.round(cfg.annuityYears));
	const perYear = cfg.idecoAmount / years;
	const rows = [];
	let total = 0;

	for (let i = 0; i < years; i++) {
		const age = cfg.idecoPayAge + i;
		const publicPension = cfg.publicPension || 0;
		// iDeCoを足す前と後で、公的年金等に係る雑所得がどれだけ増えるかを見る
		const baseMisc = tax.pensionMiscIncome(publicPension, age);
		const withMisc = tax.pensionMiscIncome(publicPension + perYear, age);
		const added = Math.max(0, withMisc - baseMisc);

		/* 他の所得と合算して累進で決まるが、ここでは「iDeCoで増えた雑所得だけ」に
		   税率を当てる簡易計算にしている。他の所得の有無で税率が変わる点は注記で断る */
		const incomeT = tax.incomeTax(added);
		const inhabitantT = tax.inhabitantTax(added);
		const t = incomeT + inhabitantT;
		total += t;
		rows.push({
			age: age, received: perYear, misc: added,
			tax: incomeT, inhabitTax: inhabitantT
		});
	}

	return {
		rows: rows, years: years, perYear: perYear,
		tax: total, gross: cfg.idecoAmount, net: cfg.idecoAmount - total
	};
}

/* ---------- まとめ ----------

   受取方法ごとの手取りを並べて返す。退職金の税額は一時金の計算に含まれるので、
   年金受取のときも退職金分は一時金として別に足す。 */
function compare(cfg, tax) {
	const lump = lumpSumTax(cfg, tax);

	// 年金受取: iDeCoは分割、退職金は一時金のまま（控除の調整は起きない）
	const annuity = annuityTax(cfg, tax);
	const retireOnly = cfg.retireAmount > 0
		? tax.calcTax(cfg.retireAmount, tax.retireDeduction(Math.max(0, Math.floor(cfg.retireAge - cfg.hireAge))))
		: { tax: 0, inhabitTax: 0 };
	const retireTax = retireOnly.tax + retireOnly.inhabitTax;

	return {
		lump: lump,
		annuity: {
			detail: annuity,
			tax: annuity.tax + retireTax,
			gross: cfg.idecoAmount + (cfg.retireAmount || 0),
			net: cfg.idecoAmount + (cfg.retireAmount || 0) - annuity.tax - retireTax
		}
	};
}

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		contributionLimit: contributionLimit, joinAgeLimit: joinAgeLimit,
		taxSaving: taxSaving, accumulate: accumulate,
		overlapYears: overlapYears, adjustedDeduction: adjustedDeduction,
		lumpSumTax: lumpSumTax, annuityTax: annuityTax, compare: compare,
		CONTRIBUTION_LIMITS: CONTRIBUTION_LIMITS,
		LIMIT_REFORM_YEAR: LIMIT_REFORM_YEAR,
		JOIN_AGE_LIMIT: JOIN_AGE_LIMIT,
		PAYOUT_AGE_MIN: PAYOUT_AGE_MIN, PAYOUT_AGE_MAX: PAYOUT_AGE_MAX,
		OVERLAP_YEARS_IDECO_FIRST: OVERLAP_YEARS_IDECO_FIRST,
		OVERLAP_YEARS_RETIRE_FIRST: OVERLAP_YEARS_RETIRE_FIRST
	};
}
