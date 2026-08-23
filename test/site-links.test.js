/* ページの一覧とリンクの整合性、およびページの骨組みのテスト。

   ページを増やしたとき、同じことを
     トップページ / 404ページのツリー / sitemap.xml / common/tool-nav.js
   の4か所に手で書き足す必要がある（tool-nav.js のコメントにあるとおり、
   放っておけばいずれ食い違う）。ここでは「食い違っていないか」を機械で見る。

   同じ理由で、どのページも持っているはずの部品（本文へのスキップリンク、
   ヘッダー行とその中の戻る導線、末尾の導線）も見ている。これらは新しい
   ページを作るときに既存のページからコピーして作られるので、コピー元を
   間違えると1つだけ抜けたまま公開されてしまう（画面には何も出ないため、
   目で見ても気付けない）。

   実行: npm test   （プロジェクト直下から） */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://pure-create.github.io/finance/';

/* canonical を持たないことが分かっているページ。
   404 は検索結果に出したくないページ、og/card.html はOGP画像の版下 */
const NO_CANONICAL = ['404.html', 'og/card.html'];

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// リポジトリ内のHTMLをすべて集める（リポジトリ直下からの相対パス、スラッシュ区切り）
function allHtml(dir, out) {
	out = out || [];
	dir = dir || ROOT;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === '.git' || e.name === 'node_modules' || e.name === '.claude') continue;
		const full = path.join(dir, e.name);
		if (e.isDirectory()) allHtml(full, out);
		else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
	}
	return out;
}

// 公開URL → リポジトリ内のファイル。末尾がスラッシュなら index.html
function urlToFile(url) {
	assert.ok(url.startsWith(SITE), '想定外のURL: ' + url);
	const rel = url.slice(SITE.length);
	return rel === '' || rel.endsWith('/') ? rel + 'index.html' : rel;
}

// ファイル → そのページの正しい公開URL
function fileToUrl(file) {
	return SITE + file.replace(/(^|\/)index\.html$/, '$1').replace(/^index\.html$/, '');
}

// ページ内の相対リンクを、リポジトリ内のファイルへ解決する
function resolveLink(fromFile, href) {
	if (/^(https?:|mailto:|#)/.test(href)) return null;   // 外部・ページ内は対象外
	let p;
	if (href.startsWith('/finance/')) p = href.slice('/finance/'.length);
	else if (href.startsWith('/')) p = href.slice(1);
	else p = path.posix.join(path.posix.dirname(fromFile), href);
	p = path.posix.normalize(p).replace(/^\.\//, '');
	/* サイト直下（/finance/ や ../../）は normalize が '.' にする。
	   そのままだとリポジトリ直下のディレクトリを指すことになり、
	   「存在するか」の検査が素通りしてしまうので、トップページに直す */
	if (p === '.') p = '';
	if (p === '' || p.endsWith('/')) p += 'index.html';
	return p;
}

function attr(html, re) {
	const m = html.match(re);
	return m ? m[1] : null;
}

const HTML_FILES = allHtml();
const SITEMAP_URLS = Array.from(read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1]);

test('HTMLを取りこぼさずに見ている', () => {
	assert.ok(HTML_FILES.length >= 10, '見つかったHTMLが少なすぎる: ' + HTML_FILES.length);
	assert.ok(HTML_FILES.includes('index.html'));
	assert.ok(HTML_FILES.includes('404.html'));
});

test('sitemap.xml のURLは実在するページを指す', () => {
	assert.ok(SITEMAP_URLS.length > 0, 'sitemap.xml からURLを読めていない');
	for (const url of SITEMAP_URLS) {
		const file = urlToFile(url);
		assert.ok(fs.existsSync(path.join(ROOT, file)), url + ' に対応するファイルが無い（' + file + '）');
	}
});

test('sitemap.xml に同じURLが重複していない', () => {
	assert.strictEqual(new Set(SITEMAP_URLS).size, SITEMAP_URLS.length, 'sitemap.xml に重複がある');
});

test('canonical を持つページは必ず sitemap.xml に載っている', () => {
	// ページを増やして sitemap への追加を忘れると、ここで落ちる
	const listed = new Set(SITEMAP_URLS);
	for (const file of HTML_FILES) {
		if (NO_CANONICAL.includes(file)) continue;
		const canonical = attr(read(file), /<link\s+rel="canonical"\s+href="([^"]+)"/);
		assert.ok(canonical, file + ' に canonical が無い（意図的なら test/site-links.test.js の NO_CANONICAL へ）');
		assert.ok(listed.has(canonical), file + ' が sitemap.xml に載っていない');
	}
});

test('canonical を持たないのは404とOGPの版下だけ', () => {
	for (const file of NO_CANONICAL) {
		assert.ok(HTML_FILES.includes(file), file + ' が無くなっている');
		assert.ok(!/<link\s+rel="canonical"/.test(read(file)), file + ' に canonical が付いている');
	}
});

test('canonical は自分自身の場所を指す', () => {
	for (const file of HTML_FILES) {
		if (NO_CANONICAL.includes(file)) continue;
		const canonical = attr(read(file), /<link\s+rel="canonical"\s+href="([^"]+)"/);
		assert.strictEqual(canonical, fileToUrl(file), file + ' の canonical が自分の場所と違う');
	}
});

