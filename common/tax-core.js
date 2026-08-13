/* =============================================================
   サイト共通の税額の計算

   所得税の速算表は、退職手当の税額（退職所得）と、iDeCoの掛金による
   節税額（通常の所得）の両方で使う。片方にベタ書きすると必ず食い違うので、
   ここ1箇所に置いて双方から呼ぶ。

   画面を一切触らないので、テストからも読み込める
   （assetSimulator/js/asset-core.js と同じ切り分け方）。

   各ページですること:
     このファイルを、これを使うページのスクリプトより前に読み込む。
   ============================================================= */

/* ---------- 所得税 ---------- */

/* 課税所得金額は1,000円未満を切り捨ててから速算表に当てる。
   端数処理の位置が違うと税額が変わるので、表を使う側で毎回やらず、
   incomeTax の中で必ず通す */
function roundedTaxableIncome(amount) {
	return amount > 0 ? Math.floor(amount / 1000) * 1000 : 0;
}

/* 所得税の速算表（課税所得金額 → 税率・控除額）。
   金額は円。復興特別所得税（2.1%）は下の incomeTax で最後に掛ける。
   退職手当ページの説明文に同じ表が載っており、
   test/stated-rates.test.js がその表とここを突き合わせている */
var INCOME_TAX_BRACKETS = [
	{ over: 40000000, rate: 0.45, deduction: 4796000 },
	{ over: 18000000, rate: 0.40, deduction: 2796000 },
	{ over:  9000000, rate: 0.33, deduction: 1536000 },
	{ over:  6950000, rate: 0.23, deduction:  636000 },
	{ over:  3300000, rate: 0.20, deduction:  427500 },
	{ over:  1950000, rate: 0.10, deduction:   97500 },
	{ over:        0, rate: 0.05, deduction:       0 }
];

// 復興特別所得税の上乗せ（2013年〜2037年）
var RECONSTRUCTION_RATE = 1.021;

/* 課税所得金額から所得税額（復興特別所得税込み、円未満切捨て）を求める。
   通常の所得にも退職所得にも同じ表を使う（退職所得は「1/2してから」
   ここへ渡すという違いだけ） */
function incomeTax(taxableIncome) {
	var kazei = roundedTaxableIncome(taxableIncome);
	if (kazei <= 0) return 0;
	for (var i = 0; i < INCOME_TAX_BRACKETS.length; i++) {
		var b = INCOME_TAX_BRACKETS[i];
		if (kazei > b.over) {
			return Math.floor((kazei * b.rate - b.deduction) * RECONSTRUCTION_RATE);
		}
	}
	return 0;
}

// 住民税（所得割）。都道府県4%＋市町村6%で一律10%
var INHABITANT_TAX_RATE = 0.10;

function inhabitantTax(taxableIncome) {
	return roundedTaxableIncome(taxableIncome) * INHABITANT_TAX_RATE;
}

/* ---------- 退職所得 ---------- */

// 退職所得控除額（勤続年数から。20年までは1年40万円、超えた分は1年70万円。下限80万円）
function retireDeduction(years) {
	var koujo;
	if (years <= 20) {
		koujo = years * 400000;
	} else {
		koujo = 8000000 + (years - 20) * 700000;
	}
	if (koujo < 800000) {
		koujo = 800000;
	}
	return koujo;
}

/* 退職手当の所得税・住民税。
   退職所得は「（収入−退職所得控除）÷2」で、他の所得と分離して課税する。
   控除額を引数で受けるので、前に受けた退職手当との重複期間で
   調整した控除額（iDeCoの10年ルール）もそのまま渡せる */
function calcTax(price, koujo) {
	if (price <= koujo) {
		return { tax: 0, inhabitTax: 0 };
	}
	var kazei = roundedTaxableIncome((price - koujo) / 2);
	return { tax: incomeTax(kazei), inhabitTax: inhabitantTax(kazei) };
}

/* ---------- 公的年金等 ---------- */

/* 公的年金等に係る雑所得の速算表（令和2年分以後、公的年金等以外の
   合計所得金額が1,000万円以下の場合）。国税庁「高齢者と税（年金と税）」より。
   収入がその区分の下限（min）以上のときに、収入×rate−deduction が雑所得になる。
   下限そのものが「ここまでは雑所得ゼロ」の額も兼ねている（65歳未満60万円・65歳以上110万円）。

   65歳未満と65歳以上で下2つの区分だけが違い、410万円から上は共通 */
var PENSION_INCOME_BRACKETS = {
	under65: [
		{ min: 10000000, rate: 1.00, deduction: 1955000 },
		{ min:  7700000, rate: 0.95, deduction: 1455000 },
		{ min:  4100000, rate: 0.85, deduction:  685000 },
		{ min:  1300000, rate: 0.75, deduction:  275000 },
		{ min:   600000, rate: 1.00, deduction:  600000 },
		{ min:        0, rate: 0.00, deduction:       0 }
	],
	from65: [
		{ min: 10000000, rate: 1.00, deduction: 1955000 },
		{ min:  7700000, rate: 0.95, deduction: 1455000 },
		{ min:  4100000, rate: 0.85, deduction:  685000 },
		{ min:  3300000, rate: 0.75, deduction:  275000 },
		{ min:  1100000, rate: 1.00, deduction: 1100000 },
		{ min:        0, rate: 0.00, deduction:       0 }
	]
};

// 公的年金等の収入金額と年齢から、公的年金等に係る雑所得を求める
function pensionMiscIncome(revenue, age) {
	if (!(revenue > 0)) return 0;
	var table = age >= 65 ? PENSION_INCOME_BRACKETS.from65 : PENSION_INCOME_BRACKETS.under65;
	for (var i = 0; i < table.length; i++) {
		var b = table[i];
		if (revenue >= b.min) {
			return Math.max(0, revenue * b.rate - b.deduction);
		}
	}
	return 0;
}

// 公的年金等控除額（収入 − 雑所得）。画面に内訳を出すために使う
function pensionDeduction(revenue, age) {
	if (!(revenue > 0)) return 0;
	return revenue - pensionMiscIncome(revenue, age);
}

/* この一式は、まとめて渡せる形でも公開する。
   iDeCoの計算（ideco/js/ideco-core.js）は税額の関数を引数で受け取る作りなので、
   ブラウザからは Tax を、テストからは require した結果をそのまま渡せる
   （Theme や Share と同じく、window に1つだけ名前を置く形） */
var Tax = {
	roundedTaxableIncome: roundedTaxableIncome,
	incomeTax: incomeTax,
	inhabitantTax: inhabitantTax,
	retireDeduction: retireDeduction,
	calcTax: calcTax,
	pensionMiscIncome: pensionMiscIncome,
	pensionDeduction: pensionDeduction
};
if (typeof window !== 'undefined') window.Tax = Tax;

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		roundedTaxableIncome: roundedTaxableIncome,
		incomeTax: incomeTax,
		inhabitantTax: inhabitantTax,
		retireDeduction: retireDeduction,
		calcTax: calcTax,
		pensionMiscIncome: pensionMiscIncome,
		pensionDeduction: pensionDeduction,
		INCOME_TAX_BRACKETS: INCOME_TAX_BRACKETS,
		INHABITANT_TAX_RATE: INHABITANT_TAX_RATE,
		RECONSTRUCTION_RATE: RECONSTRUCTION_RATE,
		PENSION_INCOME_BRACKETS: PENSION_INCOME_BRACKETS
	};
}
