/* ページに書かれた制度の数字が、計算に使っている定数と合っているかのテスト。

   各ツールの定数はJS側では1箇所にまとまっている。腐るのはむしろ、
   利用者に見せている説明文のほう（速算表、控除の式、増減率、非課税枠の額）で、
   これらは計算に一切使われないため、定数だけ直して文章を直し忘れても
   画面上は何も起きない。そこを機械で突き合わせる。

   制度改正のときは「定数 → このテスト → ページの文章」の順に直せばよい。

   実行: npm test   （プロジェクト直下から） */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* 文章として読める形にする（タグを外す）。
   見張りたいのは数字であって印付けではないので、説明文の中にリンクや
   <strong> を足しても落ちないようにする。表の行や入力欄の属性を見る
   ところだけは、構造そのものが対象なので read() の生のHTMLを使う */
const prose = rel => read(rel).replace(/<[^>]+>/g, '');

const asset = require('../assetSimulator/js/asset-core.js');
const inherit = require('../inheritance/js/inheritance-core.js');
const retire = require('../retirement/js/retire-calc.js');
const tax = require('../common/tax-core.js');
const pension = require('../pension/js/pension-core.js');

// 「1,536,000円」のような表記を数値にする
const yen = s => Number(String(s).replace(/[,円]/g, ''));

/* 「20.315%」を 0.20315 と比べる。パーセント表記を100で割ると
   二進小数の丸めが出る（20.315/100 は 0.20315000000000003）ので、
   厳密一致ではなく十分小さい差で見る */
function ratioEquals(percentText, rate, msg) {
	assert.ok(Math.abs(Number(percentText) / 100 - rate) < 1e-12,
		msg + ' 表示 ' + percentText + '% / 定数 ' + rate);
}

/* ページに載っている文言が実際に存在することを確かめてから中身を見る。
   文章を書き換えて正規表現が空振りしたとき、黙って通ってしまわないようにする */
function must(html, re, where) {
	const m = html.match(re);
	assert.ok(m, where + ' に該当する記述が見つからない: ' + re);
	return m;
}

/* ---------- 資産運用シミュレーター ---------- */

test('資産運用：NISAの投資枠の説明が定数と一致する', () => {
	const text = prose('assetSimulator/index.html');
	const m = must(text, /NISAは年間(\d+)万円・生涯(\d+)万円（簿価）まで/, 'assetSimulator/index.html');
	assert.strictEqual(Number(m[1]), asset.NISA_ANNUAL, '年間投資枠');
	assert.strictEqual(Number(m[2]), asset.NISA_LIFETIME, '生涯投資枠');

	// 「実質表示」の注記にも同じ額が出てくる
	const m2 = must(text, /名目の金額（年(\d+)万円・生涯(\d+)万円）で固定/, 'assetSimulator/index.html');
	assert.strictEqual(Number(m2[1]), asset.NISA_ANNUAL, '注記の年間投資枠');
	assert.strictEqual(Number(m2[2]), asset.NISA_LIFETIME, '注記の生涯投資枠');

	// 入力欄の上限も生涯投資枠に合わせてある
	const m3 = must(read('assetSimulator/index.html'), /id="nisaUsed"[^>]*max="(\d+)"/, 'assetSimulator/index.html');
	assert.strictEqual(Number(m3[1]), asset.NISA_LIFETIME, 'NISA使用済み欄の上限');
});

test('資産運用：譲渡益税率の表示が定数と一致する', () => {
	const m = must(prose('assetSimulator/index.html'), /売却益に課税する（([\d.]+)%）/, 'assetSimulator/index.html');
	ratioEquals(m[1], asset.TAX_RATE, '譲渡益税率');
});

/* ---------- 二次相続シミュレーター ---------- */

