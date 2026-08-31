/* =============================================================
   ページ間の導線（トップページ＋各ツール）

   ツール同士を行き来する道がトップページ経由しか無かったので、
   ページを読み終える位置に一覧を出す。ヘッダーに「トップページに戻る」
   ボタンを別に置いていたが、行き先の一覧がここにある以上、
   トップページもこの一覧の一員として並べれば足りる。

   各ページですること:
     ページの一番下（注記より後、</main> の直前）に
     <nav data-tool-nav="サイト直下までの相対パス"></nav> を置き、
     本文のスクリプトと同じ場所でこのファイルを読み込む。

   一覧をHTMLに直接書かずここで描くのは、ツールを増やしたときに
   直す場所を1箇所にするため（トップページ・404の一覧・sitemap と
   同じものを4箇所で手入れするのは、いずれ食い違う）。

   リンク先はサイト直下からの相対で持ち、そこまでの深さは
   data-tool-nav の値で受け取る（ページごとに ../ か ../../ が決まる）。
   以前は「トップページに戻る」ボタンの href を借りていたが、
   そのボタンをやめたので、置き場所そのものに持たせている。
   ============================================================= */
(function (global) {
  "use strict";

  /* dir は「そのツールの区画」。今いるページがこの下にあれば、
	   リンクではなく「表示中」にする。年度違い（NISA）や
	   地方/国家（退職手当）で開いているときも、区画としては同じと扱う。

	   最後のプライバシーポリシーだけはツールではないが、どのページからも
	   同じ位置で辿れるようにここへ並べている（注記の中のリンクだけだと、
	   ページによって注記の長さが違い、探す場所が定まらない）。 */
  var TOOLS = [
    { label: "資産運用", dir: "assetSimulator/", href: "assetSimulator/" },
    { label: "NISA利用状況", dir: "nisa/", href: "nisa/nisa2025.html" },
    { label: "iDeCo", dir: "ideco/", href: "ideco/" },
    { label: "公務員退職手当", dir: "retirement/", href: "retirement/" },
    { label: "年金", dir: "pension/", href: "pension/" },
    { label: "贈与", dir: "gift/", href: "gift/" },
    { label: "相続", dir: "inheritance/", href: "inheritance/" },
    { label: "プライバシーポリシー", dir: "privacy/", href: "privacy/" },
  ];

  function link(href, label) {
    var a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    return a;
  }

  /* 区切りの縦棒。線そのものはCSSが描くので、中身は空でよい。
	   読み上げソフトが「たてぼう」と読んでも意味が無いので aria-hidden にする
	   （CSSの ::before では aria-hidden を指定できないため要素で置いている） */
  function separator() {
    var sep = document.createElement("span");
    sep.className = "tool-nav-sep";
    sep.setAttribute("aria-hidden", "true");
    return sep;
  }

  function render(host) {
    var base = host.getAttribute("data-tool-nav") || "./";
    var here = global.location.pathname;

    /* トップページはこの一覧を持たないので、必ずリンクになる */
    host.appendChild(link(base, "トップページ"));

    for (var i = 0; i < TOOLS.length; i++) {
      var tool = TOOLS[i];
      var dirUrl = new URL(base + tool.dir, global.location.href);

      host.appendChild(separator());

      if (here.indexOf(dirUrl.pathname) === 0) {
        /* 今いる区画。押しても同じ場所なので、リンクにせずただの文字にする。
				   「表示中」と書き添えはしない（色と、押せないことで足りる）が、
				   目で見えない人には色が伝わらないので aria-current は必ず付ける */
        var cur = document.createElement("span");
        cur.className = "current";
        cur.setAttribute("aria-current", "page");
        cur.textContent = tool.label;
        host.appendChild(cur);
      } else {
        host.appendChild(link(base + tool.href, tool.label));
      }
    }

    host.className = "tool-nav";
    host.setAttribute("aria-label", "サイト内のページ");
  }

  function init() {
    var hosts = document.querySelectorAll("[data-tool-nav]");
    for (var i = 0; i < hosts.length; i++) render(hosts[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
