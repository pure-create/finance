/* =============================================================
   共有リンクまわりの共通処理

   「クリップボードへのコピー」「結果の吹き出し表示」「QRコードの描画」は
   どのページでも同じなのでここにまとめる。

   一方、入力内容をどうURLに載せるか・localStorage にどう保存するかは
   ページごとに異なるうえ、形式を変えると配布済みの共有リンクや保存済みの
   入力内容が読めなくなるため、各ページ側にそのまま残している。

   QRとコピー結果は、共有ボタンの直下に開くポップオーバー（.share-pop）に入れる。
   常に出しておくと、100px前後あるQRがヘッダーの行の高さを決めてしまい、
   見出しの横に大きな空白ができるため。閉じている間はQRを作らないので、
   スライダーを動かしている最中の作り直しも起きない。

   使い方:
     Share.init({
       buttonId: 'shareBtn',
       qrId:     'shareQr',
       msgId:    'shareMsg',
       popId:    'sharePop',
       buildUrl: function () { return Share.urlWithParams(serializeState()); }
     });
     Share.refreshQr();   // 入力が変わったら呼ぶ

   qrcode.js を読み込んでいないページでは QR の描画だけ黙って省略される。
   ポップオーバーを置いていないページ（トップページ）では、QRは常時表示のまま
   コピー結果だけが3秒で消える吹き出しになる。
   ============================================================= */
