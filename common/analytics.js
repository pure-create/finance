/* =============================================================
   Google Analytics（gtag.js）

   全ページに同じスニペットが貼られていたので1箇所にまとめた。
   各ページの <head> から次の1行で読み込む:
     <script src="{相対パス}/common/analytics.js?v=..." async></script>
   ============================================================= */
(function () {
	'use strict';

	var GA_ID = 'G-BJ9WKQKN9V';

	window.dataLayer = window.dataLayer || [];
	function gtag() { window.dataLayer.push(arguments); }
	window.gtag = gtag;

	gtag('js', new Date());
	gtag('config', GA_ID);

	// 計測タグ本体。dataLayer に積んだ内容は読み込み後にまとめて処理される。
	var s = document.createElement('script');
	s.async = true;
	s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
	document.head.appendChild(s);
})();
