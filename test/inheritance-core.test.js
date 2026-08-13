/* 相続税の計算のテスト。
   期待値は国税庁の速算表から手で計算したもので、コードの出力を写したものではない。
   制度改正で税率や控除額を直したときは、まずここの数字を直すこと。

   実行: npm test   （プロジェクト直下から） */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
	taxOnShare, totalTax, simulate, smallLotReduction, insuranceExemption,
	SMALL_LOT_LIMIT, SMALL_LOT_RATE, INSURANCE_PER_HEIR
} = require('../inheritance/js/inheritance-core.js');

/* 万円単位の金額を比べる。既定では円未満のずれを無視する。
   面積で按分するところなど、丸めがもう少し大きく出る箇所は tol を渡す */
function near(actual, expected, tol, msg) {
	if (typeof tol === 'string') { msg = tol; tol = undefined; }
	assert.ok(Math.abs(actual - expected) < (tol === undefined ? 1e-6 : tol),
		(msg || '') + ' 期待 ' + expected + ' / 実際 ' + actual);
}

test('速算表：各区分の上限ちょうどの税額', () => {
	// 相続税の速算表（平成27年1月1日以後）。金額は万円
	near(taxOnShare(1000), 100, '1,000万円 10%');
	near(taxOnShare(3000), 400, '3,000万円 15%−50');
	near(taxOnShare(5000), 800, '5,000万円 20%−200');
	near(taxOnShare(10000), 2300, '1億円 30%−700');
	near(taxOnShare(20000), 6300, '2億円 40%−1,700');
	near(taxOnShare(30000), 10800, '3億円 45%−2,700');
	near(taxOnShare(60000), 25800, '6億円 50%−4,200');
	near(taxOnShare(100000), 47800, '10億円 55%−7,200');
});

test('速算表：区分の境目で税額が飛ばない', () => {
	// 控除額は「境目で連続になる」ように決まっている。
	// 片方の区分だけ直すと、ここが飛んで気付ける
	for (const lim of [1000, 3000, 5000, 10000, 20000, 30000, 60000]) {
		const below = taxOnShare(lim);
		const above = taxOnShare(lim + 0.01);
		assert.ok(above >= below, lim + '万円の前後で税額が減っている');
		assert.ok(above - below < 0.01, lim + '万円の境目で税額が飛んでいる');
	}
});

test('速算表：0以下は課税されない', () => {
	near(taxOnShare(0), 0);
	near(taxOnShare(-100), 0);
});

test('基礎控除ちょうどでは相続税がかからない', () => {
	// 配偶者＋子1人 ＝ 法定相続人2人 → 3,000＋600×2 ＝ 4,200万円
	near(totalTax(4200, true, 1), 0, '基礎控除ちょうど');
	near(totalTax(4199, true, 1), 0, '基礎控除未満');
	// 1万円超えると、その1万円だけが課税対象になる
	near(totalTax(4201, true, 1), 0.1, '基礎控除＋1万円');

	// 子3人（配偶者なし）＝ 3,000＋600×3 ＝ 4,800万円
	near(totalTax(4800, false, 3), 0, '子3人の基礎控除ちょうど');
});

test('相続税の総額（教科書どおりの例）', () => {
	// 遺産1億円・配偶者＋子2人:
	//   課税遺産総額 10,000−4,800 ＝ 5,200
	//   配偶者 2,600 → 2,600×15%−50 ＝ 340
	//   子 各1,300 → 1,300×15%−50 ＝ 145、2人で290
	near(totalTax(10000, true, 2), 630, '1億円・配偶者と子2人');

	// 遺産1億円・子1人のみ:
	//   課税遺産総額 10,000−3,600 ＝ 6,400 → 6,400×30%−700 ＝ 1,220
	near(totalTax(10000, false, 1), 1220, '1億円・子1人');

	// 配偶者のみ（子なし）: 課税遺産総額の全額に1人分の税率
	//   10,000−3,600 ＝ 6,400 → 1,220
	near(totalTax(10000, true, 0), 1220, '1億円・配偶者のみ');
});