test('相続：基礎控除の式が計算と一致する', () => {
	const m = must(prose('inheritance/index.html'), /基礎控除は「([\d,]+)万円＋([\d,]+)万円×法定相続人の数」/, 'inheritance/index.html');
	const base = yen(m[1]), perHeir = yen(m[2]);

	// 書かれている式のとおりの額なら課税されず、1万円超えると課税される
	for (const heirs of [1, 2, 3, 5]) {
		const ded = base + perHeir * heirs;
		const hasSpouse = heirs > 1;
		const nChildren = hasSpouse ? heirs - 1 : heirs;
		assert.strictEqual(inherit.totalTax(ded, hasSpouse, nChildren), 0,
			'法定相続人' + heirs + '人：基礎控除ちょうどで課税されている');
		assert.ok(inherit.totalTax(ded + 1, hasSpouse, nChildren) > 0,
			'法定相続人' + heirs + '人：基礎控除を超えても課税されない');
	}
});

test('相続：配偶者の税額軽減の額が計算と一致する', () => {
	const m = must(prose('inheritance/index.html'), /配偶者の税額軽減（([\d億,]+)万円または法定相続分/, 'inheritance/index.html');
	// 「1億6,000万円」→ 16000
	const parts = m[1].match(/(?:(\d+)億)?([\d,]*)/);
	const cap = (Number(parts[1] || 0)) * 10000 + yen(parts[2] || 0);
	assert.strictEqual(cap, 16000, '書かれている軽減の上限');

	// その額までを配偶者が取得すれば税額はゼロ、超えれば出る
	const at = inherit.simulate(cap, 0, true, 1, 100, 0, 10);
	assert.strictEqual(at.spTax, 0, '上限ちょうどで配偶者に税額が出ている');
	const over = inherit.simulate(cap + 2000, 0, true, 1, 100, 0, 10);
	assert.ok(over.spTax > 0, '上限を超えても配偶者の税額がゼロのまま');
});

test('相続：小規模宅地等の特例の説明が定数と一致する', () => {
	const text = prose('inheritance/index.html');
	// 説明ツールチップ
	const tip = must(text, /(\d+)㎡までの部分の評価額を(\d+)%減額/, 'inheritance/index.html（ツールチップ）');
	assert.strictEqual(Number(tip[1]), inherit.SMALL_LOT_LIMIT, '限度面積');
	ratioEquals(tip[2], inherit.SMALL_LOT_RATE, '減額割合');
	// 注記
	const note = must(text, /特定居住用宅地等（(\d+)㎡までの部分を(\d+)%減額）/, 'inheritance/index.html（注記）');
	assert.strictEqual(Number(note[1]), inherit.SMALL_LOT_LIMIT, '注記の限度面積');
	ratioEquals(note[2], inherit.SMALL_LOT_RATE, '注記の減額割合');
	// 入力欄の初期の案内
	const hint = must(text, /(\d+)㎡までの部分が(\d+)%減額の対象です/, 'inheritance/index.html（案内）');
	assert.strictEqual(Number(hint[1]), inherit.SMALL_LOT_LIMIT, '案内の限度面積');
	ratioEquals(hint[2], inherit.SMALL_LOT_RATE, '案内の減額割合');
});

test('相続：生命保険金の非課税枠の説明が定数と一致する', () => {
	const text = prose('inheritance/index.html');
	const tip = must(text, /「([\d,]+)万円 × 法定相続人の数」までは非課税/, 'inheritance/index.html（ツールチップ）');
	assert.strictEqual(yen(tip[1]), inherit.INSURANCE_PER_HEIR, '1人あたりの非課税枠');

	const note = must(text, /生命保険金の非課税枠（([\d,]+)万円×法定相続人の数）/, 'inheritance/index.html（注記）');
	assert.strictEqual(yen(note[1]), inherit.INSURANCE_PER_HEIR, '注記の1人あたりの非課税枠');

	// 書かれている額どおりに枠が増える
	for (const heirs of [1, 3, 5]) {
		assert.strictEqual(inherit.insuranceExemption(1e9, heirs),
			inherit.INSURANCE_PER_HEIR * heirs, '法定相続人' + heirs + '人の枠');
	}
});

/* ---------- 公務員退職手当 ---------- */

