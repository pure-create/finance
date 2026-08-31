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
  { over: 18000000, rate: 0.4, deduction: 2796000 },
  { over: 9000000, rate: 0.33, deduction: 1536000 },
  { over: 6950000, rate: 0.23, deduction: 636000 },
  { over: 3300000, rate: 0.2, deduction: 427500 },
  { over: 1950000, rate: 0.1, deduction: 97500 },
  { over: 0, rate: 0.05, deduction: 0 },
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
var INHABITANT_TAX_RATE = 0.1;

function inhabitantTax(taxableIncome) {
  return roundedTaxableIncome(taxableIncome) * INHABITANT_TAX_RATE;
}

/* ---------- 退職所得 ---------- */

/* 退職所得控除額の元になる金額（80万円の最低保障を当てる前）。
   前に受けた退職手当等との重複期間ぶんを差し引くときは、こちらを使う。

   最低保障は「計算した控除額が80万円に満たない場合」の規定で、
   差し引く重複期間ぶん（所得税法施行令70条1項）には及ばない。
   分けずに retireDeduction を使うと、重複が1年のときだけ
   40万円ではなく80万円が引かれてしまう（2年でも80万円なので段差が二重になる） */
function retireDeductionBase(years) {
  if (years <= 20) {
    return years * 400000;
  }
  return 8000000 + (years - 20) * 700000;
}

// 退職所得控除額（勤続年数から。20年までは1年40万円、超えた分は1年70万円。下限80万円）
function retireDeduction(years) {
  return Math.max(800000, retireDeductionBase(years));
}

/* 短期退職手当等（令和4年分以後）。
   役員等以外で勤続年数が5年以下の場合、退職所得控除を引いた残額のうち
   300万円までは1/2にできるが、それを超える部分は1/2にしない。
   iDeCoの一時金も加入期間を勤続年数として同じ判定を受けるので、
   60歳以降に加入して5年で受け取る場合などが当てはまる。
   （国税庁 No.1420「退職金を受け取ったとき」） */
var SHORT_TENURE_YEARS = 5;
var SHORT_TENURE_HALF_LIMIT = 3000000;

/* 退職所得の金額（1,000円未満を切り捨てる前）。

   years を渡したときだけ短期退職手当等の判定をする。渡さなければ必ず1/2にする
   （退職手当ページは勤続5年以下で残額が300万円を超えることがないため渡していない）。
   役員等としての勤続が5年以下の場合（特定役員退職手当等。1/2が一切ない）は扱わない */
function retireIncome(price, koujo, years) {
  var rest = price - koujo;
  if (rest <= 0) {
    return 0;
  }
  if (
    typeof years === "number" &&
    years <= SHORT_TENURE_YEARS &&
    rest > SHORT_TENURE_HALF_LIMIT
  ) {
    return SHORT_TENURE_HALF_LIMIT / 2 + (rest - SHORT_TENURE_HALF_LIMIT);
  }
  return rest / 2;
}

/* 退職手当の所得税・住民税。
   退職所得は「（収入−退職所得控除）÷2」で、他の所得と分離して課税する。
   控除額を引数で受けるので、前に受けた退職手当との重複期間で
   調整した控除額（iDeCoの10年ルール）もそのまま渡せる。
   years は短期退職手当等の判定用（上の retireIncome を参照） */
function calcTax(price, koujo, years) {
  var kazei = roundedTaxableIncome(retireIncome(price, koujo, years));
  if (kazei <= 0) {
    return { tax: 0, inhabitTax: 0 };
  }
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
    { min: 10000000, rate: 1.0, deduction: 1955000 },
    { min: 7700000, rate: 0.95, deduction: 1455000 },
    { min: 4100000, rate: 0.85, deduction: 685000 },
    { min: 1300000, rate: 0.75, deduction: 275000 },
    { min: 600000, rate: 1.0, deduction: 600000 },
    { min: 0, rate: 0.0, deduction: 0 },
  ],
  from65: [
    { min: 10000000, rate: 1.0, deduction: 1955000 },
    { min: 7700000, rate: 0.95, deduction: 1455000 },
    { min: 4100000, rate: 0.85, deduction: 685000 },
    { min: 3300000, rate: 0.75, deduction: 275000 },
    { min: 1100000, rate: 1.0, deduction: 1100000 },
    { min: 0, rate: 0.0, deduction: 0 },
  ],
};

// 公的年金等の収入金額と年齢から、公的年金等に係る雑所得を求める
function pensionMiscIncome(revenue, age) {
  if (!(revenue > 0)) return 0;
  var table =
    age >= 65
      ? PENSION_INCOME_BRACKETS.from65
      : PENSION_INCOME_BRACKETS.under65;
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
  retireDeductionBase: retireDeductionBase,
  retireDeduction: retireDeduction,
  retireIncome: retireIncome,
  calcTax: calcTax,
  pensionMiscIncome: pensionMiscIncome,
  pensionDeduction: pensionDeduction,
  SHORT_TENURE_YEARS: SHORT_TENURE_YEARS,
  SHORT_TENURE_HALF_LIMIT: SHORT_TENURE_HALF_LIMIT,
};
if (typeof window !== "undefined") window.Tax = Tax;

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    roundedTaxableIncome: roundedTaxableIncome,
    incomeTax: incomeTax,
    inhabitantTax: inhabitantTax,
    retireDeductionBase: retireDeductionBase,
    retireDeduction: retireDeduction,
    retireIncome: retireIncome,
    calcTax: calcTax,
    pensionMiscIncome: pensionMiscIncome,
    pensionDeduction: pensionDeduction,
    INCOME_TAX_BRACKETS: INCOME_TAX_BRACKETS,
    INHABITANT_TAX_RATE: INHABITANT_TAX_RATE,
    RECONSTRUCTION_RATE: RECONSTRUCTION_RATE,
    PENSION_INCOME_BRACKETS: PENSION_INCOME_BRACKETS,
    SHORT_TENURE_YEARS: SHORT_TENURE_YEARS,
    SHORT_TENURE_HALF_LIMIT: SHORT_TENURE_HALF_LIMIT,
  };
}
