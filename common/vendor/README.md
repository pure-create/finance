# 外部ライブラリ（自前ホスト）

グラフ描画に使っている外部ライブラリを、CDNから読むのをやめてここに置いている。

## なぜ自前で持つのか

- **CDNが落ちるとグラフが出ない。** 以前は cdnjs.cloudflare.com から読んでいた。
  サイト本体はGitHub Pagesにあるので、cdnjs 側の障害でグラフだけが消える状態だった。
  自前で持てば、サイトが見えている＝グラフも出る、になる。
- **閲覧者のIPアドレスが第三者に渡らない。** CDNから読むと、ページを開いた人の
  IPアドレスとUser-Agentが cdnjs に送られる。試算内容そのものは送られないが、
  送らずに済むなら送らないほうがよい。
- **読み込みが速い。** 別ドメインへの接続（DNS・TLS）が要らなくなる。
  かつては「他サイトと共有のキャッシュに載る」という利点があったが、
  今のブラウザはサイトごとにキャッシュを分けるので、この利点は無い。

## 置いてあるもの

| ファイル | バージョン | ライセンス | 配布元 |
| --- | --- | --- | --- |
| `chart.umd.min.js` | Chart.js 4.4.1 | MIT | https://www.chartjs.org/ |
| `chartjs-plugin-datalabels.min.js` | 2.2.0 | MIT | https://chartjs-plugin-datalabels.netlify.app/ |

MITは再配布の際に著作権表示を残すことを求めているので、全文を
`LICENSE-chart.js.txt` と `LICENSE-chartjs-plugin-datalabels.txt` に置いている。

使っているページ:

- `chart.umd.min.js` … `nisa/nisa2024.html` / `nisa/nisa2025.html` / `pension/` / `inheritance/`
- `chartjs-plugin-datalabels.min.js` … `nisa/nisa2024.html` / `nisa/nisa2025.html`

## 読み込み方

```html
<script src="../common/vendor/chart.umd.min.js?v=4.4.1"></script>
```

`?v=` にはライブラリのバージョンを入れる。サイト自作のファイル（`?v=20260808a` の形）と
書き方が違うのは、こちらは中身が変わるのがバージョンを上げたときだけで、
日付よりバージョンのほうがキャッシュの区切りとして正確なため。

`integrity` は付けない。SRIは「他人のサーバーから届いたものが差し替わっていないか」を
確かめる仕組みで、同じサーバーにあるファイルに付けても意味がなく、
差し替えたときに更新を忘れるとグラフが出なくなるだけになる。

## 更新のしかた

1. 配布元から新しいバージョンを落とし、このフォルダのファイルを差し替える
2. 各ページの `?v=` をそのバージョンに変える
3. 上の表とこのファイルの記述を更新する
4. グラフのあるページを実際に開いて確認する（Chart.jsはメジャー更新で書き方が変わる）

cdnjs から落とす場合は、配布ページに載っている SRI ハッシュと突き合わせると
取り違えや破損を防げる。PowerShellでの確認例:

```powershell
$b = [System.IO.File]::ReadAllBytes("chart.umd.min.js")
[Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash($b))
# 表示された文字列が、配布ページの sha512-... と一致すればよい
```