/* 退職手当のページは地方・国家の2枚あり、説明はどちらも同じ内容を持つ。
   片方だけ直して食い違うことがあるので、2枚とも見る */
const RETIRE_PAGES = ['retirement/local/index.html', 'retirement/national/index.html'];

test('退職手当：所得税の速算表がcalcTaxと一致する', () => {
	for (const page of RETIRE_PAGES) {
		const html = read(page);
		const rows = [...html.matchAll(
			/<tr><td>([\d,]+)円(?:～([\d,]+)円)?～?<\/td><td>(\d+)%<\/td><td>([\d,]+)円<\/td><\/tr>/g)];
		assert.ok(rows.length >= 7, page + ' の速算表を読み取れていない（' + rows.length + '行）');

		for (const r of rows) {
			const lo = yen(r[1]);
			const hi = r[2] ? yen(r[2]) : null;
			const rate = Number(r[3]) / 100;
			const ded = yen(r[4]);

			/* 区分の中ほどの課税所得で突き合わせる。calcTax は
			   （退職手当−控除額）÷2 を課税所得にするので、逆算して支給額を作る。
			   最後に復興特別所得税の1.021を掛けて切り捨てる */
			const koujo = 800000;
			const kazei = hi === null ? lo + 1000000 : Math.floor((lo + hi) / 2 / 1000) * 1000;
			const got = tax.calcTax(koujo + kazei * 2, koujo).tax;
			const want = Math.floor((kazei * rate - ded) * 1.021);
			assert.ok(Math.abs(got - want) <= 1,
				page + ' の速算表 ' + r[1] + '円～ の行が計算と合わない' +
				'（課税所得' + kazei + '円：表どおりなら' + want + '円、計算は' + got + '円）');
		}
	}
});

test('退職手当：速算表の区分の切れ目がcalcTaxの切り替わりと一致する', () => {
	for (const page of RETIRE_PAGES) {
		const html = read(page);
		const rows = [...html.matchAll(
			/<tr><td>([\d,]+)円(?:～([\d,]+)円)?～?<\/td><td>(\d+)%<\/td><td>([\d,]+)円<\/td><\/tr>/g)];
		const koujo = 800000;

		// 各行の下限のすぐ手前と、その行の税率で計算した額が食い違うことを確かめる
		// ＝ そこが実際に区分の切れ目になっている
		for (const r of rows) {
			const lo = yen(r[1]);
			if (lo <= 1000) continue;  // 最初の行に「手前」は無い
			const rate = Number(r[3]) / 100, ded = yen(r[4]);

			const atLo = tax.calcTax(koujo + lo * 2, koujo).tax;
			assert.ok(Math.abs(atLo - Math.floor((lo * rate - ded) * 1.021)) <= 1,
				page + '：' + r[1] + '円ちょうどが表の区分と合わない');

			const below = lo - 1000;
			const belowByThisRow = Math.floor((below * rate - ded) * 1.021);
			const belowActual = tax.calcTax(koujo + below * 2, koujo).tax;
			assert.ok(Math.abs(belowActual - belowByThisRow) > 1,
				page + '：' + r[1] + '円の1つ下も同じ税率で計算されている（区分の切れ目がずれている）');
		}
	}
});

test('退職手当：退職所得控除の説明がretireDeductionと一致する', () => {
	for (const page of RETIRE_PAGES) {
		const html = read(page);
		const short = must(html, /<th>(\d+)年以下<\/th><td>(\d+)万円×勤続年数（最低(\d+)万円）<\/td>/, page);
		const border = Number(short[1]), perYear = Number(short[2]) * 10000, floor = Number(short[3]) * 10000;

		const long = must(html,
			/<th>(\d+)年超<\/th><td>(\d+)万円×\(勤続年数 - (\d+)年\) \+ (\d+)万円<\/td>/, page);
		assert.strictEqual(Number(long[1]), border, page + '：短期と長期の境目が食い違っている');
		assert.strictEqual(Number(long[3]), border, page + '：長期の式の起点が境目と違う');
		const perYearLong = Number(long[2]) * 10000, baseLong = Number(long[4]) * 10000;

		// 境目を跨いで、書かれている式どおりの額になるか
		for (let y = 0; y <= 40; y++) {
			const want = y <= border
				? Math.max(floor, perYear * y)
				: baseLong + perYearLong * (y - border);
			assert.strictEqual(tax.retireDeduction(y), want,
				page + '：勤続' + y + '年の退職所得控除が表の式と合わない');
		}
	}
});