test('配偶者の税額軽減：1億6,000万円までは配偶者に税額が出ない', () => {
	// 遺産1.6億円を配偶者が全部取得 → 軽減の上限ちょうどで税額ゼロ
	const r = simulate(16000, 0, true, 1, 100, 0, 10);
	near(r.spTax, 0, '配偶者の税額');
	near(r.first, 0, '一次相続の税額合計');

	// 1.6億円を超えた分には税額が出る
	const over = simulate(20000, 0, true, 1, 100, 0, 10);
	// 総額 3,340（課税遺産総額 15,800 → 配偶者・子 各7,900 → 各1,670）
	near(over.total1, 3340, '相続税の総額');
	// 軽減されるのは 16,000/20,000 ＝ 8割 → 残り2割が配偶者の負担
	near(over.spTax, 668, '軽減後の配偶者の税額');
});

test('配偶者の税額軽減：法定相続分までなら額が大きくても税額ゼロ', () => {
	// 4億円を法定相続分（1/2 ＝ 2億円）だけ取得 → 1.6億円より法定相続分が大きい
	const r = simulate(40000, 0, true, 1, 50, 0, 10);
	near(r.spTax, 0, '法定相続分どおりに取得した配偶者の税額');
});

test('相次相続控除：10年で切れる', () => {
	// 2億円・配偶者が全部取得・配偶者の固有資産0
	//   一次: 配偶者の税額 668 → 二次の遺産 20,000−668 ＝ 19,332
	//   二次: 19,332−3,600 ＝ 15,732 → 15,732×40%−1,700 ＝ 4,592.8
	const base = { me: 20000, sp: 0, pct: 100 };
	const at10 = simulate(base.me, base.sp, true, 1, base.pct, 0, 10);
	near(at10.deduct, 0, '10年経過後は控除なし');
	near(at10.second, 4592.8, '二次相続の税額');

	// 9年 → 控除は「配偶者が納めた税額 668」の 1/10
	const at9 = simulate(base.me, base.sp, true, 1, base.pct, 0, 9);
	near(at9.deduct, 66.8, '9年経過時の相次相続控除');
	near(at9.second, 4526, '控除後の二次相続の税額');

	// 0年（すぐに二次相続）→ 全額（10/10）が控除される
	const at0 = simulate(base.me, base.sp, true, 1, base.pct, 0, 0);
	near(at0.deduct, 668, '0年経過時の相次相続控除');

	// 経過年数が延びるほど控除は減る
	let prev = Infinity;
	for (let y = 0; y <= 10; y++) {
		const d = simulate(base.me, base.sp, true, 1, base.pct, 0, y).deduct;
		assert.ok(d <= prev + 1e-9, y + '年で控除額が増えている');
		prev = d;
	}
});

test('相次相続控除は二次相続の税額を超えない', () => {
	// 二次の税額より控除のほうが大きくなる形でも、税額はマイナスにならない
	const r = simulate(40000, 0, true, 3, 100, -30000, 0);
	assert.ok(r.second >= 0, '二次相続の税額がマイナス');
	assert.ok(r.deduct <= r.second + r.deduct + 1e-9);
});

test('配偶者がいない場合は二次相続が起きない', () => {
	const r = simulate(10000, 5000, false, 2, 50, 0, 5);
	near(r.second, 0, '二次相続の税額');
	near(r.first, r.total1, '一次相続の税額');
	near(r.keep, 10000 - r.total1, '子に残る額');
});

test('子に残る額＝総資産−税額合計', () => {
	const r = simulate(15000, 3000, true, 2, 40, 500, 6);
	// 総資産 ＝ 自分15,000 ＋ 配偶者3,000 ＋ 増減500
	near(r.keep, 15000 + 3000 + 500 - r.grand, '手残りと税額合計の関係');
	near(r.grand, r.first + r.second, '税額合計');
});

test('取得割合を動かしても税額合計は有限で、最小になる割合が存在する', () => {
	let best = Infinity, bestPct = -1;
	for (let p = 0; p <= 100; p++) {
		const r = simulate(20000, 3000, true, 2, p, 0, 10);
		assert.ok(Number.isFinite(r.grand), p + '%で税額合計が数値でない');
		assert.ok(r.grand >= 0, p + '%で税額合計がマイナス');
		if (r.grand < best) { best = r.grand; bestPct = p; }
	}
	assert.ok(bestPct >= 0 && bestPct <= 100);
});