test('og:url は canonical と一致する', () => {
	for (const file of HTML_FILES) {
		if (NO_CANONICAL.includes(file)) continue;
		const html = read(file);
		const canonical = attr(html, /<link\s+rel="canonical"\s+href="([^"]+)"/);
		const ogUrl = attr(html, /<meta\s+property="og:url"\s+content="([^"]+)"/);
		assert.strictEqual(ogUrl, canonical, file + ' の og:url が canonical と違う');
	}
});

test('og:image は実在する画像を指す', () => {
	for (const file of HTML_FILES) {
		const ogImage = attr(read(file), /<meta\s+property="og:image"\s+content="([^"]+)"/);
		if (!ogImage) continue;
		const img = urlToFile(ogImage);
		assert.ok(fs.existsSync(path.join(ROOT, img)), file + ' の og:image が無い（' + img + '）');
	}
});

test('パンくずの最後は自分自身で、名前は title と一致する', () => {
	// 名前が <title> と食い違うと検索エンジンに無視される（各ページのコメントのとおり）
	for (const file of HTML_FILES) {
		const html = read(file);
		const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
		if (!m) continue;
		const data = JSON.parse(m[1]);
		if (data['@type'] !== 'BreadcrumbList') continue;

		const items = data.itemListElement;
		const last = items[items.length - 1];
		assert.strictEqual(last.item, fileToUrl(file), file + ' のパンくずの最後が自分を指していない');

		const title = attr(html, /<title>([^<]+)<\/title>/);
		assert.strictEqual(last.name, title, file + ' のパンくずの名前が <title> と違う');

		// 先頭は必ずトップページ、position は1から順に並ぶ
		assert.strictEqual(items[0].item, SITE, file + ' のパンくずがトップページから始まっていない');
		items.forEach((it, i) => {
			assert.strictEqual(it.position, i + 1, file + ' のパンくずの position が飛んでいる');
		});
	}
});

test('ページ内のリンク先はすべて実在する', () => {
	for (const file of HTML_FILES) {
		const html = read(file);
		for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
			const target = resolveLink(file, m[1]);
			if (target === null) continue;
			assert.ok(fs.existsSync(path.join(ROOT, target)),
				file + ' のリンク先が無い: ' + m[1] + '（' + target + '）');
		}
	}
});

test('読み込んでいるCSS・JSはすべて実在する', () => {
	for (const file of HTML_FILES) {
		const html = read(file);
		for (const m of html.matchAll(/(?:src|href)="([^"?]+\.(?:css|js))(?:\?[^"]*)?"/g)) {
			const target = resolveLink(file, m[1]);
			if (target === null) continue;
			assert.ok(fs.existsSync(path.join(ROOT, target)),
				file + ' が読み込む ' + m[1] + ' が無い');
		}
	}
});