test('退職手当：定年の引き上げの説明がteinenAgeと一致する', () => {
	for (const page of RETIRE_PAGES) {
		const html = read(page);
		const m = must(html,
			/(\d{4})年度から(\d{4})年度まで<br \/>段階的に定年が(\d+)歳まで<br \/>引き上げられます/, page);
		const from = Number(m[1]), until = Number(m[2]), goal = Number(m[3]);

		assert.strictEqual(retire.teinenAge(from - 1), 60, page + '：引き上げ開始の前年が60歳でない');
		assert.ok(retire.teinenAge(from) > 60, page + '：引き上げ開始年に上がっていない');
		assert.strictEqual(retire.teinenAge(until), goal, page + '：終了年度に' + goal + '歳へ届いていない');
		assert.ok(retire.teinenAge(until - 1) < goal, page + '：終了年度より前に到達している');
		assert.strictEqual(retire.teinenAge(until + 20), goal, page + '：' + goal + '歳で頭打ちになっていない');
	}
});

/* ---------- 年金の損益分岐点 ---------- */

test('年金：繰上げ・繰下げの増減率の説明がpRateと一致する', () => {
	const text = prose('pension/index.html');
	const down = must(text, /繰上げ減額率: ([\d.]+)%\/月（最大(\d+)%減）/, 'pension/index.html');
	const up = must(text, /繰下げ増額率: ([\d.]+)%\/月（最大(\d+)%増）/, 'pension/index.html');

	const downPerMonth = Number(down[1]) / 100, downMax = Number(down[2]) / 100;
	const upPerMonth = Number(up[1]) / 100, upMax = Number(up[2]) / 100;

	// 1か月ぶんの増減が書かれている率どおりか
	assert.ok(Math.abs((pension.pRate(65) - pension.pRate(65 - 1 / 12)) - downPerMonth) < 1e-12,
		'繰上げの1か月あたりの減額率');
	assert.ok(Math.abs((pension.pRate(65 + 1 / 12) - pension.pRate(65)) - upPerMonth) < 1e-12,
		'繰下げの1か月あたりの増額率');

	// 上限・下限（60歳と75歳）が書かれている最大の増減と一致するか
	assert.ok(Math.abs(pension.pRate(60) - (1 - downMax)) < 1e-12, '60歳開始の減額（最大' + down[2] + '%減）');
	assert.ok(Math.abs(pension.pRate(75) - (1 + upMax)) < 1e-12, '75歳開始の増額（最大' + up[2] + '%増）');
	// 75歳より後ろは増えない
	assert.strictEqual(pension.pRate(80), pension.pRate(75), '繰下げの頭打ち');
});

test('年金：受給開始年齢ごとの年金額の割合が表示と一致する', () => {
	const m = must(prose('pension/index.html'),
		/60歳：(\d+)%、70歳：(\d+)%、75歳：(\d+)%/, 'pension/index.html');
	const stated = { 60: Number(m[1]), 70: Number(m[2]), 75: Number(m[3]) };

	for (const age of [60, 70, 75]) {
		// 表示は整数％に丸めた値
		assert.strictEqual(Math.round(pension.pRate(age) * 100), stated[age],
			age + '歳開始の年金額の割合');
	}
	assert.strictEqual(Math.round(pension.pRate(65) * 100), 100, '65歳開始が基準（100%）');
});

