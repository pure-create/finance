const showa = 1926, heisei = 1989, reiwa = 2019;
var currentTime = new Date();
var thisYear = currentTime.getFullYear();
var thisMonth = currentTime.getMonth() + 1;
var stdYear; // 基準年
if(thisMonth <= 3){
	stdYear = thisYear - 1;
}else{
	stdYear = thisYear;
}
// 自己都合支給率(0～50年)
var own_rate = new Array(
	0.5022, 0.5022, 1.0044, 1.5066, 2.088, 2.511,
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

// opacityのトランジションによるフェード表示・非表示
function fadeIn(el, duration, displayValue){
	if(!el) return;
	el.style.transition = 'opacity ' + duration + 'ms';
	el.style.display = displayValue || 'block';
	el.style.opacity = 0;
	requestAnimationFrame(function(){
		el.style.opacity = 1;
	});
}

function fadeOut(el, duration){
	if(!el) return;
	el.style.transition = 'opacity ' + duration + 'ms';
	el.style.opacity = 1;
	requestAnimationFrame(function(){
		el.style.opacity = 0;
	});
	setTimeout(function(){
		el.style.display = 'none';
	}, duration);
}

// 生年・採用年のセレクトボックスに年度の選択肢を追加する（document.writeの代替）
function buildYearOptions(selectEl, fromYear, toYear){
	for(var y = fromYear; y <= toYear; y++){
		var era;
		if(y < heisei){
			era = "昭和" + (y - showa + 1);
		}else if(y < reiwa){
			era = "平成" + (y - heisei + 1);
		}else{
			era = "令和" + (y - reiwa + 1);
		}
		var opt = document.createElement('option');
		opt.value = y;
		opt.textContent = y + "(" + era + ")";
		selectEl.appendChild(opt);
	}
}

// クリップボードへのコピー（file://等の非セキュアコンテキストではフォールバックを使用）
function copyToClipboard(text){
	if(navigator.clipboard && window.isSecureContext){
		return navigator.clipboard.writeText(text);
	}
	return new Promise(function(resolve, reject){
		try{
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			var ok = document.execCommand('copy');
			document.body.removeChild(ta);
			ok ? resolve() : reject(new Error('copy failed'));
		}catch(e){
			reject(e);
		}
	});
}

var STORAGE_KEY = 'retireCalcState';

// 現在の入力内容をURLSearchParamsに変換する
function serializeState(){
	var params = new URLSearchParams();
	var birthYearEl = document.getElementById('birthYear');
	var hireYearEl = document.getElementById('hireYear');
	var middleYearEl = document.getElementById('middle_year');
	var salaryEl = document.getElementById('salary');
	if(birthYearEl.value) params.set('by', birthYearEl.value);
	if(hireYearEl.value) params.set('hy', hireYearEl.value);
	if(middleYearEl.checked) params.set('mid', '1');
	var salRaw = (salaryEl.value || '').toString().replace(/,/g, '').trim();
	if(salRaw) params.set('sal', salRaw);
	for(var i = 1; i <= 8; i++){
		var v = document.getElementById('tyosei' + i).value;
		if(v) params.set('t' + i, v);
	}
	return params;
}

// 現在の入力内容を反映した共有リンクのURLを組み立てる
function buildShareUrl(){
	var params = serializeState();
	var baseUrl = window.location.href.split('?')[0];
	return params.toString() ? baseUrl + '?' + params.toString() : baseUrl;
}

// 共有リンクのQRコードを描画する
function renderShareQr(){
	var qrEl = document.getElementById('shareQr');
	if(!qrEl) return;
	try{
		var qr = qrcode(0, 'M');
		qr.addData(buildShareUrl());
		qr.make();
		qrEl.innerHTML = qr.createSvgTag(4);
	}catch(e){
		qrEl.innerHTML = '';
	}
}

// localStorageに現在の入力内容を保存する
function saveState(){
	try{
		localStorage.setItem(STORAGE_KEY, serializeState().toString());
	}catch(e){
		// プライベートブラウジング等で保存できない場合は何もしない
	}
}

// URLSearchParamsの内容をフォームに反映する
function applyStateFromParams(params){
	var birthYearEl = document.getElementById('birthYear');
	var hireYearEl = document.getElementById('hireYear');
	var middleYearEl = document.getElementById('middle_year');
	var salaryEl = document.getElementById('salary');
	if(params.has('by')) birthYearEl.value = params.get('by');
	if(params.has('hy')) hireYearEl.value = params.get('hy');
	if(params.get('mid') === '1') middleYearEl.checked = true;
	if(params.has('sal')){
		salaryEl.value = params.get('sal');
		formatSalaryDisplay(salaryEl);
	}
	for(var i = 1; i <= 8; i++){
		if(params.has('t' + i)) document.getElementById('tyosei' + i).value = params.get('t' + i);
	}
}

// URLクエリ（共有リンク）優先、なければlocalStorageから入力内容を復元する
function restoreState(){
	var urlParams = new URLSearchParams(window.location.search);
	if(urlParams.toString()){
		applyStateFromParams(urlParams);
		return;
	}
	try{
		var saved = localStorage.getItem(STORAGE_KEY);
		if(saved){
			applyStateFromParams(new URLSearchParams(saved));
		}
	}catch(e){
		// 読み込めない場合は何もしない
	}
}

// 金額欄をカンマ区切り表示にする（編集中はunformatSalaryForEditで数字のみに戻す）
function formatSalaryDisplay(el){
	if(!el) return;
	var raw = (el.value || '').toString().replace(/[^\d]/g, '');
	el.value = raw ? Number(raw).toLocaleString() : '';
}

function unformatSalaryForEdit(el){
	if(!el) return;
	el.value = (el.value || '').toString().replace(/,/g, '');
}

// すべての入力をクリアする
function clearAll(){
	document.getElementById('birthYear').value = '';
	document.getElementById('hireYear').value = '';
	document.getElementById('middle_year').checked = false;
	document.getElementById('salary').value = '';
	for(var i = 1; i <= 8; i++){
		document.getElementById('tyosei' + i).value = '';
	}
	try{
		localStorage.removeItem(STORAGE_KEY);
	}catch(e){
		// 何もしない
	}
	try{
		if(window.history && window.history.replaceState){
			window.history.replaceState(null, '', window.location.pathname);
		}
	}catch(e){
		// file://での閲覧など、履歴操作が許可されない環境では何もしない
	}
	calc();
}

window.addEventListener('load', function(){
	buildYearOptions(document.getElementById('birthYear'), thisYear - 67, thisYear - 18);
	buildYearOptions(document.getElementById('hireYear'), thisYear - 42, thisYear - 2);

	restoreState();

	document.querySelectorAll('input, select').forEach(function(el){
		el.addEventListener('input', calc);
		el.addEventListener('change', calc);
	});

	[document.getElementById('salary')].forEach(function(el){
		if(!el) return;
		el.addEventListener('focus', function(){ unformatSalaryForEdit(el); });
		el.addEventListener('blur', function(){ formatSalaryDisplay(el); });
	});

	var clearBtn = document.getElementById('clearBtn');
	if(clearBtn){
		clearBtn.addEventListener('click', clearAll);
	}

	var shareBtn = document.getElementById('shareBtn');
	var shareMsgEl = document.getElementById('shareMsg');
	var shareMsgTimer;
	if(shareBtn){
		shareBtn.addEventListener('click', function(){
			var url = buildShareUrl();
			clearTimeout(shareMsgTimer);
			copyToClipboard(url).then(function(){
				shareMsgEl.innerHTML = '共有リンクをコピーしました。<br>リンクには入力内容が含まれます。';
				shareMsgEl.classList.add('show');
				shareMsgTimer = setTimeout(function(){ shareMsgEl.classList.remove('show'); }, 3000);
			}).catch(function(){
				shareMsgEl.textContent = 'コピーに失敗しました。URL: ' + url;
				shareMsgEl.classList.add('show');
				shareMsgTimer = setTimeout(function(){ shareMsgEl.classList.remove('show'); }, 3000);
			});
		});
	}

	// 計算結果の各行をクリックすると、直後の説明行を開閉する
	document.addEventListener('click', function(e){
		var disp = e.target.closest('tr.calc_disp');
		if(!disp){
			return;
		}
		var memo = disp.nextElementSibling;
		if(!(memo && memo.classList.contains('calc_memo'))){
			return;
		}
		var willOpen = !memo.classList.contains('open');
		// いったんすべての説明行を閉じる（同時に開くのは1行だけ）
		document.querySelectorAll('tr.calc_memo.open').forEach(function(tr){
			tr.classList.remove('open');
		});
		// 閉じている行をクリックしたときだけ開く（同じ行の再クリックは閉じる）
		if(willOpen){
			memo.classList.add('open');
		}
	});

	// タッチ端末では「ホバー」を疑似的に発火させるブラウザがあり、mouseenterで開いた直後に
	// clickのtoggleが「開いている」と誤認して閉じてしまうため、ホバー対応端末でのみhoverで開閉する
	var supportsHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

	// ツールチップ(.explain)をトリガー要素の直下（画面に収まるよう自動調整）に固定表示する
	// .table-scrollなどoverflow:autoな祖先要素にクリップされないよう、position:fixedで
	// ビューポート基準の座標を都度計算する
	function positionExplain(triggerEl, explainEl){
		var margin = 8;
		explainEl.style.left = margin + 'px';
		explainEl.style.top = margin + 'px';
		explainEl.style.display = 'block';
		var triggerRect = triggerEl.getBoundingClientRect();
		var explainRect = explainEl.getBoundingClientRect();

		// テーブル内のツールチップは、テーブル自体の幅（枠）を超えて
		// 表からはみ出さないよう、テーブルの範囲内に収める
		var boundsEl = triggerEl.closest('table') || document.body;
		var boundsRect = boundsEl.getBoundingClientRect();
		var minLeft = Math.max(margin, boundsRect.left);
		var maxRight = Math.min(window.innerWidth - margin, boundsRect.right);

		var left = triggerRect.left;
		var top = triggerRect.bottom + margin;
		if(left + explainRect.width > maxRight){
			left = maxRight - explainRect.width;
		}
		if(left < minLeft){
			left = minLeft;
		}
		if(top + explainRect.height > window.innerHeight - margin){
			top = triggerRect.top - explainRect.height - margin;
		}
		if(top < margin){
			top = margin;
		}
		explainEl.style.left = left + 'px';
		explainEl.style.top = top + 'px';
	}

	document.querySelectorAll('div.question').forEach(function(el){
		el.setAttribute('tabindex', '0');
		if(!el.hasAttribute('role')) el.setAttribute('role', 'button');
		var explain = el.nextElementSibling;

		function show(){
			positionExplain(el, explain);
			fadeIn(explain, 300, 'block');
		}
		function hide(){
			fadeOut(explain, 300);
		}
		function toggle(e){
			e.stopPropagation();
			if(explain.style.display === 'block'){
				hide();
			}else{
				document.querySelectorAll('div.explain').forEach(function(other){
					if(other !== explain) other.style.display = 'none';
				});
				show();
			}
		}

		if(supportsHover){
			el.addEventListener('mouseenter', show);
			el.addEventListener('mouseleave', hide);
		}
		el.addEventListener('click', toggle);
		el.addEventListener('keydown', function(e){
			if(e.key === 'Enter' || e.key === ' '){
				e.preventDefault();
				toggle(e);
			}
		});
	});

	document.addEventListener('click', function(e){
		if(!e.target.closest('div.question')){
			document.querySelectorAll('div.explain').forEach(function(el){
				el.style.display = 'none';
			});
		}
	});

	calc();
});

function calc(){
	var tyosei_price, tyosei_price_own;
	var tyosei1 = document.getElementById('tyosei1').value;
	var tyosei2 = document.getElementById('tyosei2').value;
	var tyosei3 = document.getElementById('tyosei3').value;
	var tyosei4 = document.getElementById('tyosei4').value;
	var tyosei5 = document.getElementById('tyosei5').value;
	var tyosei6 = document.getElementById('tyosei6').value;
	var tyosei7 = document.getElementById('tyosei7').value;
	var tyosei8 = document.getElementById('tyosei8').value;
	var tyoseiPriceEl = document.getElementById('tyosei_price');
	var tyoseiMemoEl = document.getElementById('tyosei_memo');
	var tyoseiStatusEl = document.getElementById('tyosei_status');

	var total_month = tyosei1 / 1 + tyosei2 / 1 +
					tyosei3 / 1 + tyosei4 / 1 +
					tyosei5 / 1 + tyosei6 / 1 +
					tyosei7 / 1 + tyosei8 / 1;
	var tyoseiError = total_month > 60;
	if(tyoseiError){
		tyoseiStatusEl.textContent = "※月数の合計は60以内にしてください。（入力されている月数の合計:" + total_month + "か月）";
		tyoseiStatusEl.className = 'warning';
		tyoseiStatusEl.style.display = 'inline-block';
	}else if(total_month === 0){
		tyoseiStatusEl.textContent = "※月数が入力されていません。";
		tyoseiStatusEl.className = 'tyosei-hint';
		tyoseiStatusEl.style.display = 'inline-block';
	}else{
		tyoseiStatusEl.textContent = "";
		tyoseiStatusEl.className = '';
		tyoseiStatusEl.style.display = 'none';
	}
	if(tyoseiError){
		tyoseiPriceEl.value = "";
		tyoseiMemoEl.innerHTML = '直近の60か月のなかで各区分にあてはまる月数を数字で入力してください。';
	}else{
		tyosei_price = tyosei1 * 65000 + tyosei2 * 59550 +
						tyosei3 * 54150 + tyosei4 * 43350 +
						tyosei5 * 32500 + tyosei6 * 27100 +
						tyosei7 * 21700 + tyosei8 * 0;
		if(tyosei_price > 0){
			tyoseiMemoEl.innerHTML = "自己都合 勤務年数 9年以下:支給されません 10年以上24年以下:2分の1減額→ <span class='numeric'>" + (tyosei_price / 2).toLocaleString() + "</span>円<br />自己都合以外 勤務年数 4年以下:2分の1減額→ <span class='numeric'>" + (tyosei_price / 2).toLocaleString() + "</span>円";
			tyoseiPriceEl.value = tyosei_price.toLocaleString();
		}else{
			tyoseiMemoEl.innerHTML = '直近の60か月のなかで各区分にあてはまる月数を数字で入力してください。';
			tyoseiPriceEl.value = "";
		}
	}

	var age, duration, duration_tax; // 年齢、勤続年数、退職所得控除額の計算に使う年数
	var teinen, koujo; // 定年、退職所得控除額
	var own_price, compulsory_price, own_tax, compulsory_tax, own_inhabit_tax, compulsory_inhabit_tax; // 自己都合支給額、定年勧奨支給額、自己都合所得税、定年勧奨所得税、自己都合住民税、定年勧奨住民税
	var result, memo; // 計算結果, 計算メモ（クリック時に表示・行ごと）

	var birthYearEl = document.getElementById('birthYear');
	var hireYearEl = document.getElementById('hireYear');
	var salaryEl = document.getElementById('salary');
	var msgBirthEl = document.getElementById('msg_birth');
	var msgHireEl = document.getElementById('msg_hire');
	var msgSalaryEl = document.getElementById('msg_salary');
	var msgAgeWarningEl = document.getElementById('msg_age_warning');
	var middleYearEl = document.getElementById('middle_year');
	var msgEl = document.getElementById('msg');
	var resultEl = document.getElementById('result');

	var salaryRaw = (salaryEl.value || '').toString().replace(/,/g, '').trim();
	var salaryValue = salaryRaw ? Number(salaryRaw) : 0;
	var baseSalaryValue = salaryValue;

	// 最初の画面で、「～が入力されていません。」の各項目が入力されればOK等を表示する
	if(birthYearEl.value){
		msgBirthEl.classList.add('msg_input_ok');
	}
	if(hireYearEl.value){
		msgHireEl.classList.add('msg_input_ok');
	}
	if(salaryRaw){
		msgSalaryEl.classList.add('msg_input_ok');
	}else{
		msgSalaryEl.classList.remove('msg_input_ok');
	}

	if(birthYearEl.value){
		age = stdYear - 1 - birthYearEl.value;
	}
	if(hireYearEl.value){
		duration = stdYear - hireYearEl.value;
		duration_tax = duration; // 退職所得控除額の計算に使う年数
		// 年度途中の採用の場合1年を引く(控除額の計算の年数は切り上げなのでそのまま)
		if(middleYearEl.checked){
			duration -= 1;
		}
	}

	// 生年・採用年の組み合わせが実際の年齢として不自然でないかの簡易チェック
	if(birthYearEl.value && hireYearEl.value){
		var hireAge = hireYearEl.value - birthYearEl.value;
		if(hireAge < 15 || hireAge > 70){
			msgAgeWarningEl.textContent = '・生年と採用年度の組み合わせが実際の年齢と大きくずれている可能性があります。入力内容をご確認ください。';
			msgAgeWarningEl.style.display = 'inline-block';
		}else{
			msgAgeWarningEl.style.display = 'none';
			msgAgeWarningEl.textContent = '';
		}
	}else{
		msgAgeWarningEl.style.display = 'none';
		msgAgeWarningEl.textContent = '';
	}

	if(tyoseiError){
		resultEl.innerHTML = "<tr><td colspan='13'>調整月額の月数合計エラーを解消すると、ここに計算結果が表示されます。</td></tr>";
	}else if(age && (duration != null) && salaryRaw){
		result = "";
		for(i = 0; i <= (65 - age); i ++){
			// 定年の計算（2023年以降に65歳まで段階的に延長される）
			teinen = (stdYear + i < 2023) ? 60 : Math.min(65, 61 + Math.floor((stdYear + i - 2023) / 2));
			if(teinen < (age + i)){
				break;
			}
			result += "<tr class='calc_disp'><td>" + (stdYear + i - 1) + "年度末(" + (stdYear + i) + ".3)</td><td>" + (age + i) + "</td><td>" + (duration + i) + "</td>";
			result += "<td>" + teinen + "</td>";

			// 退職所得控除額の計算
			if(duration_tax + i <= 20){
				koujo = (duration_tax + i) * 400000;
			}else{
				koujo = 8000000 + (duration_tax + i - 20) * 700000;
			}
			if(koujo < 800000){
				koujo = 800000;
			}
			result += "<td>" + (koujo / 10000) + "万円</td>";

			// 自己都合の調整額の計算
			if(duration + i < 10){
				tyosei_price_own = 0;
			}else{
				tyosei_price_own = tyoseiPriceEl.value.replace(/,/g, '') - 0;
				if(duration + i < 25){
					tyosei_price_own = Math.floor(tyosei_price_own / 2);
				}
			}

			if(age + i < 60){
				own_price = Math.floor(baseSalaryValue * getRate(own_rate, duration + i)) + tyosei_price_own;
			}else{
				own_price = 0;
			}

			// 自己都合税金の計算
			var ownTaxResult = calcTax(own_price, koujo);
			own_tax = ownTaxResult.tax;
			own_inhabit_tax = ownTaxResult.inhabitTax;
			if(own_price > 0){
				result += "<td class='price'>" + own_price.toLocaleString() + "</td><td class='price'>" + own_tax.toLocaleString() + "</td><td class='price'>" + own_inhabit_tax.toLocaleString() + "</td><td class='price net'>" + (own_price - own_tax - own_inhabit_tax).toLocaleString() + "</td>";
			}else{
				result += "<td>-</td><td>-</td><td>-</td><td>-</td>";
			}

			// 勧奨の計算
			tyosei_price = tyoseiPriceEl.value.replace(/,/g, '') - 0;
			if(duration + i < 5){
				tyosei_price = Math.floor(tyosei_price / 2);
			}

			if(age + i >= teinen || (age + i >= teinen - 10 && duration + i >= 25)){
				compulsory_price = Math.floor(baseSalaryValue * getRate(compulsory_rate, duration + i)) + tyosei_price;
			}else{
				compulsory_price = 0;
			}

			// 定年勧奨税金の計算
			var compulsoryTaxResult = calcTax(compulsory_price, koujo);
			compulsory_tax = compulsoryTaxResult.tax;
			compulsory_inhabit_tax = compulsoryTaxResult.inhabitTax;
			if(compulsory_price > 0){
				result += "<td class='price'>" + compulsory_price.toLocaleString() + "</td><td class='price'>" + compulsory_tax.toLocaleString() + "</td><td class='price'>" + compulsory_inhabit_tax.toLocaleString() + "</td><td class='price net'>" + (compulsory_price - compulsory_tax - compulsory_inhabit_tax).toLocaleString() + "</td>";
			}else{
				result += "<td>-</td><td>-</td><td>-</td><td>-</td>";
			}

			result += "</tr>";
			memo = "";

			var baseSalaryMemo = "<span class='numeric'>" + baseSalaryValue.toLocaleString() + "</span>(給料月額)";

			if(age + i < 60){
				memo += "自己都合: " + baseSalaryMemo + " × <span class='numeric'>" + getRate(own_rate, duration + i) + "</span>(支給率) ＋ ";
				if(duration + i < 10){
					memo += "<span class='numeric'>0</span>(9年以下のため調整額なし)";
				}else if(duration + i < 25){
					memo += "<span class='numeric'>" + tyosei_price_own.toLocaleString() + "</span>(調整額 ※10年以上25年未満のため2分の1減額)";
				}else{
					memo += "<span class='numeric'>" + tyosei_price_own.toLocaleString() + "</span>(調整額)";
				}
				memo += " = <span class='numeric'>" + own_price.toLocaleString() + "</span><br />";
			}

			if(age + i >= teinen || (age + i >= teinen - 10 && duration + i >= 25)){
				memo += "定年・勧奨: " + baseSalaryMemo + " × ";
				memo += "<span class='numeric'>" + getRate(compulsory_rate, duration + i) + "</span>(支給率) ＋ ";

				if(duration + i < 5){
					memo += "<span class='numeric'>0</span>(4年以下のため調整額なし)";
				}else{
					memo += "<span class='numeric'>" + tyosei_price.toLocaleString() + "</span>(調整額)";
				}
				memo += " = <span class='numeric'>" + compulsory_price.toLocaleString() + "</span><br />";
			}
			memo += "計算結果に端数(小数点以下）が出る場合は切り捨て";
			result += "<tr class='calc_memo'><td colspan='13'><div class='calc_memo_inner'>" + memo + "</div></td></tr>";
			if(teinen == (age + i)){
				break;
			}
		}
		if(result === ""){
			result = "<tr><td colspan='13'>入力された生年・採用年度の組み合わせでは計算できる年度がありません。生年・採用年度をご確認ください。</td></tr>";
		}
		if(msgEl.style.display !== 'none'){
			fadeOut(msgEl, 1000);
		}
		resultEl.innerHTML = result;
	}else{
		// 必要な項目が揃っていない場合は、前回の計算結果を消して初期表示に戻す
		resultEl.innerHTML = "<tr><td colspan='13'>必要な項目を入力するとここに計算結果が表示されます</td></tr>";
	}

	renderShareQr();
	saveState();
}
