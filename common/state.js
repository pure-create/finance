/* =============================================================
   入力内容の保存・復元・共有URL

   どのツールも「入力欄の値を localStorage に残し、共有リンクではURLの
   クエリに載せ、次に開いたときに戻す」という同じことをしていて、
   資産運用・iDeCo・退職手当・年金の4つに同じ形の関数が並んでいた
   （serializeState / applyStateFromParams / saveState / restoreState /
   buildShareUrl）。直すときに4か所を追う必要があるのでここへ集めた。

   使い方:
     var inputs = Inputs.create({
         fields: [
             ['ageNow', 40, 'a'],          // 入力欄のid, 初期値, URLでの短い名前
             ['salary', '', 'sal', {       // 4つ目は任意（下の「読み書きの差し替え」）
                 read:  function (el) { return el.value.replace(/,/g, ''); },
                 write: function (el, v) { el.value = v; format(el); }
             }]
         ],
         storageKey: 'idecoSim.v1',        // 省くと保存しない（年金がこれ）
         omitDefaults: true                // 既定。false にすると初期値の欄もURLに入れる
     });
     inputs.restore();      // URLのクエリ優先、なければ保存済みの内容
     inputs.save();         // 入力が変わるたびに呼ぶ
     inputs.shareUrl();     // Share.init の buildUrl に渡すURL
     inputs.applyDefaults() / inputs.clearSaved();   // 「入力をリセット」で使う

   URLでの名前（3つ目）は、いちど公開した共有リンクが後から開けなくなるので
   変えないこと。保存の形式（クエリ文字列）も、次に開いた人の入力が消えるので
   変えないこと。

   初期値と同じ欄はURLから省く（omitDefaults）。共有リンクを短く保つためで、
   省かれた欄は開いた側で初期値になる＝同じ画面になる。

   読み書きの差し替え（read / write）は、画面に出ている文字と保存したい値が
   違う欄のためにある。退職手当の給料月額は「412,000」と桁区切りで表示するが、
   URLには数字だけを載せたい。
   ============================================================= */
(function (global) {
	'use strict';

	function byId(id) {
		return document.getElementById(id);
	}

	/* 入力欄から文字列を取り出す。チェックボックスは 1 / 0。
	   数を入れる欄で空のまま（未入力）なら空文字が返る */
	function read(field) {
		var el = byId(field.id);
		if (!el) return null;
		if (field.read) return field.read(el);
		return el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
	}

	/* 文字列を入力欄へ書き戻す。
	   共有URLは人が手で書き換えられるので、選択肢に無い値や範囲外の値、
	   数として読めない値は受け付けずに今の値を保つ */
	function write(field, value) {
		var el = byId(field.id);
		if (!el || value === null || value === undefined) return;
		if (field.write) { field.write(el, value); return; }

		if (el.type === 'checkbox') {
			el.checked = (value === true || value === '1');
			return;
		}
		var s = String(value);
		if (el.tagName === 'SELECT') {
			for (var i = 0; i < el.options.length; i++) {
				if (el.options[i].value === s) { el.value = s; return; }
			}
			return;   // 選択肢にない値は無視する
		}
		if (el.type === 'number' || el.type === 'range') {
			/* つまみ（range）だけは空にできない。空を入れると真ん中に飛ぶので、
			   数として読めないときは何もしない。数を入れる欄（number）は
			   空にできる＝利用者が消した状態も、消したまま戻す */
			if (s === '' && el.type === 'number') { el.value = ''; return; }
			var n = parseFloat(s);
			if (!isFinite(n)) return;
			var lo = parseFloat(el.min), hi = parseFloat(el.max);
			if (isFinite(lo)) n = Math.max(lo, n);
			if (isFinite(hi)) n = Math.min(hi, n);
			s = String(n);
		}
		el.value = s;
	}

	// 初期値のままかどうか（URLから省いてよいか）
	function isDefault(field) {
		var el = byId(field.id);
		if (!el) return true;
		var d = field.def;
		if (el.type === 'checkbox') return el.checked === d;
		if (el.type === 'number' || el.type === 'range') {
			return parseFloat(el.value) === parseFloat(d);
		}
		return el.value === String(d);
	}

	function Inputs(options) {
		var list = options.fields || [];
		this.fields = [];
		for (var i = 0; i < list.length; i++) {
			var f = list[i];
			var extra = f[3] || {};
			this.fields.push({ id: f[0], def: f[1], key: f[2], read: extra.read, write: extra.write });
		}
		this.storageKey = options.storageKey || null;
		this.omitDefaults = options.omitDefaults !== false;
	}

	// 今の入力内容を URLSearchParams にする
	Inputs.prototype.serialize = function () {
		var params = new URLSearchParams();
		for (var i = 0; i < this.fields.length; i++) {
			var f = this.fields[i];
			if (this.omitDefaults && isDefault(f)) continue;
			var v = read(f);
			if (v !== null) params.set(f.key, v);
		}
		return params;
	};

	// 共有リンクのURL（Share.init の buildUrl にそのまま渡せる）
	Inputs.prototype.shareUrl = function () {
		return global.Share.urlWithParams(this.serialize());
	};

	Inputs.prototype.save = function () {
		if (!this.storageKey) return;
		try {
			global.localStorage.setItem(this.storageKey, this.serialize().toString());
		} catch (e) {
			// プライベートブラウジング等で保存できないときは、何もしない
		}
	};

	Inputs.prototype.clearSaved = function () {
		if (!this.storageKey) return;
		try {
			global.localStorage.removeItem(this.storageKey);
		} catch (e) {
			// 何もしない
		}
	};

	Inputs.prototype.apply = function (params) {
		for (var i = 0; i < this.fields.length; i++) {
			var f = this.fields[i];
			if (params.has(f.key)) write(f, params.get(f.key));
		}
	};

	// 1つの欄だけを書き換える（計算結果から「おすすめの値」を入れ直すときに使う）
	Inputs.prototype.set = function (id, value) {
		for (var i = 0; i < this.fields.length; i++) {
			if (this.fields[i].id === id) { write(this.fields[i], value); return; }
		}
	};

	Inputs.prototype.applyDefaults = function () {
		for (var i = 0; i < this.fields.length; i++) {
			write(this.fields[i], this.fields[i].def);
		}
	};

	/* 共有リンク（URLのクエリ）が最優先。無ければ前回の入力内容。
	   どこから戻したかを返す（'url' / 'saved' / null） */
	Inputs.prototype.restore = function () {
		var q = new URLSearchParams(global.location.search);
		if (q.toString()) { this.apply(q); return 'url'; }
		if (!this.storageKey) return null;
		try {
			var saved = global.localStorage.getItem(this.storageKey);
			if (saved) { this.apply(new URLSearchParams(saved)); return 'saved'; }
		} catch (e) {
			// 読み出せないときは初期値のまま
		}
		return null;
	};

	global.Inputs = {
		create: function (options) { return new Inputs(options); }
	};
})(window);