test('年金：課税率の表示が定数と一致する', () => {
	const m = must(prose('pension/index.html'), /（課税率 ([\d.]+)%）/, 'pension/index.html');
	ratioEquals(m[1], pension.TAX_RATE, '課税率');
	// 資産運用シミュレーターと同じ税率を使っている
	assert.strictEqual(pension.TAX_RATE, asset.TAX_RATE, '2つのツールで税率が食い違っている');
});

test('年金：想定利回りのスライダーの範囲が説明と一致する', () => {
	const m = must(prose('pension/index.html'), /([\d.]+)%〜([\d.]+)%の範囲で設定できます/, 'pension/index.html');
	const slider = must(read('pension/index.html'), /id="rSlider"[^>]*min="([\d.]+)"[^>]*max="([\d.]+)"/, 'pension/index.html');
	assert.strictEqual(Number(slider[1]), Number(m[1]), 'スライダーの下限');
	assert.strictEqual(Number(slider[2]), Number(m[2]), 'スライダーの上限');
});

/* ---------- 制度データの時点 ---------- */

test('「制度データ」の時点が全ページでそろっている', () => {
	/* ページごとに違う日付が並ぶと、どれが最新なのか分からなくなる。
	   制度を直したときは全ページまとめて更新する */
	const pages = ['assetSimulator/index.html', 'inheritance/index.html', 'pension/index.html']
		.concat(RETIRE_PAGES);
	const seen = new Map();
	for (const page of pages) {
		const m = must(prose(page), /制度データ: (\d{4})年(\d{1,2})月時点/, page);
		seen.set(page, m[1] + '-' + m[2]);
	}
	const values = [...new Set(seen.values())];
	assert.strictEqual(values.length, 1,
		'ページによって時点が違う: ' + JSON.stringify([...seen], null, 1));
});

/* ---------- iDeCoシミュレーター ---------- */

const ideco = require('../ideco/js/ideco-core.js');

/* 区分ごとの限度額の一覧は注記から落とし、加入区分の下に選んだ区分の額を
   出す形にした（limitNote）。JSが定数から組み立てるので腐らない。
   静的な文に残っている額は、掛金相当額の吹き出しにある第2号の改正後の枠だけ */
test('iDeCo：掛金相当額の説明にある第2号の枠が定数と一致する', () => {
	const m = must(prose('ideco/index.html'),
		/第2号被保険者の枠は「月([\d.]+)万円 −/, 'ideco/index.html');
	assert.strictEqual(Number(m[1]) * 10000, ideco.CONTRIBUTION_LIMITS.employee.reformed,
		'第2号の改正後の枠');
});

test('iDeCo：注記の改正の時期が定数と一致する', () => {
	const text = prose('ideco/index.html');
	const m = must(text, /適用は(\d{4})年1月拠出分から/, 'ideco/index.html');
	assert.strictEqual(Number(m[1]), ideco.LIMIT_REFORM_YEAR, '改正後の限度額を使い始める年');
});

test('iDeCo：注記の加入年齢の上限が定数と一致する', () => {
	const text = prose('ideco/index.html');
	const m = must(text, /(\d+)歳未満から(\d+)歳未満になり/, 'ideco/index.html');
	assert.strictEqual(Number(m[1]), ideco.JOIN_AGE_LIMIT.current, '現行の上限');
	assert.strictEqual(Number(m[2]), ideco.JOIN_AGE_LIMIT.reformed, '改正後の上限');
});

test('iDeCo：注記の重複期間のルールが定数と一致する', () => {
	const text = prose('ideco/index.html');
	/* 2つの年数は文中で離れており、間に括弧書き（句点を含む）が挟まる。
	   1本の正規表現でまたごうとすると壊れやすいので、別々に拾う */
	const first = must(text, /iDeCoを先に受け取った場合は前年以前(\d+)年内/, 'ideco/index.html');
	assert.strictEqual(Number(first[1]), ideco.OVERLAP_YEARS_IDECO_FIRST, 'iDeCoが先の場合');
	const later = must(text, /退職金を先に受け取った場合は前年以前(\d+)年内/, 'ideco/index.html');
	assert.strictEqual(Number(later[1]), ideco.OVERLAP_YEARS_RETIRE_FIRST, '退職金が先の場合');
});

