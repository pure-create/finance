/* =============================================================
   他のツールへの導線

   ツール同士を行き来する道がトップページ経由しか無かったので、
   ページを読み終える位置に一覧を出す。

   各ページですること:
     ページ末尾（注記より前）に <nav data-tool-nav></nav> を置き、
     本文のスクリプトと同じ場所でこのファイルを読み込む。

   一覧をHTMLに直接書かずここで描くのは、ツールを増やしたときに
   直す場所を1箇所にするため（トップページ・404の一覧・sitemap と
   同じものを4箇所で手入れするのは、いずれ食い違う）。

   リンク先はサイト直下からの相対で持つ。ページごとの深さは、
   どのページにもある「トップページに戻る」（.home-link）の href が
   そのまま「ここからサイト直下まで」を表しているので、それを使う。
   ============================================================= */
(function (global) {
	'use strict';

	/* dir は「そのツールの区画」。今いるページがこの下にあれば、
	   リンクではなく「表示中」にする。年度違い（NISA）や
	   地方/国家（退職手当）で開いているときも、区画としては同じと扱う。 */
	var TOOLS = [
		{ label: '資産運用',       dir: 'assetSimulator/', href: 'assetSimulator/' },
		{ label: 'NISA利用状況',   dir: 'nisa/',           href: 'nisa/nisa2025.html' },
		{ label: '公務員退職手当', dir: 'retirement/',     href: 'retirement/' },
		{ label: '年金',           dir: 'pension/',        href: 'pension/' },
		{ label: '相続',           dir: 'inheritance/',    href: 'inheritance/' }
	];

	function render(host) {
		var homeLink = document.querySelector('.home-link');
		var base = homeLink ? homeLink.getAttribute('href') : './';
		var here = global.location.pathname;

		var label = document.createElement('span');
		label.className = 'tool-nav-label';
		label.textContent = '他のツール';

		var list = document.createElement('ul');

		for (var i = 0; i < TOOLS.length; i++) {
			var tool = TOOLS[i];
			var dirUrl = new URL(base + tool.dir, global.location.href);
			var item = document.createElement('li');

			if (here.indexOf(dirUrl.pathname) === 0) {
				// 今いる区画。押しても同じ場所なので、リンクにはしない
				var cur = document.createElement('span');
				cur.className = 'current';
				cur.setAttribute('aria-current', 'page');
				cur.textContent = tool.label + '（表示中）';
				item.appendChild(cur);
			} else {
				var a = document.createElement('a');
				a.href = base + tool.href;
				a.textContent = tool.label;
				item.appendChild(a);
			}
			list.appendChild(item);
		}

		host.className = 'tool-nav';
		host.setAttribute('aria-label', '他のツール');
		host.appendChild(label);
		host.appendChild(list);
	}

	function init() {
		var hosts = document.querySelectorAll('[data-tool-nav]');
		for (var i = 0; i < hosts.length; i++) render(hosts[i]);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})(window);
