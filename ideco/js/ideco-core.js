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
   確定給付企業年金の他制度掛金相当額を差し引いた残りが使える枠になる。

   endsAt60 は「60歳で国民年金の被保険者でなくなる区分」。第1号と第3号は
   20歳以上60歳未満なので、現行制度では60歳以降はiDeCoに拠出できない。
   第2号は厚生年金の被保険者なので、働き続けていれば60歳以降もそのまま拠出できる。
   （iDeCo公式「iDeCoの加入資格・掛金・受取方法等」より） */
const CONTRIBUTION_LIMITS = {
	self:      { label: '第1号（自営業者など）',        current: 68000, reformed: 75000, sharedWithDb: false, endsAt60: true },
	employee:  { label: '第2号（会社員・企業年金なし）', current: 23000, reformed: 62000, sharedWithDb: true,  endsAt60: false },
	corporate: { label: '第2号（会社員・企業年金あり）', current: 20000, reformed: 62000, sharedWithDb: true,  endsAt60: false },
	publicSv:  { label: '第2号（公務員）',              current: 20000, reformed: 62000, sharedWithDb: true,  endsAt60: false },
	spouse:    { label: '第3号（専業主婦・主夫）',       current: 23000, reformed: 23000, sharedWithDb: false, endsAt60: true }
};

/* 国民年金の被保険者でなくなる年齢（第1号・第3号）。
   60歳以上65歳未満の任意加入被保険者はこの先も拠出できるが、
   保険料の納付済期間が480月に満たない人だけの制度なので扱わない */
const NATIONAL_PENSION_END_AGE = 60;

/* 改正後は「60歳以上70歳未満で国民年金の被保険者でない人」も
   第5号加入者として拠出できるようになる。枠は第2号と同じ月6.2万円 */
const LATE_JOIN_CATEGORY_LIMIT = 62000;

/* 加入できる年齢の上限。改正で65歳未満から70歳未満に広がる
   （老齢基礎年金・iDeCoの老齢給付金を受け取っていない人） */
const JOIN_AGE_LIMIT = { current: 65, reformed: 70 };

// 受給を始められる年齢の範囲
const PAYOUT_AGE_MIN = 60;
const PAYOUT_AGE_MAX = 75;

/* 60歳から受け取るには、60歳になるまでの通算加入者等期間が10年以上要る。
   足りないと受給を始められる年齢が繰り下がる。
   （iDeCo公式「iDeCoの加入資格・掛金・受取方法等」より） */
const PAYOUT_START_BY_PERIOD = [
	{ minYears: 10, age: 60 },
	{ minYears:  8, age: 61 },
	{ minYears:  6, age: 62 },
	{ minYears:  4, age: 63 },
	{ minYears:  2, age: 64 },
	{ minYears:  1, age: 65 }
];

/* 60歳以降に初めて加入した場合は、通算加入者等期間を持たなくても
   加入から5年経過した日から受け取れる */
const LATE_JOIN_AGE = 60;
const LATE_JOIN_WAIT = 5;

/**
 * 加入した年齢から、受給を始められる最も早い年齢を求める。
 * 通算加入者等期間は「60歳になった時点」で数えるので、
 * 60歳より前に加入していれば 60 − 加入年齢 がその期間になる。
 */
function earliestPayoutAge(joinAge) {
	if (joinAge >= LATE_JOIN_AGE) {
		// 60歳以降に初めて加入した場合の特例。受給開始の上限は超えない
		return Math.min(PAYOUT_AGE_MAX, joinAge + LATE_JOIN_WAIT);
	}
	const years = LATE_JOIN_AGE - joinAge;
	for (let i = 0; i < PAYOUT_START_BY_PERIOD.length; i++) {
		if (years >= PAYOUT_START_BY_PERIOD[i].minYears) return PAYOUT_START_BY_PERIOD[i].age;
	}
	// 1年に満たない（59歳より後に加入）場合も、表の最後と同じ扱いにする
	return PAYOUT_START_BY_PERIOD[PAYOUT_START_BY_PERIOD.length - 1].age;
}

