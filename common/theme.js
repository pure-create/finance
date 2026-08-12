/* =============================================================
   サイト共通のテーマ切替（システム / ライト / ダーク）

   このファイルは <head> で同期的に読み込むこと。
   先頭で <html> の data-theme を確定させるので、スタイルシートが
   当たる前に配色が決まり、切り替わりのちらつき（FOUC）が出ない。

   各ページですること:
     1. <head> で theme.css より前にこのファイルを読み込む
     2. ヘッダーの好きな位置に <span data-theme-toggle></span> を置く
     3. canvas を描いているページは Theme.onChange(redraw) を登録する
   ============================================================= */
(function (global) {
	'use strict';

	var STORAGE_KEY = 'financeSiteTheme';
	var MODES = ['system', 'light', 'dark'];
	var ANIM_CLASS = 'theme-anim';
	var ANIM_MS = 260;   /* theme.css の transition と揃えること */
	var REDRAW_MS = 130; /* canvas が薄くなりきる頃合い */

	var root = document.documentElement;
	var darkQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
	var listeners = [];
	var colorCache = {};
	var animTimers = [];
	var printPrevMode = null;

	function readStored() {
		try {
			var v = localStorage.getItem(STORAGE_KEY);
			return MODES.indexOf(v) >= 0 ? v : 'system';
		} catch (e) {
			// プライベートブラウジング等で読めない場合はシステム設定に従う
			return 'system';
		}
	}

	var mode = readStored();

	function systemTheme() {
		return darkQuery && darkQuery.matches ? 'dark' : 'light';
	}

	/* data-theme を実際の DOM に反映する。
	   「システム」を選んでいるときも、属性を外すのではなく OS の設定を解決して
	   light / dark のどちらかを必ず書き込む。こうするとCSS側は data-theme だけを
	   見ればよくなり、各CSSにダークの値を prefers-color-scheme 側と
	   属性セレクタ側の2箇所へ書く必要がなくなる。
	   （代償として、JSを切っているとダークが効かない。ただし各ツールは計算自体が
	     JS前提なので、実質的な影響はない） */
	function applyAttribute(m) {
		root.setAttribute('data-theme', m === 'system' ? systemTheme() : m);
		colorCache = {};
		applyThemeColor();
	}

	/* スマートフォンのブラウザは、アドレスバーなど自分の枠の色を
	   <meta name="theme-color"> で決める。指定が無いと枠は白のままなので、
	   ダークにするとページだけが黒くなり、上下に白い帯が残って浮いて見える。
	   テーマを書き込むたびに、ページの地色（--bg）をここへ写す。

	   色をJSに書き写さず theme.css のトークンから取るのは、
	   定義を1箇所に保つため（Theme.color と同じ考え方）。
	   ただし theme.js は theme.css より前に読み込む決まりなので、
	   最初の同期実行の時点ではまだ値が取れない。そのときは何もせず、
	   下の DOMContentLoaded でもう一度呼んで付ける。

	   meta 自体もここで作る。各ページのHTMLに書くと11ページに同じ行が並ぶうえ、
	   切り替えのたびに書き換える相手はどのみちここになるため。 */
	function applyThemeColor() {
		if (!document.head) return;
		var bg = getComputedStyle(root).getPropertyValue('--bg').trim();
		if (!bg) return;   // まだ theme.css が当たっていない

		var meta = document.head.querySelector('meta[name="theme-color"]');
		if (!meta) {
			meta = document.createElement('meta');
			meta.setAttribute('name', 'theme-color');
			document.head.appendChild(meta);
		}
		meta.setAttribute('content', bg);
	}

	// ---- ここだけは同期実行。スタイルが当たる前に確定させる ----
	applyAttribute(mode);

	// 属性には必ず light / dark のどちらかが入っている
	function resolved() {
		return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
	}

	function notify() {
		colorCache = {};
		var now = resolved();
		for (var i = 0; i < listeners.length; i++) {
			try { listeners[i](now); }
			catch (e) { /* 1つのコールバックの失敗で他を巻き添えにしない */ }
		}
	}

	function clearAnimTimers() {
		for (var i = 0; i < animTimers.length; i++) clearTimeout(animTimers[i]);
		animTimers = [];
		root.classList.remove(ANIM_CLASS);
	}

	// 少し時間をかけて切り替える。canvas は薄くなっている間に描き直す。
	function applyAnimated(m) {
		clearAnimTimers();
		root.classList.add(ANIM_CLASS);
		requestAnimationFrame(function () {
			applyAttribute(m);
			animTimers.push(setTimeout(notify, REDRAW_MS));
			animTimers.push(setTimeout(function () {
				root.classList.remove(ANIM_CLASS);
				animTimers = [];
			}, ANIM_MS + 30));
		});
	}

	function setMode(m, animate) {
		if (MODES.indexOf(m) < 0) m = 'system';
		mode = m;
		try { localStorage.setItem(STORAGE_KEY, m); } catch (e) { /* 保存できなくても動作は続ける */ }
		if (animate === false) { applyAttribute(m); notify(); }
		else applyAnimated(m);
		updateWidgets();
	}

	var Theme = {
		MODES: MODES.slice(),
		get: function () { return mode; },
		set: function (m) { setMode(m, true); },
		resolved: resolved,
		onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
		// CSSトークンの現在値を取り出す。JSで色を描く箇所はすべてこれを使い、
		// 色の定義がCSS側の1箇所に収まるようにする。
		color: function (name) {
			if (colorCache[name] === undefined) {
				colorCache[name] = getComputedStyle(root).getPropertyValue(name).trim();
			}
			return colorCache[name];
		}
	};

	/* ===== OSの設定変更に追従（システムモードのときだけ実体が変わる） ===== */
	if (darkQuery) {
		// OS側が切り替わったら data-theme を書き直す。
		// 属性が実体を持つようになったので、ここで反映しないと配色が古いまま残る
		var onSystemChange = function () {
			if (mode !== 'system') return;
			applyAttribute('system');
			notify();
			updateWidgets();
		};
		if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemChange);
		else if (darkQuery.addListener) darkQuery.addListener(onSystemChange);
	}

	/* ===== 別タブでの変更に追従 ===== */
	global.addEventListener('storage', function (e) {
		if (e.key !== STORAGE_KEY) return;
		var next = readStored();
		if (next === mode) return;
		mode = next;
		applyAnimated(next);
		updateWidgets();
	});

	/* ===== 印刷時は強制的にライト =====
	   canvas は CSS 変数の変更に追従しないので、描き直しのために notify する。
	   トランジションは挟まない（印刷が始まるまでに間に合わないため）。

	   あわせて <html> に .printing を付けて、レイアウトを紙の幅に合わせる。
	   @media print は印刷レイアウトが確定してからしか効かず、beforeprint の
	   時点ではまだ画面の幅のままになる。スマートフォンのように画面が狭い端末では
	   canvas がその狭い幅で描かれ、紙に載せるときに引き伸ばされて
	   グラフの文字や線だけが太く大きくなってしまうため、先回りして幅を変える。 */
	global.addEventListener('beforeprint', function () {
		if (printPrevMode !== null) return;
		printPrevMode = mode;
		clearAnimTimers();
		root.classList.add('printing');
		applyAttribute('light');
		notify();
	});
	global.addEventListener('afterprint', function () {
		if (printPrevMode === null) return;
		root.classList.remove('printing');
		applyAttribute(printPrevMode);
		printPrevMode = null;
		notify();
	});

	/* =============================================================
	   切替ウィジェット
	   ============================================================= */
	/* メニューの見出し。何を選ぶ場所なのかが一目で分かるように出す。
	   読み上げには見出しではなくメニュー自身の aria-label で伝えるので、
	   同じ文言を二重に読ませないよう見出しの要素は aria-hidden にしている */
	var MENU_TITLE = '画面の配色';

	var ITEMS = [
		{ mode: 'system', icon: '🌗', name: 'システム', desc: 'お使いの環境に合わせる' },
		{ mode: 'light',  icon: '☀️', name: 'ライト',   desc: '常にライト' },
		{ mode: 'dark',   icon: '🌙', name: 'ダーク',   desc: '常にダーク' }
	];

	var widgets = [];

	function itemFor(m) {
		for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].mode === m) return ITEMS[i];
		return ITEMS[0];
	}

	function updateWidgets() {
		var cur = itemFor(mode);
		for (var i = 0; i < widgets.length; i++) {
			var w = widgets[i];
			w.icon.textContent = cur.icon;
			w.btn.setAttribute('aria-label', MENU_TITLE + ': ' + cur.name + '（' + cur.desc + '）');
			w.btn.title = MENU_TITLE + ': ' + cur.name;
			for (var j = 0; j < w.items.length; j++) {
				w.items[j].setAttribute('aria-checked', w.items[j].dataset.mode === mode ? 'true' : 'false');
			}
		}
	}

	function buildWidget(host) {
		host.textContent = '';

		var wrap = document.createElement('div');
		wrap.className = 'theme-toggle';

		var btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'theme-toggle__btn';
		btn.setAttribute('aria-haspopup', 'true');
		btn.setAttribute('aria-expanded', 'false');

		var icon = document.createElement('span');
		icon.className = 'theme-toggle__icon';
		icon.setAttribute('aria-hidden', 'true');
		btn.appendChild(icon);

		var menu = document.createElement('div');
		menu.className = 'theme-toggle__menu';
		menu.setAttribute('role', 'menu');
		menu.setAttribute('aria-label', MENU_TITLE);
		menu.hidden = true;

		var title = document.createElement('div');
		title.className = 'theme-toggle__title';
		title.setAttribute('aria-hidden', 'true');
		title.textContent = MENU_TITLE;
		menu.appendChild(title);

		var items = ITEMS.map(function (def) {
			var it = document.createElement('button');
			it.type = 'button';
			it.className = 'theme-toggle__item';
			it.setAttribute('role', 'menuitemradio');
			it.setAttribute('aria-checked', 'false');
			it.dataset.mode = def.mode;
			it.innerHTML =
				'<span class="ti-icon" aria-hidden="true"></span>' +
				'<span><span class="ti-name"></span><span class="ti-desc"></span></span>' +
				'<span class="ti-check" aria-hidden="true">✓</span>';
			it.querySelector('.ti-icon').textContent = def.icon;
			it.querySelector('.ti-name').textContent = def.name;
			it.querySelector('.ti-desc').textContent = def.desc;
			menu.appendChild(it);
			return it;
		});

		wrap.appendChild(btn);
		wrap.appendChild(menu);
		host.appendChild(wrap);

		var w = { host: host, btn: btn, icon: icon, menu: menu, items: items };
		widgets.push(w);

		function open() {
			menu.hidden = false;
			btn.setAttribute('aria-expanded', 'true');
			var checked = menu.querySelector('[aria-checked="true"]') || items[0];
			checked.focus();
		}
		function close(refocus) {
			if (menu.hidden) return;
			menu.hidden = true;
			btn.setAttribute('aria-expanded', 'false');
			if (refocus) btn.focus();
		}
		function moveFocus(step) {
			var idx = items.indexOf(document.activeElement);
			if (idx < 0) idx = 0;
			else idx = (idx + step + items.length) % items.length;
			items[idx].focus();
		}

		btn.addEventListener('click', function (e) {
			e.stopPropagation();
			if (menu.hidden) open(); else close(true);
		});

		items.forEach(function (it) {
			it.addEventListener('click', function () {
				close(true);
				if (it.dataset.mode !== mode) Theme.set(it.dataset.mode);
			});
		});

		menu.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
			else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
			else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
			else if (e.key === 'Escape') { e.preventDefault(); close(true); }
			else if (e.key === 'Tab') { close(false); }
		});
		btn.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowDown' && menu.hidden) { e.preventDefault(); open(); }
			else if (e.key === 'Escape') { close(true); }
		});
		document.addEventListener('click', function (e) {
			if (!wrap.contains(e.target)) close(false);
		});
	}

	function initWidgets() {
		var hosts = document.querySelectorAll('[data-theme-toggle]');
		for (var i = 0; i < hosts.length; i++) buildWidget(hosts[i]);
		updateWidgets();
		// 読み込み順の都合で最初は付けられていないので、ここで改めて付ける
		applyThemeColor();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initWidgets);
	} else {
		initWidgets();
	}

	global.Theme = Theme;
})(window);