(function (global) {
	'use strict';

	var cfg = null;
	var msgTimer = null;
	var qrStale = true;   // 入力が変わったので作り直しが要る、という印

	/* QRコードの読み取りやすさに関わる設定。
	   画面に出すQRは、URLが長いほどモジュール（黒白の升目）が細かくなる。
	   升目が小さすぎるとカメラが読めないので、モジュール数に応じて
	   表示サイズのほうを広げる。 */
	var QR_EC = 'L';            // 誤り訂正レベル。画面表示は汚れ・欠けが無いので最小でよく、
	                            // そのぶんモジュール数が減って同じ大きさでも読みやすくなる
	var QR_PX_PER_MODULE = 2.15; // 1モジュールあたり確保する画面ピクセル。小さくするとQRも
	                            // 小さくなるが、読み取りにくくなる（2を下回ると厳しい）
	var QR_PLATE_PX = 8;        // 白い台紙の余白と枠線の合計（site.css の padding 3px + border 1px を左右で）。
	                            // box-sizing: border-box なので、この分は升目に使えない
	var QR_MIN_SIZE = 72;       // common/site.css の .share-qr の既定サイズと合わせること
	var QR_MAX_SIZE = 144;      // ヘッダーに収まる上限

	function byId(id) { return id ? document.getElementById(id) : null; }

	// 現在のURLからクエリとハッシュを落とし、渡したパラメータを付け直す
	function urlWithParams(params) {
		var str = params ? params.toString() : '';
		var base = global.location.href.split(/[?#]/)[0];
		return str ? base + '?' + str : base;
	}

	function copyToClipboard(text) {
		if (global.navigator.clipboard && global.isSecureContext) {
			return global.navigator.clipboard.writeText(text);
		}
		// file:// や http:// では Clipboard API が使えないので旧APIに退避する
		return new Promise(function (resolve, reject) {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				if (document.execCommand('copy')) resolve();
				else reject(new Error('copy failed'));
			} catch (e) {
				reject(e);
			} finally {
				ta.remove();
			}
		});
	}

	function popEl() { return cfg ? byId(cfg.popId) : null; }
	// 開いているかどうかは .show の有無で持つ。閉じるときにフェードさせたいので、
	// hidden 属性（display:none）ではなく opacity / visibility で切り替えている
	function isOpen() { var p = popEl(); return !!p && p.classList.contains('show'); }

	// コピー結果を知らせる
	function flash(html) {
		var el = cfg && byId(cfg.msgId);
		if (!el) return;
		clearTimeout(msgTimer);
		el.innerHTML = html;
		el.classList.add('show');
		// ポップオーバーの中に置いているページでは消さない。QRを読み取る時間が要るのと、
		// 閉じる操作（再押下・外側クリック・Esc）をポップオーバー側が持っているため
		if (popEl()) return;
		msgTimer = setTimeout(function () { el.classList.remove('show'); }, 3000);
	}

	// 共有リンクのQRコードを実際に描画する（スマートフォンへの共有用）
	function drawQr() {
		if (!cfg) return;
		var el = byId(cfg.qrId);
		if (!el || typeof global.qrcode === 'undefined') return;
		qrStale = false;
		try {
			var qr = global.qrcode(0, QR_EC);
			qr.addData(cfg.buildUrl());
			qr.make();
			el.innerHTML = qr.createSvgTag(4);

			// 入力内容が増えるほどURLが長くなり、モジュールが細かくなって読めなくなる。
			// 静穏帯（上下左右4モジュール）込みの升目数から必要な大きさを逆算する。
			var modules = qr.getModuleCount() + 8;
			var size = Math.ceil(modules * QR_PX_PER_MODULE) + QR_PLATE_PX;
			size = Math.max(QR_MIN_SIZE, Math.min(QR_MAX_SIZE, size));
			el.style.setProperty('--qr-size', size + 'px');
		} catch (e) {
			// URLが長すぎてQRに収まらない場合などは、枠ごと消す
			el.innerHTML = '';
			el.style.removeProperty('--qr-size');
		}
	}

	/* 入力が変わったときに各ページから呼ばれる。
	   閉じている間は印を立てるだけにして、開くときにまとめて作る。
	   スライダーを動かしている最中に毎回QRを作り直さないためのもの */
	function refreshQr() {
		if (!cfg) return;
		qrStale = true;
		var p = popEl();
		if (p && !isOpen()) return;
		drawQr();
	}

	// 中身が古ければ作り直す（開くとき・印刷の直前に使う）
	function ensureQr() {
		if (qrStale) drawQr();
	}

	function setOpen(open) {
		var p = popEl();
		if (!p) return;
		// 中身は先に用意する。フェードで出てくる途中にQRが差し替わらないようにするため
		if (open) ensureQr();
		p.classList.toggle('show', open);
		var btn = byId(cfg.buttonId);
		if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
	}

	function init(options) {
		cfg = {
			buttonId: options.buttonId || 'shareBtn',
			qrId:     options.qrId || 'shareQr',
			msgId:    options.msgId || 'shareMsg',
			popId:    options.popId || 'sharePop',
			buildUrl: options.buildUrl,
			okMsg:    options.okMsg || '試算結果のURLをコピーしました。<br>URLには入力内容が含まれます。',
			ngMsg:    options.ngMsg || 'コピーできませんでした。'
		};

		var btn = byId(cfg.buttonId);
		if (btn) {
			btn.addEventListener('click', function () {
				// 開いているときは閉じるだけ。コピーし直しても結果は同じなので、
				// ボタンを「共有の窓を開け閉めするもの」として揃える
				if (isOpen()) { setOpen(false); return; }

				var url = cfg.buildUrl();
				copyToClipboard(url).then(
					function () { flash(cfg.okMsg); },
					function () { flash(cfg.ngMsg + '<br>URL: ' + url); }
				);
				setOpen(true);
			});
		}

		if (popEl()) {
			// 外側をクリック、または Esc で閉じる（テーマ切替のメニューと同じ操作感にする）
			document.addEventListener('click', function (e) {
				if (!isOpen()) return;
				var wrap = popEl().parentNode;
				if (wrap && !wrap.contains(e.target)) setOpen(false);
			});
			document.addEventListener('keydown', function (e) {
				if (e.key !== 'Escape' || !isOpen()) return;
				setOpen(false);
				var b = byId(cfg.buttonId);
				if (b) b.focus();
			});
		}

		/* 閉じたまま印刷されてもQRは紙に載せる（紙から同じ条件の試算を開き直せるようにするため）。
		   描画は同期処理なので、この中で作っておけば版面に間に合う */
		global.addEventListener('beforeprint', ensureQr);

		refreshQr();
	}

	global.Share = {
		init: init,
		refreshQr: refreshQr,
		urlWithParams: urlWithParams,
		copyToClipboard: copyToClipboard,
		flash: flash
	};
})(window);