test('iDeCo：注記の第5号加入者の年齢が定数と一致する', () => {
	const text = prose('ideco/index.html');
	const m = must(text, /改正後は(\d+)歳以上(\d+)歳未満で国民年金の被保険者でない人も「第5号加入者」/,
		'ideco/index.html');
	assert.strictEqual(Number(m[1]), ideco.NATIONAL_PENSION_END_AGE, '国民年金の被保険者でなくなる年齢');
	assert.strictEqual(Number(m[2]), ideco.JOIN_AGE_LIMIT.reformed, '改正後の加入年齢の上限');
	/* 枠の額は注記から落とし、当てはまる条件のときだけ limitWarn が出すようにした。
	   第5号は第2号と同じ額なので、片方だけ直したときに気づけるようにしておく */
	assert.strictEqual(ideco.LATE_JOIN_CATEGORY_LIMIT, ideco.CONTRIBUTION_LIMITS.employee.reformed);
});

/* 受給開始年齢と増減率の説明は、注記から受給開始年齢の欄の吹き出しに移した
   （prose() はタグを外すので、吹き出しの文もそのまま見える） */
test('iDeCo：受給開始年齢の説明の年齢と増減率が定数と一致する', () => {
	const text = prose('ideco/index.html');
	const m = must(text, /原則は(\d+)歳ですが、(\d+)歳から(\d+)歳の間で選べます/, 'ideco/index.html');
	assert.strictEqual(Number(m[1]), ideco.PUBLIC_PENSION_START_AGE, '原則の受給開始年齢');
	assert.strictEqual(Number(m[2]), ideco.PUBLIC_PENSION_MIN_AGE, '繰上げの下限');
	assert.strictEqual(Number(m[3]), ideco.PUBLIC_PENSION_MAX_AGE, '繰下げの上限');

	// 1か月あたりの率と、下限・上限で何%になるか
	const r = must(text, /早めると1か月あたり([\d.]+)%減り（(\d+)歳で(\d+)%減）、遅らせると1か月あたり([\d.]+)%増えます（(\d+)歳で(\d+)%増）/,
		'ideco/index.html');
	ratioEquals(r[1], ideco.PENSION_EARLY_RATE, '繰上げの1か月あたりの減額率');
	ratioEquals(r[4], ideco.PENSION_LATE_RATE, '繰下げの1か月あたりの増額率');
	assert.ok(Math.abs(ideco.publicPensionRate(Number(r[2])) - (1 - Number(r[3]) / 100)) < 1e-12,
		r[2] + '歳まで早めたときの減額');
	assert.ok(Math.abs(ideco.publicPensionRate(Number(r[5])) - (1 + Number(r[6]) / 100)) < 1e-12,
		r[5] + '歳まで遅らせたときの増額');
});

test('iDeCo：受給開始年齢の入力欄の範囲が定数と一致する', () => {
	const m = must(read('ideco/index.html'),
		/id="publicPensionAge"[^>]*min="(\d+)"[^>]*max="(\d+)"/, 'ideco/index.html');
	assert.strictEqual(Number(m[1]), ideco.PUBLIC_PENSION_MIN_AGE, '繰上げの下限');
	assert.strictEqual(Number(m[2]), ideco.PUBLIC_PENSION_MAX_AGE, '繰下げの上限');
});

test('iDeCo：繰上げ・繰下げの率が年金シミュレーターと一致する', () => {
	/* 同じ制度の率を2つのツールで別々に持っているので、食い違わないか見る。
	   どちらかを改正で直したとき、もう片方を直し忘れるとここで落ちる */
	for (let age = ideco.PUBLIC_PENSION_MIN_AGE; age <= ideco.PUBLIC_PENSION_MAX_AGE; age++) {
		assert.ok(Math.abs(ideco.publicPensionRate(age) - pension.pRate(age)) < 1e-12,
			age + '歳受給開始の増減率が2つのツールで違う');
	}
	// 上限を超えたときの頭打ちも同じ
	assert.ok(Math.abs(ideco.publicPensionRate(80) - pension.pRate(80)) < 1e-12, '繰下げの頭打ち');
});