/**
 * その年に拠出できる月額の上限。0なら拠出できない。
 * otherPlanMonthly は企業型DCの事業主掛金＋他制度掛金相当額（月額）。
 * 改正後の第2号はこれを差し引いた残りが枠になる。
 * age はその年の年齢。第1号・第3号は60歳で枠が変わる。
 */
function contributionLimit(category, year, otherPlanMonthly, age) {
	const c = CONTRIBUTION_LIMITS[category];
	if (!c) return 0;
	const reformed = year >= LIMIT_REFORM_YEAR;

	/* 60歳で国民年金の被保険者でなくなる区分。現行では拠出できず、
	   改正後は第5号加入者として第2号と同じ枠になる（第3号の2.3万円ではない） */
	if (c.endsAt60 && age >= NATIONAL_PENSION_END_AGE) {
		return reformed ? LATE_JOIN_CATEGORY_LIMIT : 0;
	}

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

/* 掛金を入れる時点。iDeCoの掛金は毎月払うのが普通なので、
   その年の掛金は年の真ん中にまとめて入るものとして扱う。
   年初に一括で入れると、まだ払っていない月の掛金にまで1年分の利回りが付き、
   残高が実際より多く出てしまう（利回り3%で年1.4%ほど）。
   毎月の積み上げをそのまま回した場合との差は、利回り3%で0.1%、8%でも0.3%ほど */
const CONTRIBUTION_TIMING = 0.5; // 年の何割が過ぎた時点で入れるか

/**
 * 拠出と運用の積み上げ。年ごとの残高・拠出累計・節税累計を返す。
 * すでにある残高には1年分、その年の掛金には半年分の利回りが付く。
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
		const limit = contributionLimit(cfg.category, year, cfg.otherPlanMonthly, age);
		// 加入できる年齢を過ぎたら拠出は止まるが、運用は続く
		const canPay = age < joinAgeLimit(year);
		const monthly = canPay ? Math.min(cfg.monthly, limit) : 0;
		const annual = monthly * 12;

		const s = canPay ? taxSaving(cfg.taxableIncome, annual, tax).total : 0;

		balance = balance * (1 + rate) + annual * Math.pow(1 + rate, 1 - CONTRIBUTION_TIMING);
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
   「自分の年数の控除額 − 重複年数の控除額」。マイナスにはしない。

   差し引く側は80万円の最低保障が付かない retireDeductionBase を使う。
   最低保障は自分の控除額に対する規定で、重複ぶんには及ばないため
   （retireDeduction を使うと、重複1年でも80万円が引かれてしまう） */
function adjustedDeduction(ownYears, overlap, tax) {
	const full = tax.retireDeduction(ownYears);
	if (!(overlap > 0)) return full;
	return Math.max(0, full - tax.retireDeductionBase(overlap));
}

/* 短期退職手当等の制限が実際に効いたかどうか。
   税額だけ見ても「なぜ半分にならないのか」が読み取れないので、
   画面で断るために返す（控除を引いた残りが300万円以下なら効いていない） */
function isShortTenure(amount, deduction, years, tax) {
	return years <= tax.SHORT_TENURE_YEARS &&
		amount - deduction > tax.SHORT_TENURE_HALF_LIMIT;
}

/* iDeCoが無かった場合の、退職金だけにかかる税額。
   控除は勤続年数のぶんを満額使える（削る相手がいないため）。

   同じ年に受け取ると合算されて1つの退職所得になり、税額を
   iDeCo分と退職金分に割り振ることはできない。それでも
   「iDeCoをやったことで税額がいくら変わったか」なら、この額との差で出せる。 */
function retireOnlyTax(cfg, tax) {
	if (!(cfg.retireAmount > 0)) return 0;
	const years = Math.max(0, Math.floor(cfg.retireAge - cfg.hireAge));
	const t = tax.calcTax(cfg.retireAmount, tax.retireDeduction(years), years);
	return t.tax + t.inhabitTax;
}

/**
 * 一時金で受け取ったときの税額。iDeCoと退職金の受取順・間隔で、
 * どちらの控除が削られるかが変わる。
 *
 * calcTax にはどの場合も勤続年数（iDeCoは加入年数）を渡す。5年以下だと
 * 短期退職手当等になり、控除後の残額のうち300万円を超える部分が1/2にならない。
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
		const t = tax.calcTax(cfg.idecoAmount, koujo, idecoYears);
		r.ideco = { amount: cfg.idecoAmount, deduction: koujo, tax: t.tax, inhabitTax: t.inhabitTax };
		r.retire = { amount: 0, deduction: 0, tax: 0, inhabitTax: 0 };
	} else if (gap === 0) {
		/* 同じ年に両方受け取ると、合算して1つの退職所得になる。
		   控除は、重なりを除いた通算の勤続年数で1回分だけ使える */
		r.sameYear = true;
		r.overlap = overlap;
		const totalYears = Math.max(0, idecoYears + retireYears - overlap);
		const koujo = tax.retireDeduction(totalYears);
		const amount = cfg.idecoAmount + cfg.retireAmount;
		// 合算して1つの退職所得になるので、短期の判定も通算年数で見る
		const t = tax.calcTax(amount, koujo, totalYears);
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
		const rt = tax.calcTax(cfg.retireAmount, retireKoujo, retireYears);
		const it = tax.calcTax(cfg.idecoAmount, idecoKoujo, idecoYears);
		r.retire = { amount: cfg.retireAmount, deduction: retireKoujo, tax: rt.tax, inhabitTax: rt.inhabitTax };
		r.ideco = { amount: cfg.idecoAmount, deduction: idecoKoujo, tax: it.tax, inhabitTax: it.inhabitTax };
	} else {
		/* iDeCoが先 → 退職金が後。退職金側の控除が削られる（9年内） */
		const within = -gap <= OVERLAP_YEARS_IDECO_FIRST;
		r.overlap = within ? overlap : 0;
		r.adjusted = within ? 'retire' : null;
		const idecoKoujo = tax.retireDeduction(idecoYears);
		const retireKoujo = adjustedDeduction(retireYears, r.overlap, tax);
		const it = tax.calcTax(cfg.idecoAmount, idecoKoujo, idecoYears);
		const rt = tax.calcTax(cfg.retireAmount, retireKoujo, retireYears);
		r.ideco = { amount: cfg.idecoAmount, deduction: idecoKoujo, tax: it.tax, inhabitTax: it.inhabitTax };
		r.retire = { amount: cfg.retireAmount, deduction: retireKoujo, tax: rt.tax, inhabitTax: rt.inhabitTax };
	}

	/* 短期退職手当等の制限が効いたか（画面で断るのに使う）。
	   同じ年に受け取るときは1つの退職所得なので、通算年数と合算額で見る */
	r.shortTenureYears = r.sameYear ? Math.max(0, idecoYears + retireYears - overlap) : idecoYears;
	r.shortTenure = r.sameYear
		? isShortTenure(r.combined.amount, r.combined.deduction, r.shortTenureYears, tax)
		: isShortTenure(cfg.idecoAmount, r.ideco.deduction, r.shortTenureYears, tax);

	// 画面が「あと何年ずらせば調整が外れるか」を出すのに使う
	r.gap = gap;
	r.retireAge = cfg.retireAge;
	r.idecoPayAge = cfg.idecoPayAge;
	r.tax = r.sameYear
		? r.combined.tax + r.combined.inhabitTax
		: r.ideco.tax + r.ideco.inhabitTax + r.retire.tax + r.retire.inhabitTax;
	r.gross = cfg.idecoAmount + (cfg.retireAmount || 0);
	r.net = r.gross - r.tax;

	/* iDeCoをやらなかった場合との差。合算されて按分できない場合でも、
	   これなら出せる。加入期間が勤続期間より長いと通算年数が延びて控除が増え、
	   退職金の税額がむしろ下がることがあるので、マイナスにもなりうる */
	r.taxWithoutIdeco = retireOnlyTax(cfg, tax);
	r.taxByIdeco = r.tax - r.taxWithoutIdeco;
	return r;
}