test('資産ゼロでも壊れない', () => {
	const r = simulate(0, 0, true, 1, 50, 0, 5);
	near(r.grand, 0);
	near(r.keep, 0);
});

/* ---------- 小規模宅地等の特例（特定居住用宅地等） ---------- */

test('特例の限度面積と減額割合', () => {
	assert.strictEqual(SMALL_LOT_LIMIT, 330);
	assert.strictEqual(SMALL_LOT_RATE, 0.80);
});

test('特例の減額：330㎡までは評価額の80%', () => {
	near(smallLotReduction(5000, 200), 4000, 1e-9, '200㎡');
	near(smallLotReduction(5000, 330), 4000, 1e-9, '330㎡ちょうど');
	near(smallLotReduction(0, 200), 0, 1e-9, '土地なし');
});

test('特例の減額：330㎡を超える分は対象外', () => {
	// 660㎡なら半分（330㎡）だけが対象 → 5,000×0.5×80% ＝ 2,000
	near(smallLotReduction(5000, 660), 2000, 1e-9, '660㎡');
	// 面積が増えるほど、減額は330㎡ぶんに収束する
	near(smallLotReduction(5000, 3300), 5000 * 0.1 * 0.8, 1e-9, '3,300㎡');
	// 限度面積の前後で減額が飛ばない（330㎡をわずかに超えたところで連続）
	near(smallLotReduction(5000, 330.001), smallLotReduction(5000, 330), 0.05, '境目');
});

test('特例の減額：面積が未入力なら限度面積とみなす', () => {
	near(smallLotReduction(5000, 0), 4000, 1e-9);
});

test('特例も非課税枠も使わなければ、これまでと同じ結果になる', () => {
	// opts を渡さない場合と、額を0で渡した場合が一致すること
	const withoutArg = simulate(20000, 3000, true, 2, 50, 0, 5);
	const zeroOpts = simulate(20000, 3000, true, 2, 50, 0, 5,
		{ land: { value: 0, area: 200, first: true, second: true }, insurance: 0 });
	assert.deepStrictEqual(zeroOpts, withoutArg, '既存の共有URLの結果が変わってはいけない');
	near(withoutArg.cut1, 0);
	near(withoutArg.cut2, 0);
	near(withoutArg.cutIns, 0);
});

test('一次相続で特例を使うと、その分だけ課税価格が下がる', () => {
	const land = { land: { value: 5000, area: 200, first: true, second: false } };
	const r = simulate(20000, 0, true, 1, 50, 0, 10, land);
	near(r.cut1, 4000, 1e-9, '減額（5,000×80%）');
	near(r.taxable1, 16000, 1e-9, '課税価格');
	// 課税価格1.6億円・配偶者＋子1人 → 基礎控除4,200 → 課税遺産総額11,800
	//   配偶者・子 各5,900 → 5,900×30%−700 ＝ 1,070、合計2,140
	near(r.total1, 2140, 1e-9, '相続税の総額');
	// 法定相続分どおり（50%）の取得なので配偶者の税額はゼロ、子だけが負担
	near(r.spTax, 0, 1e-9);
	near(r.first, 1070, 1e-9, '一次相続の税額');
});

test('特例を使っても、実際に受け継ぐ財産の額は減らない', () => {
	// 課税価格は下がるが、手残りは「減額前の資産−税額」のまま
	const land = { land: { value: 5000, area: 200, first: true, second: false } };
	const r = simulate(20000, 3000, true, 2, 50, 500, 10, land);
	near(r.keep, 20000 + 3000 + 500 - r.grand, 1e-9, '手残りと税額合計の関係');
	// 二次の遺産額も減額前の実額で積み上げる
	near(r.estate2, 3000 + 10000 - r.spTax + 500, 1e-9);
});