test('iDeCo：注記の短期退職手当等の条件が定数と一致する', () => {
	const text = prose('ideco/index.html');
	const m = must(text, /加入期間が(\d+)年以下の場合は短期退職手当等にあたり、残りのうち([\d,]+)万円を超える部分/,
		'ideco/index.html');
	assert.strictEqual(Number(m[1]), tax.SHORT_TENURE_YEARS, '短期の判定になる勤続年数');
	assert.strictEqual(yen(m[2]) * 10000, tax.SHORT_TENURE_HALF_LIMIT, '2分の1にできる上限');
});

test('iDeCo：注記の譲渡益税率が定数と一致する', () => {
	const text = prose('ideco/index.html');
	const m = must(text, /売却益に([\d.]+)%（所得税(\d+)%＋復興特別所得税([\d.]+)%＋住民税(\d+)%）/, 'ideco/index.html');
	ratioEquals(m[1], ideco.TAXABLE_GAIN_TAX_RATE, '課税口座の譲渡益税率');
	// 書かれている内訳の合計が、率そのものと合っているか
	const parts = (Number(m[2]) + Number(m[3]) + Number(m[4])) / 100;
	assert.ok(Math.abs(parts - ideco.TAXABLE_GAIN_TAX_RATE) < 1e-12,
		'内訳の合計が率と合わない 内訳 ' + parts + ' / 定数 ' + ideco.TAXABLE_GAIN_TAX_RATE);
	// 資産運用シミュレーターと同じ率（片方だけ直すと食い違う）
	assert.strictEqual(ideco.TAXABLE_GAIN_TAX_RATE, asset.TAX_RATE,
		'譲渡益税率が2つのツールで違う');
});

test('iDeCo：受取年齢の入力欄の範囲が定数と一致する', () => {
	const html = read('ideco/index.html');
	const m = must(html, /id="payAge"[^>]*min="(\d+)"[^>]*max="(\d+)"/, 'ideco/index.html');
	assert.strictEqual(Number(m[1]), ideco.PAYOUT_AGE_MIN, '受給開始の下限');
	assert.strictEqual(Number(m[2]), ideco.PAYOUT_AGE_MAX, '受給開始の上限');
});

test('iDeCo：区分の選択肢が定数の一覧とそろっている', () => {
	const html = read('ideco/index.html');
	const options = [...html.matchAll(/<option value="(self|employee|corporate|publicSv|spouse)"[^>]*>/g)]
		.map(m => m[1]);
	const keys = Object.keys(ideco.CONTRIBUTION_LIMITS);
	assert.deepStrictEqual(options.slice().sort(), keys.slice().sort(),
		'画面の選択肢と拠出限度額の表が食い違っている');
});

test('iDeCo：選択肢の初期値がJS側の初期値と一致する', () => {
	/* select に selected を付け忘れると、先頭の選択肢で開いてしまい、
	   「入力をリセット」した後と初回表示で結果が食い違う */
	const html = read('ideco/index.html');
	const js = read('ideco/js/ideco.js');
	for (const id of ['category']) {
		const open = '<select id="' + id + '">';
		const from = html.indexOf(open);
		assert.ok(from >= 0, 'ideco/index.html に ' + open + ' が無い');
		const block = html.slice(from, html.indexOf('</select>', from));

		const selected = block.match(/<option value="([^"]+)"[^>]*\sselected/);
		const first = must(block, /<option value="([^"]+)"/, id + ' の選択肢');
		const actual = selected ? selected[1] : first[1];

		const mark = "['" + id + "', '";
		const at = js.indexOf(mark);
		assert.ok(at >= 0, 'ideco/js/ideco.js の FIELDS に ' + id + ' が無い');
		const def = js.slice(at + mark.length, js.indexOf("'", at + mark.length));

		assert.strictEqual(actual, def,
			id + ' の初期表示（' + actual + '）とJSの初期値（' + def + '）が食い違っている');
	}
});