/* ---------- 出口：年金（分割）で受け取る ----------

   公的年金等の収入として、老齢年金と合算して公的年金等控除を当てる。
   控除枠を分け合うので、老齢年金が多いほどiDeCo側の税負担は重くなる。 */

/* 老齢年金の受給開始年齢。原則は65歳だが、60歳から75歳の間で選べる。
   iDeCoを年金で受け取りはじめてから老齢年金が出るまでの間は、
   公的年金等控除をiDeCoが単独で使える。 */
const PUBLIC_PENSION_START_AGE = 65;   // 原則（増減なしの基準）
const PUBLIC_PENSION_MIN_AGE = 60;     // 繰上げの下限
const PUBLIC_PENSION_MAX_AGE = 75;     // 繰下げの上限

/* 受給開始年齢による増減。繰上げは1か月あたり0.4%減（60歳まで＝最大24%減）、
   繰下げは1か月あたり0.7%増（75歳まで＝最大84%増）。

   減額率0.4%は昭和37年4月2日以後生まれのもので、それ以前は0.5%（最大30%減）。
   これから受け取る人はほぼ前者なので、そちらで計算する。

   年金シミュレーター（pension/js/pension-core.js の pRate）と同じ率。
   食い違うと2つのツールで別の答えが出るので、
   test/ideco-core.test.js で全年齢を突き合わせている */