test('特例を使うと税額は必ず下がる（同じ条件の比較）', () => {
	const base = [30000, 5000, true, 2, 50, 0, 10];
	const off = simulate(...base, { land: { value: 8000, area: 200, first: false, second: false } });
	const on1 = simulate(...base, { land: { value: 8000, area: 200, first: true, second: false } });
	const both = simulate(...base, { land: { value: 8000, area: 200, first: true, second: true } });
	assert.ok(on1.first < off.first, '一次で特例を使っても税額が下がっていない');
	assert.ok(both.second < on1.second, '二次で特例を使っても税額が下がっていない');
	assert.ok(both.grand < on1.grand && on1.grand < off.grand, '合計税額の大小関係');
});

test('二次相続の特例は、配偶者が取得した割合ぶんだけ効く', () => {
	const land = { land: { value: 6000, area: 200, first: true, second: true } };
	// 配偶者が100%取得 → 自宅もすべて配偶者の手に渡る
	const all = simulate(30000, 0, true, 1, 100, 0, 10, land);
	near(all.cut2, 4800, 1e-9, '6,000×80%');
	// 半分だけ取得 → 二次にある自宅も半分
	const half = simulate(30000, 0, true, 1, 50, 0, 10, land);
	near(half.cut2, 2400, 1e-9, '3,000×80%');
	// まったく取得しない → 自宅は配偶者の手に渡らないので二次では対象なし
	const none = simulate(30000, 0, true, 1, 0, 0, 10, land);
	near(none.cut2, 0, 1e-9);
});

test('二次相続の特例は、面積の限度も取得割合に応じて見る', () => {
	// 660㎡のうち半分（330㎡）を配偶者が取得 → 限度内に収まるので全額が80%減額
	const land = { land: { value: 6000, area: 660, first: true, second: true } };
	const half = simulate(30000, 0, true, 1, 50, 0, 10, land);
	near(half.cut2, 3000 * 0.8, 1e-9, '取得した3,000万円分がまるごと対象');
	// 一次のほうは660㎡のままなので、半分だけが対象
	near(half.cut1, 6000 * 0.5 * 0.8, 1e-9);
});

test('特例の減額は遺産額を超えない', () => {
	// 資産より大きい土地評価額を入れても、課税価格はマイナスにならない
	const r = simulate(3000, 0, true, 1, 100, 0, 10, { land: { value: 9000, area: 100, first: true, second: true } });
	assert.ok(r.taxable1 >= 0, '一次の課税価格がマイナス');
	assert.ok(r.taxable2 >= 0, '二次の課税価格がマイナス');
	near(r.grand, 0, 1e-9, '基礎控除以下なので税額なし');
});

test('配偶者がいない場合でも一次の特例は効く', () => {
	const off = simulate(20000, 0, false, 1, 0, 0, 10, { land: { value: 5000, area: 200, first: false, second: false } });
	const on = simulate(20000, 0, false, 1, 0, 0, 10, { land: { value: 5000, area: 200, first: true, second: false } });
	near(on.cut1, 4000, 1e-9);
	assert.ok(on.first < off.first, '子だけが相続する場合も税額が下がる');
	near(on.cut2, 0, 1e-9, '配偶者がいなければ二次相続は起きない');
});

test('特例を使っても、取得割合を動かした税額合計は有限で正', () => {
	const land = { land: { value: 8000, area: 400, first: true, second: true } };
	for (let p = 0; p <= 100; p++) {
		const r = simulate(25000, 4000, true, 2, p, -1000, 3, land);
		assert.ok(Number.isFinite(r.grand) && r.grand >= 0, p + '%で税額合計が不正');
		assert.ok(Number.isFinite(r.keep) && r.keep >= 0, p + '%で手残りが不正');
	}
});

/* ---------- 生命保険金の非課税枠 ---------- */

test('非課税枠は法定相続人1人あたり500万円', () => {
	assert.strictEqual(INSURANCE_PER_HEIR, 500);
	near(insuranceExemption(3000, 1), 500, '相続人1人');
	near(insuranceExemption(3000, 3), 1500, '相続人3人');
	near(insuranceExemption(3000, 7), 3000, '枠が保険金を上回れば保険金が上限');
});