test('tool-nav.js の行き先はすべて実在し、sitemap にも載っている', () => {
	const nav = read('common/tool-nav.js');
	const tools = Array.from(nav.matchAll(/\{\s*label:\s*'([^']+)',\s*dir:\s*'([^']+)',\s*href:\s*'([^']+)'\s*\}/g))
		.map(m => ({ label: m[1], dir: m[2], href: m[3] }));

	assert.ok(tools.length > 0, 'tool-nav.js から一覧を読めていない');
	const listed = new Set(SITEMAP_URLS);

	for (const t of tools) {
		const file = t.href.endsWith('/') ? t.href + 'index.html' : t.href;
		assert.ok(fs.existsSync(path.join(ROOT, file)), t.label + ' の行き先が無い: ' + t.href);
		assert.ok(listed.has(SITE + t.href.replace(/index\.html$/, '')),
			t.label + ' の行き先が sitemap.xml に載っていない');
		// dir は「そのツールの区画」。href はその下になければ、現在地の判定がずれる
		assert.ok(t.href.startsWith(t.dir), t.label + ' の href が dir の下にない');
		assert.ok(fs.existsSync(path.join(ROOT, t.dir)), t.label + ' の区画が無い: ' + t.dir);
	}
});

test('トップページと404ページと tool-nav.js が同じツールを指している', () => {
	// トップページの各項目のリンク先（.links の中のリンク）
	const top = read('index.html');
	const topLinks = new Set(
		Array.from(top.matchAll(/<li><a href="([^"]+)">/g)).map(m => resolveLink('index.html', m[1]))
	);
	// 404ページのツリーの行き先
	const notFound = read('404.html');
	const treeLinks = new Set(
		Array.from(notFound.matchAll(/<li><a href="([^"]+)">/g)).map(m => resolveLink('404.html', m[1]))
	);

	assert.ok(topLinks.size > 0 && treeLinks.size > 0, '一覧を読めていない');
	for (const l of topLinks) {
		assert.ok(treeLinks.has(l), l + ' がトップページにあるのに404ページのツリーに無い');
	}
	// 404のツリーにはプライバシーポリシーも並ぶので、逆向きは差を許す
	const extra = Array.from(treeLinks).filter(l => !topLinks.has(l) && l !== 'privacy/index.html');
	assert.deepStrictEqual(extra, [], '404ページにあってトップページに無い行き先');
});

test('sitemap.xml のURLは canonical と同じ形（末尾のスラッシュまで）', () => {
	for (const url of SITEMAP_URLS) {
		const file = urlToFile(url);
		if (NO_CANONICAL.includes(file)) continue;
		const canonical = attr(read(file), /<link\s+rel="canonical"\s+href="([^"]+)"/);
		assert.strictEqual(url, canonical, file + ' の sitemap のURLと canonical の形が違う');
	}
});

