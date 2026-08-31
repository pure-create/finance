/* =============================================================
   Google Analytics（gtag.js）

   全ページに同じスニペットが貼られていたので1箇所にまとめた。
   各ページの <head> から次の1行で読み込む:
     <script src="{相対パス}/common/analytics.js?v=..." async></script>
   ============================================================= */
(function () {
  "use strict";

  var GA_ID = "G-BJ9WKQKN9V";

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  /* 共有URLのクエリには資産額・年齢などの試算条件が入る。ページの利用状況を
     把握する目的にはパスだけで足りるため、現在URLと参照元のクエリ・ハッシュを
     Google Analyticsへ送らない。 */
  function urlWithoutDetails(value) {
    if (!value) return undefined;
    try {
      var u = new URL(value, window.location.href);
      return u.origin + u.pathname;
    } catch (e) {
      return undefined;
    }
  }

  gtag("js", new Date());
  gtag("config", GA_ID, {
    page_location: urlWithoutDetails(window.location.href),
    page_referrer: urlWithoutDetails(document.referrer),
  });

  // 計測タグ本体。dataLayer に積んだ内容は読み込み後にまとめて処理される。
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(s);
})();