test('非課税枠：保険金が枠に満たなければ保険金の額まで', () => {
	near(insuranceExemption(800, 3), 800, '枠1,500に対して保険金800');
	near(insuranceExemption(1500, 3), 1500, '枠ちょうど');
	near(insuranceExemption(1501, 3), 1500, '枠を1万円超える');
});

test('非課税枠：保険金なし・相続人なしでは0', () => {
	near(insuranceExemption(0, 3), 0);
	near(insuranceExemption(3000, 0), 0);
	near(insuranceExemption(-100, 3), 0);
});

test('生命保険の非課税枠は一次相続の課税価格を下げる', () => {
	// 配偶者＋子1人 ＝ 相続人2人 → 枠は1,000万円
	const r = simulate(20000, 0, true, 1, 50, 0, 10, { insurance: 3000 });
	near(r.cutIns, 1000, 1e-9, '非課税枠');
	near(r.taxable1, 19000, 1e-9, '課税価格');
	// 課税価格1.9億円 → 基礎控除4,200 → 課税遺産総額14,800
	//   配偶者・子 各7,400 → 7,400×30%−700 ＝ 1,520、合計3,040
	near(r.total1, 3040, 1e-9, '相続税の総額');
});

test('非課税枠は法定相続人が増えるほど大きくなる', () => {
	const one = simulate(20000, 0, true, 1, 50, 0, 10, { insurance: 5000 });
	const three = simulate(20000, 0, true, 3, 50, 0, 10, { insurance: 5000 });
	near(one.cutIns, 1000, 1e-9, '配偶者＋子1人');
	near(three.cutIns, 2000, 1e-9, '配偶者＋子3人');
	assert.ok(three.taxable1 < one.taxable1, '枠が大きいほど課税価格は小さい');
});

test('非課税枠は二次相続には効かない（配偶者自身の保険は扱わない）', () => {
	const r = simulate(20000, 3000, true, 1, 100, 0, 10, { insurance: 3000 });
	// 二次で下がるのは小規模宅地だけ。保険の枠は一次で使い切っている
	near(r.cut2, 0, 1e-9);
	near(r.taxable2, r.estate2, 1e-9);
});

test('保険金を受け取っても、手残りは実額のまま', () => {
	// 非課税枠は課税価格を下げるだけで、受け取る保険金そのものは減らない
	const r = simulate(20000, 3000, true, 2, 50, 0, 10, { insurance: 2000 });
	near(r.keep, 20000 + 3000 - r.grand, 1e-9);
});

test('小規模宅地等の特例と非課税枠は同時に効く', () => {
	const opts = {
		land: { value: 5000, area: 200, first: true, second: false },
		insurance: 2000,
	};
	const r = simulate(30000, 0, true, 1, 50, 0, 10, opts);
	near(r.cut1, 4000, 1e-9, '宅地の減額');
	near(r.cutIns, 1000, 1e-9, '保険の非課税枠');
	near(r.taxable1, 25000, 1e-9, '両方を引いた課税価格');
});

test('2つを合わせても遺産総額を超えて減らない', () => {
	// 土地も保険も資産額いっぱいに入れた極端な場合
	const opts = {
		land: { value: 4000, area: 100, first: true, second: true },
		insurance: 4000,
	};
	const r = simulate(4000, 0, true, 3, 100, 0, 10, opts);
	assert.ok(r.taxable1 >= 0, '課税価格がマイナス');
	near(r.cut1 + r.cutIns, 4000, 1e-9, '減額の合計は遺産総額まで');
	near(r.grand, 0, 1e-9, '課税価格0なので税額なし');
});

test('非課税枠を使っても、取得割合を動かした結果は壊れない', () => {
	const opts = {
		land: { value: 6000, area: 400, first: true, second: true },
		insurance: 3000,
	};
	for (let p = 0; p <= 100; p++) {
		const r = simulate(25000, 4000, true, 2, p, -500, 4, opts);
		assert.ok(Number.isFinite(r.grand) && r.grand >= 0, p + '%で税額合計が不正');
		assert.ok(Number.isFinite(r.keep) && r.keep >= 0, p + '%で手残りが不正');
	}
});
