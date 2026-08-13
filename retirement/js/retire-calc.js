/* 退職手当の計算部分。画面を一切触らないので、テストからも読み込める
   （資産運用シミュレーターの asset-core.js と同じ切り分け方）。

   ここに置くのは「制度で決まっている数字と式」だけ。入力の読み取りや
   表の組み立ては js/retire-core.js 側にある。支給率や税率を改正で直すときは
   このファイルと test/retire-calc.test.js だけを見ればよい。 */

// 自己都合支給率(0～50年)
var own_rate = new Array(
	0.5022, 0.5022, 1.0044, 1.5066, 2.0088, 2.511,
	3.0132, 3.5154, 4.0176, 4.5198, 5.022,
	7.43256, 8.16912, 8.90568, 9.64224, 10.3788,
	12.88143, 14.08671, 15.29199, 16.49727, 19.6695,
	21.3435, 23.0175, 24.6915, 26.3655, 28.0395,
	29.3787, 30.7179, 32.0571, 33.3963, 34.7355,
	35.7399, 36.7443, 37.7487, 38.7531, 39.7575,
	40.7619, 41.7663, 42.7707, 43.7751, 44.7795,
	45.7839, 46.7883, 47.709, 47.709, 47.709,
	47.709, 47.709, 47.709, 47.709, 47.709
);

// 定年・勧奨支給率(0～50年)
var compulsory_rate = new Array(
	0.837, 0.837, 1.674, 2.511, 3.348, 4.185,
	5.022, 5.859, 6.696, 7.533, 8.37,
	11.613375, 12.764250, 13.915125, 15.066, 16.216875,
	17.890875, 19.564875, 21.238875, 22.912875, 24.586875,
	26.260875, 27.934875, 29.608875, 31.282875, 33.27075,
	34.77735, 36.28395, 37.79055, 39.29715, 40.80375,
	42.31035, 43.81695, 45.32355, 46.83015, 47.709,
	47.709, 47.709, 47.709, 47.709, 47.709,
	47.709, 47.709, 47.709, 47.709, 47.709,
	47.709, 47.709, 47.709, 47.709, 47.709
);

// 支給率配列の範囲外アクセスを防ぐ（範囲を超えた場合は最終値＝頭打ち後の率を使う）
function getRate(arr, years){
	var idx = Math.max(0, Math.min(years, arr.length - 1));
	return arr[idx];
}

// 退職所得控除額（勤続年数から。20年までは1年40万円、超えた分は1年70万円。下限80万円）
function retireDeduction(years){
	var koujo;
	if(years <= 20){
		koujo = years * 400000;
	}else{
		koujo = 8000000 + (years - 20) * 700000;
	}
	if(koujo < 800000){
		koujo = 800000;
	}
	return koujo;
}

// その年度の定年年齢（2023年度から2年に1歳ずつ、65歳まで段階的に引き上げ）
function teinenAge(fiscalYear){
	if(fiscalYear < 2023){
		return 60;
	}
	return Math.min(65, 61 + Math.floor((fiscalYear - 2023) / 2));
}

// 所得税・住民税の計算（自己都合／定年勧奨で共通のロジック）
function calcTax(price, koujo){
	if(price <= koujo){
		return { tax: 0, inhabitTax: 0 };
	}
	var kazei = Math.floor((price - koujo) / 2 / 1000) * 1000;
	var tax;
	if(kazei > 40000000){
		tax = (kazei * 0.45 - 4796000) * 1.021;
	}else if(kazei > 18000000){
		tax = (kazei * 0.4 - 2796000) * 1.021;
	}else if(kazei > 9000000){
		tax = (kazei * 0.33 - 1536000) * 1.021;
	}else if(kazei > 6950000){
		tax = (kazei * 0.23 - 636000) * 1.021;
	}else if(kazei > 3300000){
		tax = (kazei * 0.20 - 427500) * 1.021;
	}else if(kazei > 1950000){
		tax = (kazei * 0.10 - 97500) * 1.021;
	}else{
		tax = (kazei * 0.05) * 1.021;
	}
	return { tax: Math.floor(tax), inhabitTax: kazei / 10 };
}

/* ノードから読み込んだときに計算部分を公開する（テスト用） */
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		own_rate: own_rate, compulsory_rate: compulsory_rate,
		getRate: getRate, retireDeduction: retireDeduction,
		teinenAge: teinenAge, calcTax: calcTax
	};
}
