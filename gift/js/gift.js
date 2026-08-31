/* 贈与税ページの表示・保存・共有。計算は gift-core.js に分離してある。 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    fmt = (n) =>
      Number(n || 0).toLocaleString("ja-JP", { maximumFractionDigits: 1 }),
    yen = (n) => fmt(n) + "万円";
  const fields = [
    ["estate", 10000, "e"],
    ["children", 2, "ch"],
    ["rate", 5, "r"],
    ["years", 20, "y"],
    ["considerCapitalGainsTax", false, "cgt"],
    ["unrealizedGain", 0, "ug"],
    ["giftMethod", "cash", "gm"],
    ["childAge1", 20, "a1"],
    ["childAge2", 18, "a2"],
    ["childAge3", 20, "a3"],
    ["childAge4", 20, "a4"],
    ["childAge5", 20, "a5"],
    ["childAge6", 20, "a6"],
  ];
  const inputs = Inputs.create({ fields, storageKey: "giftTaxSim.v2" });
  let charts = [],
    current,
    currentSweep;
  function options() {
    const children = Math.max(
      1,
      Math.min(6, Math.floor(+$("children").value || 1)),
    );
    return {
      estate: +$("estate").value,
      children,
      rate: +$("rate").value,
      years: +$("years").value,
      startYear: SIM_START_YEAR,
      considerCapitalGainsTax: $("considerCapitalGainsTax").checked,
      unrealizedGain: +$("unrealizedGain").value,
      giftMethod: $("giftMethod").value,
      childAges: Array.from(
        { length: children },
        (_, i) => +$("childAge" + (i + 1)).value,
      ),
    };
  }
  function updateRanges() {
    $("rateVal").textContent = (+$("rate").value).toFixed(1) + "%";
  }
  function updateChildAgeInputs() {
    const n = Math.max(1, Math.min(6, Math.floor(+$("children").value || 1)));
    document
      .querySelectorAll(".child-age")
      .forEach((el, i) => (el.hidden = i >= n));
  }
  function updateCapitalGainsInputs() {
    const enabled = $("considerCapitalGainsTax").checked;
    const estate = Math.max(0, +$("estate").value || 0);
    const gain = $("unrealizedGain");
    const method = $("giftMethod");
    gain.disabled = !enabled;
    method.disabled = !enabled;
    gain.max = String(estate);
    if (+gain.value > estate) gain.value = String(estate);
    $("unrealizedGainField").classList.toggle("is-disabled", !enabled);
    $("giftMethodField").classList.toggle("is-disabled", !enabled);
  }
  function niceTickStep(max) {
    const target = Math.max(100, max / 6),
      power = Math.pow(10, Math.floor(Math.log10(target))),
      ratio = target / power;
    return (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
  }
  const taxMinimumMarker = {
    id: "taxMinimumMarker",
    afterDatasetsDraw(chart, args, opts) {
      const value = Number(opts && opts.value);
      if (
        !Number.isFinite(value) ||
        value < chart.scales.x.min ||
        value > chart.scales.x.max
      )
        return;
      const {
          ctx,
          chartArea: { top, bottom, left, right },
          scales: { x },
        } = chart,
        px = x.getPixelForValue(value),
        color = Theme.color("--gift-keep");
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "700 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = "税負担最小 " + fmt(value) + "万円/人",
        cx = Math.min(Math.max(px, left + 62), right - 62);
      ctx.fillText(label, cx, top + 5);
      ctx.restore();
    },
  };
  function lineChart(id, labels, datasets, yTitle, taxMinimum) {
    const ctx = $(id),
      css = getComputedStyle(document.documentElement),
      text = css.getPropertyValue("--text").trim(),
      muted = css.getPropertyValue("--muted").trim(),
      grid = css.getPropertyValue("--grid").trim(),
      maxX = Number(labels[labels.length - 1] || 0),
      step = niceTickStep(maxX),
      series = datasets.map((d) =>
        Object.assign({}, d, {
          data: d.data.map((y, i) => ({ x: Number(labels[i]), y })),
        }),
      ),
      legendLabels = (chart) =>
        Chart.defaults.plugins.legend.labels
          .generateLabels(chart)
          .map((item) => {
            const d = chart.data.datasets[item.datasetIndex],
              dashed = Array.isArray(d.borderDash) && d.borderDash.length;
            item.pointStyle = "line";
            item.lineDash = dashed ? d.borderDash : [];
            item.lineWidth = dashed ? Math.min(3, d.borderWidth || 2) : 1;
            item.fillStyle = "transparent";
            return item;
          });
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(ctx, {
      type: "line",
      data: { datasets: series },
      plugins: [taxMinimumMarker],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: text,
              usePointStyle: true,
              pointStyleWidth: 42,
              boxWidth: 42,
              boxHeight: 8,
              generateLabels: legendLabels,
            },
          },
          tooltip: {
            callbacks: {
              title: (items) =>
                "年間贈与額 " + fmt(items[0].parsed.x) + "万円 / 子1人",
              label: (item) => item.dataset.label + ": " + yen(item.parsed.y),
            },
            backgroundColor: Theme.color("--tooltip-bg"),
            titleColor: Theme.color("--tooltip-text"),
            bodyColor: Theme.color("--tooltip-text"),
            borderColor: Theme.color("--tooltip-border"),
            borderWidth: 1,
          },
          taxMinimumMarker: { value: taxMinimum },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: maxX,
            ticks: {
              color: muted,
              stepSize: step,
              maxTicksLimit: 8,
              callback: (v) => Number(v).toLocaleString("ja-JP"),
            },
            grid: { color: grid },
            border: { color: grid },
            title: {
              display: true,
              text: "年間贈与額 / 子1人（万円）",
              color: muted,
            },
          },
          y: {
            ticks: {
              color: muted,
              callback: (v) => Number(v).toLocaleString("ja-JP"),
            },
            grid: { color: grid },
            border: { color: grid },
            title: { display: true, text: yTitle, color: muted },
          },
        },
      },
    });
  }
  function quickCells(a) {
    const g = giftTax(a, "general"),
      s = giftTax(a, "special");
    return (
      "<td>" +
      yen(s.tax) +
      "</td><td>" +
      s.effectiveRate.toFixed(2) +
      "%</td><td>" +
      yen(g.tax) +
      "</td><td>" +
      g.effectiveRate.toFixed(2) +
      "%</td>"
    );
  }
  function renderQuick() {
    const rows = [];
    for (let a = 0; a <= 5000; a += 100) {
      const high = a > 1000,
        button =
          a < 5000
            ? '<button class="quick-expand" type="button" data-start="' +
              a +
              '" data-tooltip="次の100万円までを10万円刻みで表示します。" aria-expanded="false" aria-label="' +
              fmt(a) +
              "万円から" +
              fmt(a + 100) +
              '万円までを10万円刻みで表示"><span class="quick-arrow" aria-hidden="true">▽</span></button>'
            : "";
      rows.push(
        '<tr class="quick-major' +
          (high ? " quick-high" : "") +
          '"' +
          (high ? " hidden" : "") +
          "><td><span>" +
          fmt(a) +
          "</span>" +
          button +
          "</td>" +
          quickCells(a) +
          "</tr>",
      );
      for (let d = a + 10; d < a + 100 && d <= 5000; d += 10)
        rows.push(
          '<tr class="quick-detail' +
            (high ? " quick-high" : "") +
            '" data-group="' +
            a +
            '" hidden><td>' +
            fmt(d) +
            "</td>" +
            quickCells(d) +
            "</tr>",
        );
    }
    $("quickBody").innerHTML = rows.join("");
  }
  let activeTipTarget = null;
  function hideQuickTip() {
    activeTipTarget = null;
    $("quickFloatTip").hidden = true;
  }
  function showQuickTip(target) {
    const tip = $("quickFloatTip");
    activeTipTarget = target;
    tip.textContent = target.dataset.tooltip;
    tip.hidden = false;
    const r = target.getBoundingClientRect(),
      t = tip.getBoundingClientRect(),
      gap = 8;
    let left = Math.max(
        12,
        Math.min(innerWidth - t.width - 12, r.left + r.width / 2 - t.width / 2),
      ),
      top = r.bottom + gap;
    if (top + t.height > innerHeight - 12) top = r.top - t.height - gap;
    tip.style.left = left + "px";
    tip.style.top = Math.max(12, top) + "px";
  }
  function renderComparison(o) {
    currentSweep = adaptiveSweep(o, 1000, 1000, 10);
    const base = currentSweep[0],
      comparisonMax = currentSweep[currentSweep.length - 1].annual,
      bestTax = currentSweep.reduce((a, b) =>
        a.taxTotal < b.taxTotal ? a : b,
      ),
      bestKeep = currentSweep.reduce((a, b) =>
        a.finalKeep > b.finalKeep ? a : b,
      );
    current = bestKeep;
    $("best").innerHTML =
      "税負担合計が最小: <strong>" +
      fmt(bestTax.annual) +
      "万円 / 子1人・年</strong>（" +
      yen(bestTax.taxTotal) +
      "）　/　最終手残りが最大: <strong>" +
      fmt(bestKeep.annual) +
      "万円 / 子1人・年</strong>（" +
      yen(bestKeep.finalKeep) +
      '）<br><span class="note">比較範囲: 0〜' +
      fmt(comparisonMax) +
      "万円 / 子1人・年</span>";
    const highlighted = new Set([bestKeep.annual]);
    let rows = [];
    currentSweep.forEach((x) => {
      const hundredStep = x.annual % 100 === 0,
        visible = hundredStep || highlighted.has(x.annual),
        group = Math.floor(x.annual / 100) * 100,
        button =
          hundredStep && x.annual < comparisonMax
            ? '<button class="quick-expand compare-expand" type="button" data-start="' +
              x.annual +
              '" data-tooltip="次の100万円までを10万円刻みで表示します。" aria-expanded="false" aria-label="' +
              fmt(x.annual) +
              "万円から" +
              fmt(x.annual + 100) +
              '万円までを10万円刻みで表示"><span class="quick-arrow" aria-hidden="true">▽</span></button>'
            : "",
        classes = [visible ? "compare-major" : "compare-detail"];
      if (x === bestKeep) classes.push("chosen");
      rows.push(
        '<tr class="' +
          classes.join(" ") +
          '"' +
          (visible ? "" : ' data-group="' + group + '" hidden') +
          "><td><span>" +
          fmt(x.annual) +
          "</span>" +
          button +
          "</td><td>" +
          yen(x.giftTotal) +
          "</td><td>" +
          yen(x.giftTax) +
          "</td><td>" +
          yen(x.inheritanceTax) +
          "</td><td>" +
          yen(x.capitalGainsTax) +
          "</td><td>" +
          yen(x.taxTotal) +
          "</td><td>" +
          yen(x.finalKeep) +
          "</td><td>" +
          (x.finalKeep - base.finalKeep >= 0 ? "+" : "") +
          yen(x.finalKeep - base.finalKeep) +
          "</td></tr>",
      );
    });
    $("compareBody").innerHTML = rows.join("");
    const labels = currentSweep.map((x) => x.annual),
      ds = (label, data, color, style) =>
        Object.assign(
          {
            label,
            data,
            borderColor: color,
            backgroundColor: color,
            tension: 0.18,
            pointRadius: 0,
            borderWidth: 2,
          },
          style || {},
        );
    lineChart(
      "keepChart",
      labels,
      [
        ds(
          "最終手残り",
          currentSweep.map((x) => x.finalKeep),
          "#7c3aed",
        ),
        ds(
          "生前贈与なしの最終手残り（基準）",
          currentSweep.map(() => base.finalKeep),
          "#64748b",
          { borderDash: [7, 5], borderWidth: 2 },
        ),
      ],
      "万円",
      bestTax.annual,
    );
    lineChart(
      "burdenChart",
      labels,
      [
        ds(
          "税負担合計",
          currentSweep.map((x) => x.taxTotal),
          "#7c3aed",
          { borderDash: [8, 5], borderWidth: 5, order: 3 },
        ),
        ds(
          "相続税",
          currentSweep.map((x) => x.inheritanceTax),
          "#2563eb",
          { order: 2 },
        ),
        ds(
          "売却益税",
          currentSweep.map((x) => x.capitalGainsTax),
          "#d97706",
          { order: 2 },
        ),
        ds(
          "累計贈与税",
          currentSweep.map((x) => x.giftTax),
          "#dc2626",
          { order: 1 },
        ),
      ],
      "万円",
      bestTax.annual,
    );
    $("bestAnnualTile").textContent = fmt(bestKeep.annual) + "万円/人";
    $("giftTaxTile").textContent = yen(bestKeep.giftTax);
    $("inheritanceTaxTile").textContent = yen(bestKeep.inheritanceTax);
    $("capitalGainsTaxTile").textContent = yen(bestKeep.capitalGainsTax);
    $("totalTaxTile").textContent = yen(bestKeep.taxTotal);
    $("finalKeepTile").textContent = yen(bestKeep.finalKeep);
    const totalTaxDiff = base.taxTotal - bestKeep.taxTotal;
    const finalKeepDiff = base.finalKeep - bestKeep.finalKeep;
    $("noGiftTotalTax").textContent =
      yen(base.taxTotal) +
      "（差額" +
      (totalTaxDiff >= 0 ? "+" : "") +
      yen(totalTaxDiff) +
      "）";
    $("noGiftFinalKeep").textContent =
      yen(base.finalKeep) +
      "（" +
      (finalKeepDiff >= 0 ? "+" : "") +
      yen(finalKeepDiff) +
      "）";
    $("shortfall").hidden = !currentSweep.some((x) => x.shortfall);
  }
  function categoryLabel(x) {
    const p = [];
    if (x.generalChildren) p.push("一般 " + x.generalChildren + "人");
    if (x.specialChildren) p.push("特例 " + x.specialChildren + "人");
    return p.join("／");
  }
  function renderTimeline() {
    const rows = current.detail.map((x) => {
      const title = x.event.includes("贈与加算対象↓")
        ? ' title="相続前贈与加算の対象期間開始"'
        : "";
      return (
        '<tr class="' +
        (x.event ? "event" : "") +
        '"><td>' +
        x.year +
        "</td><td>" +
        yen(x.asset) +
        "</td><td>" +
        yen(x.gift) +
        "</td><td>" +
        yen(x.giftTax) +
        "</td><td>" +
        yen(x.capitalGainsTax) +
        "</td><td>" +
        categoryLabel(x) +
        "</td><td>" +
        yen(x.childGift) +
        '</td><td class="timeline-event"' +
        title +
        ">" +
        x.event +
        "</td></tr>"
      );
    });
    $("timelineBody").innerHTML = rows.join("");
    $("timelineNote").innerHTML =
      "年間 <strong>" +
      fmt(current.annual) +
      "万円 / 子1人</strong>を贈与するケースです。各年1月1日時点の年齢で、子どもごとに一般・特例税率を判定します。";
    if (current.considerCapitalGainsTax)
      $("timelineNote").innerHTML +=
        current.giftMethod === "cash"
          ? " 売却益税は、各年に現金贈与を行うための親側の売却分と、相続年の全資産売却分です。"
          : " 売却益税は、各年の贈与税支払いに伴う受贈資産の売却分と、相続年の全資産売却分です。";
  }
  function update() {
    updateChildAgeInputs();
    updateCapitalGainsInputs();
    const o = options();
    updateRanges();
    renderComparison(o);
    renderTimeline();
    inputs.save();
    Share.refreshQr();
  }
  fields.forEach((f) => {
    const e = $(f[0]);
    if (e) {
      e.addEventListener("input", update);
      e.addEventListener("change", update);
    }
  });
  $("resetBtn").onclick = () => {
    inputs.applyDefaults();
    try {
      history.replaceState(null, "", location.pathname);
    } catch (e) {}
    update();
  };
  $("quickBody").addEventListener("click", (e) => {
    const b = e.target.closest(".quick-expand");
    if (!b) return;
    const open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", open ? "true" : "false");
    b.querySelector(".quick-arrow").textContent = open ? "△" : "▽";
    b.setAttribute(
      "aria-label",
      fmt(+b.dataset.start) +
        "万円から" +
        fmt(+b.dataset.start + 100) +
        "万円までの10万円刻みを" +
        (open ? "閉じる" : "表示"),
    );
    document
      .querySelectorAll('.quick-detail[data-group="' + b.dataset.start + '"]')
      .forEach((row) => (row.hidden = !open));
  });
  $("compareBody").addEventListener("click", (e) => {
    const b = e.target.closest(".compare-expand");
    if (!b) return;
    const open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", open ? "true" : "false");
    b.querySelector(".quick-arrow").textContent = open ? "△" : "▽";
    b.setAttribute(
      "aria-label",
      fmt(+b.dataset.start) +
        "万円から" +
        fmt(+b.dataset.start + 100) +
        "万円までの10万円刻みを" +
        (open ? "閉じる" : "表示"),
    );
    document
      .querySelectorAll('.compare-detail[data-group="' + b.dataset.start + '"]')
      .forEach((row) => (row.hidden = !open));
  });
  $("quickMore").onclick = () => {
    const open = $("quickMore").getAttribute("aria-expanded") !== "true";
    $("quickMore").setAttribute("aria-expanded", open ? "true" : "false");
    $("quickMore").textContent = open
      ? "1,000万円超を閉じる △"
      : "1,000万円超（5,000万円まで）を表示 ▽";
    document
      .querySelectorAll(".quick-major.quick-high")
      .forEach((row) => (row.hidden = !open));
    if (!open) {
      document
        .querySelectorAll(".quick-detail.quick-high")
        .forEach((row) => (row.hidden = true));
      document
        .querySelectorAll(".quick-major.quick-high .quick-expand")
        .forEach((b) => {
          b.setAttribute("aria-expanded", "false");
          b.querySelector(".quick-arrow").textContent = "▽";
        });
    }
  };
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-tooltip]");
    if (t) showQuickTip(t);
  });
  document.addEventListener("pointerout", (e) => {
    if (activeTipTarget && !activeTipTarget.contains(e.relatedTarget))
      hideQuickTip();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target.closest("[data-tooltip]");
    if (t) showQuickTip(t);
  });
  document.addEventListener("focusout", (e) => {
    if (activeTipTarget && !activeTipTarget.contains(e.relatedTarget))
      hideQuickTip();
  });
  document
    .querySelectorAll(".quick-scroll, .compare-scroll")
    .forEach((scroll) => scroll.addEventListener("scroll", hideQuickTip));
  addEventListener("resize", hideQuickTip);
  addEventListener("scroll", hideQuickTip, { passive: true });
  inputs.restore();
  $("simStartYear").textContent = SIM_START_YEAR;
  renderQuick();
  Share.init({ buildUrl: () => inputs.shareUrl() });
  Theme.onChange(update);
  ChartPrint.onPrint(update);
  update();
})();