/* 「8年以上で61歳、6年で62歳…」の一覧は注記から落とし、入力した加入年齢で
   何歳から受け取れるかを payAgeWarn が出す形にした。注記に残したのは
   「10年以上で60歳から」「2年ごとに繰り下がり、最も遅くて65歳」の要約なので、
   その要約が表と食い違っていないかを見る */
test('iDeCo：注記の受給開始年齢の要約が定数と一致する', () => {
	const text = prose('ideco/index.html');
	const table = ideco.PAYOUT_START_BY_PERIOD;

	// 10年以上で60歳から
	const base = must(text, /(\d+)歳から受け取るには、(\d+)歳になるまでの通算加入者等期間が(\d+)年以上必要/,
		'ideco/index.html');
	assert.strictEqual(Number(base[1]), table[0].age, '10年以上のときの受給開始年齢');
	assert.strictEqual(table[0].age, ideco.PAYOUT_AGE_MIN);
	assert.strictEqual(Number(base[2]), ideco.LATE_JOIN_AGE, '期間を数える年齢');
	assert.strictEqual(Number(base[3]), table[0].minYears, '60歳から受け取る条件');

	// 足りない場合は2年ごとに繰り下がり、最も遅くて65歳
	const step = must(text, /受け取れる年齢が(\d+)年ごとに繰り下がり、最も遅くて(\d+)歳から/,
		'ideco/index.html');
	assert.strictEqual(Number(step[2]), table[table.length - 1].age, '最も遅い受給開始年齢');
	/* 最後の行（1年以上）は「2年に満たない残り」を拾うためのもので刻みから外れる。
	   そこまでの間隔が注記の年数どおりかを見る */
	for (let i = 1; i < table.length - 1; i++) {
		assert.strictEqual(table[i - 1].minYears - table[i].minYears, Number(step[1]),
			table[i].age + '歳の区分までの年数の刻み');
		assert.strictEqual(table[i].age - table[i - 1].age, 1, table[i].age + '歳の区分の繰り下がり');
	}

	// 60歳以降に加入した場合の特例
	const late = must(text, /(\d+)歳以降に初めて加入した場合は、加入から(\d+)年経過後/, 'ideco/index.html');
	assert.strictEqual(Number(late[1]), ideco.LATE_JOIN_AGE);
	assert.strictEqual(Number(late[2]), ideco.LATE_JOIN_WAIT);
});

test('iDeCo：注記の「110万円まで非課税」が公的年金等控除の表と一致する', () => {
	/* 65歳以上は収入110万円までが非課税、という説明。
	   tax-core の速算表の下端（65歳以上の最初の区分）と同じでなければならない */
	const m = must(prose('ideco/index.html'),
		/65歳以上なら合わせて([\d,]+)万円まで（65歳未満は([\d,]+)万円まで）は課税されない/, 'ideco/index.html');
	/* 60歳から年金で受け取ることもできるので、65歳未満の枠も書いてある。
	   どちらも速算表の下端（min:0 の受け皿の1つ上）と同じでなければならない */
	for (const [stated, key, age] of [[yen(m[1]) * 10000, 'from65', 65], [yen(m[2]) * 10000, 'under65', 64]]) {
		const table = tax.PENSION_INCOME_BRACKETS[key];
		const threshold = table[table.length - 2].min;   // 最後は min:0 の受け皿
		assert.strictEqual(stated, threshold, age + '歳の注記の額と速算表の区分が違う');
		// その額までは雑所得が出ないこと自体も確かめる
		assert.strictEqual(tax.pensionMiscIncome(stated, age), 0, age + '歳');
		assert.ok(tax.pensionMiscIncome(stated + 10000, age) > 0, age + '歳');
	}
});