test('外部サイトへのリンクは別タブで開き、rel に noopener が付いている', () => {
	/* 出典（国税庁・金融庁・e-Gov など）へのリンクは、試算の途中で
	   ページを離れてしまわないよう別タブで開く。target="_blank" を付けたら
	   rel="noopener" も要る（開いた先から元のタブを操作されないようにするため）。
	   出典を足すたびに手で確かめるのは続かないので、ここで見る */
	for (const file of HTML_FILES) {
		const html = read(file);
		for (const m of html.matchAll(/<a\s[^>]*href=['"]https?:\/\/[^'"]+['"][^>]*>/g)) {
			const tag = m[0];
			// 自サイトへの絶対URLは同じサイト内なので別タブにしない
			if (tag.includes('pure-create.github.io')) continue;
			assert.ok(/target=['"]_blank['"]/.test(tag),
				file + ' の外部リンクに target="_blank" が無い: ' + tag);
			assert.ok(/rel=['"][^'"]*noopener[^'"]*['"]/.test(tag),
				file + ' の外部リンクに rel="noopener" が無い: ' + tag);
		}
	}
});

test('外部リンクは https で、リンク文字が空でない', () => {
	for (const file of HTML_FILES) {
		const html = read(file);
		assert.ok(!/<a\s[^>]*href=['"]http:\/\//.test(html), file + ' に http:// のリンクがある');
		for (const m of html.matchAll(/<a\s[^>]*href=['"]https:\/\/[^'"]+['"][^>]*>([\s\S]*?)<\/a>/g)) {
			const label = m[1].replace(/<[^>]+>/g, '').trim();
			assert.ok(label.length > 0, file + ' にリンク文字が空のリンクがある: ' + m[0]);
		}
	}
});

/* ---------- ページの骨組み ---------- */

/* トップページ自身。ここだけは戻る導線も末尾の導線も持たない
   （行き先の一覧をページ本体として持っているため） */
const TOP = 'index.html';
/* OGP画像の版下。ブラウザで開いて画像を書き出すためだけのもので、
   サイトのページではないので骨組みの検査からは外す */
const NOT_A_PAGE = ['og/card.html'];
const PAGES = HTML_FILES.filter(f => !NOT_A_PAGE.includes(f));

test('どのページにも本文へのスキップリンクと、その行き先がある', () => {
	for (const file of PAGES) {
		const html = read(file);
		assert.match(html, /<a class="skip-link" href="#main">/, file + ' にスキップリンクが無い');
		assert.match(html, /id="main"/, file + ' に id="main" が無い（スキップリンクの行き先）');
	}
});

test('トップページ以外にはヘッダーの戻る導線があり、行き先はトップページ', () => {
	for (const file of PAGES) {
		const html = read(file);
		const link = attr(html, /<a class="home-link" href="([^"]+)"/);
		if (file === TOP) {
			assert.ok(!link, 'トップページに自分自身への戻る導線がある');
			continue;
		}
		assert.ok(link, file + ' にヘッダーの戻る導線（.home-link）が無い');
		assert.strictEqual(resolveLink(file, link), TOP, file + ' の戻る導線がトップページを指していない');
	}
});

test('ヘッダー行は <main> の外にあり、戻る導線はその中にある', () => {
	/* <main> の中に入れると、スキップリンクで飛んだ先がヘッダー行の上になり、
	   飛ばしたはずの導線を読まされる（404ページで実際にそうなっていた） */
	for (const file of PAGES) {
		if (file === TOP) continue;
		const html = read(file);
		const head = html.indexOf('class="site-head"');
		// 開始タグそのものを探す。ただの '<main' だと、注記の中の「<main> の外」に当たる
		const main = html.search(/<main\b[^>]*id="main"/);
		const link = html.indexOf('class="home-link"');
		assert.ok(head !== -1, file + ' にヘッダー行（.site-head）が無い');
		assert.ok(main !== -1 && head < main, file + ' のヘッダー行が <main> の中にある');
		assert.ok(link > head && link < main, file + ' の戻る導線がヘッダー行の中に無い');
	}
});

test('ページ末尾の導線があり、深さの指定がトップページを指している', () => {
	/* 404ページは行き先をツリーで丸ごと出しているので持たない */
	for (const file of PAGES) {
		const html = read(file);
		const base = attr(html, /<nav data-tool-nav="([^"]+)"><\/nav>/);
		if (file === TOP || file === '404.html') {
			assert.ok(!base, file + ' は行き先の一覧を自前で持つので、末尾の導線は要らない');
			continue;
		}
		assert.ok(base, file + ' に末尾の導線（<nav data-tool-nav>）が無い');
		// この値は tool-nav.js がリンクを組み立てる起点。ずれると全リンクがずれる
		assert.strictEqual(resolveLink(file, base), TOP, file + ' の data-tool-nav がトップページを指していない');
	}
});

test('NISAの各ページの年が、データの側にもある', () => {
	/* ページを1年ぶん増やすときは nisa-data.js に年を足し、ページには
	   const YEAR を書く。どちらかを忘れると、画面が空になるか、
	   別の年の数字を出したまま公開されてしまう */
	const years = new Set(
		[...read('nisa/nisa-data.js').matchAll(/^\t(\d{4}):\s*\{/gm)].map(m => m[1])
	);
	assert.ok(years.size > 0, 'nisa-data.js から年を読めていない');

	const pages = HTML_FILES.filter(f => /^nisa\/nisa\d{4}\.html$/.test(f));
	assert.ok(pages.length > 0, 'NISAのページを見つけられていない');
	for (const file of pages) {
		const year = attr(read(file), /const YEAR = (\d{4});/);
		assert.ok(year, file + ' に const YEAR が無い');
		assert.ok(years.has(year), file + ' の年（' + year + '）が nisa-data.js に無い');
		// ファイル名と中身の年が食い違うと、別の年の数字が出たままになる
		assert.strictEqual(file, 'nisa/nisa' + year + '.html',
			file + ' のファイル名と const YEAR（' + year + '）が食い違っている');
	}
});

test('横に長い表は、キーボードでも動かせる', () => {
	/* overflow で横に切れる箱は、tabindex が無いとキーボードだけの人が
	   右側を読めない。読み上げソフト向けに、箱の名前も要る */
	for (const file of PAGES) {
		const html = read(file);
		for (const m of html.matchAll(/<div class=['"][^'"]*table-scroll[^'"]*['"][^>]*>/g)) {
			const tag = m[0];
			assert.match(tag, /tabindex=['"]0['"]/, file + ' の横スクロールする表に tabindex="0" が無い: ' + tag);
			assert.match(tag, /role=['"]region['"]/, file + ' の横スクロールする表に role="region" が無い: ' + tag);
			assert.match(tag, /aria-label=['"][^'"]+['"]/, file + ' の横スクロールする表に aria-label が無い: ' + tag);
		}
	}
});

/* ---------- 公開対象（GitHub Pages / Jekyll） ---------- */

// _config.yml の exclude を読む（単純な箇条書きなので行で拾う）
function excludeList() {
	return [...read('_config.yml').matchAll(/^\s*-\s*([^\s#]+)/gm)]
		.map(m => m[1].replace(/\/$/, ''));
}

test('_config.yml がテストと npm の設定を公開対象から外している', () => {
	const excluded = excludeList();
	for (const name of ['test', 'package.json']) {
		assert.ok(excluded.includes(name), '_config.yml の exclude に ' + name + ' が無い');
	}
	/* exclude は Jekyll の既定を置き換えてしまうので、既定分も残っている必要がある。
	   ここが消えると、うっかり npm install したときに node_modules が公開される */
	assert.ok(excluded.includes('node_modules'), '_config.yml の exclude から node_modules が消えている');
});

test('公開に必要なファイルが exclude に巻き込まれていない', () => {
	/* exclude は前方一致で効くので、うっかり「vendor」や「common」を足すと
	   Chart.js やテーマが配信されなくなる。ページが実際に読み込んでいる
	   ファイルが除外に当たらないことを見る */
	const excluded = excludeList();
	const needed = new Set(HTML_FILES);
	for (const file of HTML_FILES) {
		for (const m of read(file).matchAll(/(?:src|href)="([^"?]+\.(?:css|js))(?:\?[^"]*)?"/g)) {
			const target = resolveLink(file, m[1]);
			if (target) needed.add(target);
		}
	}
	for (const f of needed) {
		for (const ex of excluded) {
			assert.ok(f !== ex && !f.startsWith(ex + '/'),
				f + ' が _config.yml の exclude（' + ex + '）に当たり、公開されなくなる');
		}
	}
});