const PENSION_EARLY_RATE = 0.004;   // 繰上げ：1か月あたりの減額
const PENSION_LATE_RATE = 0.007;    // 繰下げ：1か月あたりの増額

/* 65歳受給開始を1としたときの倍率。入力する見込額（ねんきん定期便の額）は
   65歳時点のものなので、選んだ年齢に応じてここで増減させる */
function publicPensionRate(startAge) {
	if (startAge < PUBLIC_PENSION_START_AGE) {
		return 1 - PENSION_EARLY_RATE * (PUBLIC_PENSION_START_AGE - startAge) * 12;
	}
	if (startAge > PUBLIC_PENSION_START_AGE) {
		const capped = Math.min(startAge, PUBLIC_PENSION_MAX_AGE);
		return 1 + PENSION_LATE_RATE * (capped - PUBLIC_PENSION_START_AGE) * 12;
	}
	return 1;
}

/* 年金で受け取る場合の1年あたりの額。
   一時金と違い、受け取り終わるまで残りの資産は口座に残って運用が続くので、
   受け取る総額は受給開始時の残高より多くなる。
   受け取りは期首（その年のはじめ）とする。掛金は期央で入れているが、
   こちらを期首にしておくと運用が続く期間を短めに見るので、
   年金受取を有利に見せすぎない側に倒れる。 */
function annuityPayment(balance, years, yieldRate) {
	const n = Math.max(1, Math.round(years));
	const r = (yieldRate || 0) / 100;
	if (!(balance > 0)) return 0;
	if (!(r > 0)) return balance / n;
	// 期首払いの年金現価率
	const factor = (1 - Math.pow(1 + r, -n)) / r * (1 + r);
	return balance / factor;
}

