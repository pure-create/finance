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
			const got = retire.calcTax(koujo + kazei * 2, koujo).tax;
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

			const atLo = retire.calcTax(koujo + lo * 2, koujo).tax;
			assert.ok(Math.abs(atLo - Math.floor((lo * rate - ded) * 1.021)) <= 1,
				page + '：' + r[1] + '円ちょうどが表の区分と合わない');

			const below = lo - 1000;
			const belowByThisRow = Math.floor((below * rate - ded) * 1.021);
			const belowActual = retire.calcTax(koujo + below * 2, koujo).tax;
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
			assert.strictEqual(retire.retireDeduction(y), want,
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
