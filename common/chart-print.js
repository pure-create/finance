/* =============================================================
   印刷の前にグラフを描き直させる

   【なぜ要るか】
     ツールチップは canvas に描き込まれるので、グラフにマウスを載せたまま
     印刷すると、そのまま紙にも載ってしまう。

     ふだんは beforeprint でテーマがライトに固定され、各ページが
     Theme.onChange でグラフを描き直すため消える。ただし theme.js は
     二重に動かないよう「前の印刷が終わっていなければ何もしない」という
     作りになっており、afterprint が来ないまま次の印刷に入ると
     （印刷ダイアログをキャンセルしたときなど）再描画がまるごと飛ばされる。
     刷り直しは利かないので、テーマとは別の経路でも描き直しておく。

   【なぜ登録してもらう形か】
     ここで canvas から Chart.getChart() を引いて render() するだけでは
     ツールチップは消えない。選択を setActiveElements で外しても、
     描き直しのときに組み立て直されてしまう。確実なのは作り直しだが、
     ここで destroy すると各ページが持っているグラフへの参照が古くなる。
     そこで、作り直し方はページに任せ、印刷を捕まえる側だけをここに置く。

   【各ページですること】
     グラフを作り直す関数を渡す。テーマが変わったときと同じ内容でよい。

       ChartPrint.onPrint(() => {
         if (chart) { chart.destroy(); chart = null; }
         update();
       });
   ============================================================= */
(function (global) {
	'use strict';

	var handlers = [];

	function redraw() {
		for (var i = 0; i < handlers.length; i++) {
			handlers[i]();
		}
	}

	global.ChartPrint = {
		onPrint: function (fn) { if (typeof fn === 'function') handlers.push(fn); }
	};

	global.addEventListener('beforeprint', redraw);

	/* beforeprint を出さないブラウザ向け。印刷用のスタイルに
	   切り替わった時点で拾う */
	if (global.matchMedia) {
		var printQuery = global.matchMedia('print');
		if (printQuery.addEventListener) {
			printQuery.addEventListener('change', function (e) {
				if (e.matches) redraw();
			});
		}
	}
})(window);