function annuityTax(cfg, tax) {
	const years = Math.max(1, Math.round(cfg.annuityYears));
	const perYear = annuityPayment(cfg.idecoAmount, years, cfg.yieldRate);
	const rows = [];
	let total = 0;

	/* 老齢年金。受給開始年齢の指定がなければ原則の65歳。
	   入力される見込額は65歳時点の額なので、繰上げ・繰下げの分を掛ける */
	const pensionAge = cfg.publicPensionStartAge || PUBLIC_PENSION_START_AGE;
	const pensionYearly = (cfg.publicPension || 0) * publicPensionRate(pensionAge);

	for (let i = 0; i < years; i++) {
		const age = cfg.idecoPayAge + i;
		// 受給開始年齢になるまで、老齢年金はまだ出ていない
		const publicPension = age >= pensionAge ? pensionYearly : 0;
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

	/* 受け取る総額は「1年あたりの額 × 年数」。運用が続くぶん、
	   受給開始時の残高（idecoAmount）より多くなる */
	const gross = perYear * years;
	return {
		rows: rows, years: years, perYear: perYear,
		balance: cfg.idecoAmount,
		growth: gross - cfg.idecoAmount,
		tax: total, gross: gross, net: gross - total,
		// 画面が「いつから、いくらの老齢年金と分け合うのか」を出すのに使う
		pensionAge: pensionAge, pensionYearly: pensionYearly
	};
}

/* ---------- まとめ ----------

   受取方法ごとの手取りを並べて返す。退職金の税額は一時金の計算に含まれるので、
   年金受取のときも退職金分は一時金として別に足す。 */
function compare(cfg, tax) {
	const lump = lumpSumTax(cfg, tax);

	/* 年金受取: iDeCoは分割、退職金は一時金のまま。
	   iDeCoが退職所得控除を使わないので、退職金側の控除は調整されない
	   ＝ iDeCoが無かった場合と同じ税額になる */
	const annuity = annuityTax(cfg, tax);
	const retireTax = retireOnlyTax(cfg, tax);

	/* 年金側の総額は、受け取り終わるまでの運用ぶんだけ一時金より多い。
	   退職金は一時金のまま受け取る前提なので、そのまま足す */
	const annuityGross = annuity.gross + (cfg.retireAmount || 0);
	return {
		lump: lump,
		annuity: {
			detail: annuity,
			tax: annuity.tax + retireTax,
			gross: annuityGross,
			net: annuityGross - annuity.tax - retireTax,
			// 年金なら退職金側は調整されないので、増えるのはiDeCo分の税額だけ
			taxWithoutIdeco: retireTax,
			taxByIdeco: annuity.tax
		}
	};
}

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		contributionLimit: contributionLimit, joinAgeLimit: joinAgeLimit,
		taxSaving: taxSaving, accumulate: accumulate,
		overlapYears: overlapYears, adjustedDeduction: adjustedDeduction, isShortTenure: isShortTenure,
		lumpSumTax: lumpSumTax, retireOnlyTax: retireOnlyTax, annuityPayment: annuityPayment,
		annuityTax: annuityTax, compare: compare,
		CONTRIBUTION_LIMITS: CONTRIBUTION_LIMITS,
		LIMIT_REFORM_YEAR: LIMIT_REFORM_YEAR,
		JOIN_AGE_LIMIT: JOIN_AGE_LIMIT,
		NATIONAL_PENSION_END_AGE: NATIONAL_PENSION_END_AGE,
		LATE_JOIN_CATEGORY_LIMIT: LATE_JOIN_CATEGORY_LIMIT,
		PUBLIC_PENSION_START_AGE: PUBLIC_PENSION_START_AGE,
		PUBLIC_PENSION_MIN_AGE: PUBLIC_PENSION_MIN_AGE,
		PUBLIC_PENSION_MAX_AGE: PUBLIC_PENSION_MAX_AGE,
		PENSION_EARLY_RATE: PENSION_EARLY_RATE,
		PENSION_LATE_RATE: PENSION_LATE_RATE,
		publicPensionRate: publicPensionRate,
		PAYOUT_AGE_MIN: PAYOUT_AGE_MIN, PAYOUT_AGE_MAX: PAYOUT_AGE_MAX,
		earliestPayoutAge: earliestPayoutAge,
		PAYOUT_START_BY_PERIOD: PAYOUT_START_BY_PERIOD,
		LATE_JOIN_AGE: LATE_JOIN_AGE, LATE_JOIN_WAIT: LATE_JOIN_WAIT,
		OVERLAP_YEARS_IDECO_FIRST: OVERLAP_YEARS_IDECO_FIRST,
		OVERLAP_YEARS_RETIRE_FIRST: OVERLAP_YEARS_RETIRE_FIRST
	};
}
