'use strict';

/* ── Constants ───────────────────────────── */
const TAX_RATE=0.20315, MINA=60, MAXA=100, CALCA=140;
const MAPM=(CALCA-MINA)*12;

// 色は css/main.css の --sc-* で定義している（ライト／ダークの2値）。
// テーマが変わると変わるので、描画のたびに Theme.color() で読み直す。
const SC=[
  {age:60,label:'60歳開始',token:'--sc-60',dashed:false},
  {age:65,label:'65歳開始',token:'--sc-65',dashed:false},
  {age:70,label:'70歳開始',token:'--sc-70',dashed:false},
  {age:75,label:'75歳開始',token:'--sc-75',dashed:false},
];
function scColor(sc){ return Theme.color(sc.token); }
function scBg(sc){ return Theme.color(sc.token + '-bg'); }

/* ── Pension rate ────────────────────────── */
function pRate(a){
  if(a<65)return 1-0.004*(65-a)*12;
  if(a>65)return Math.min(1+0.007*(a-65)*12,1.84);
  return 1;
}

/* ── Wealth array (monthly) ─────────────── */
function calcW(sa,nr,ia,tax){
  const mr=Math.pow(1+nr*(1-tax),1/12)-1;
  const mp=pRate(sa)/12;
  const base=pRate(65)/12;   // 生活費の基準＝65歳受給開始時の年金額
  const sm=(sa-MINA)*12, im=(ia-MINA)*12;
  let pool=0,spent=0;
  const w=new Float64Array(MAPM+1);
  for(let m=0;m<=MAPM;m++){
    w[m]=spent+pool;           // 記録：この月の年金受取り前の残高
    if(m>=sm){
      if(m<im){
        pool=(pool+mp)*(1+mr);
      } else if(mp>=base){
        // 基準額を超える分（繰下げの増加分）は運用に上乗せ
        spent+=base;
        pool=(pool+(mp-base))*(1+mr);
      } else {
        // 基準額に満たない分（繰上げの減少分）は運用残高から取り崩して充当
        const draw=Math.min(base-mp,pool);
        spent+=mp+draw;
        pool=(pool-draw)*(1+mr);
      }
    }
  }
  return w;
}

/* ── Formatting ─────────────────────────── */
function fmtAge(a){
  const y=Math.floor(a), m=Math.round((a-y)*12);
  if(m<=0)  return `${y}歳`;
  if(m>=12) return `${y+1}歳`;
  return `${y}歳${m}ヶ月`;
}

/* ── Overall leader timeline ─────────────
   Returns [{start, end, idx}] sorted by start age.
   idx = index into SC array of who leads in that period.
────────────────────────────────────────── */
function leaderTimeline(ws){
  const periods=[];
  let leader=-1;

  for(let m=0;m<=MAPM;m++){
    // Find argmax across all scenarios
    let best=0;
    for(let i=1;i<ws.length;i++) if(ws[i][m]>ws[best][m]) best=i;

    if(best!==leader){
      let transAge=MINA+m/12;

      if(leader!==-1 && m>0){
        // Interpolate precise crossover between old leader and new best
        const p=ws[leader][m-1]-ws[best][m-1];
        const c=ws[leader][m]  -ws[best][m];
        if(p>0 && (p-c)>1e-10){
          const f=Math.max(0,Math.min(1,p/(p-c)));
          transAge=MINA+(m-1+f)/12;
        }
        periods[periods.length-1].end=transAge;
      } else {
        // Very first period — start at MINA
        transAge=MINA;
      }

      periods.push({start:transAge, end:CALCA, idx:best});
      leader=best;
    }
  }
  return periods;
}

/* ── Marker plugin ───────────────────────
   Draws vertical dashed lines + circles at leader-transition ages.
────────────────────────────────────────── */
const markerPlugin={
  id:'mpl',
  afterDatasetsDraw(chart){
    const markers=chart.options.plugins?.mpl?.data;
    if(!markers||!markers.length)return;
    const{ctx,scales:{x,y}}=chart;
    ctx.save();
    [...markers].sort((a,b)=>a.age-b.age).forEach((mk,idx)=>{
      if(mk.age<x.min||mk.age>x.max)return;
      const px=x.getPixelForValue(mk.age);
      const py=y.getPixelForValue(mk.wealth);
      // Vertical dash
      ctx.beginPath(); ctx.setLineDash([3,4]);
      ctx.strokeStyle=mk.color+'99'; ctx.lineWidth=1;
      ctx.moveTo(px,y.top); ctx.lineTo(px,y.bottom); ctx.stroke();
      ctx.setLineDash([]);
      // Outer ring（中を地の色で抜いて、線と重なっても丸が読めるようにする）
      ctx.beginPath(); ctx.arc(px,py,6,0,Math.PI*2);
      ctx.fillStyle=Theme.color('--surface'); ctx.fill();
      ctx.strokeStyle=mk.color; ctx.lineWidth=2.5; ctx.stroke();
      // Inner dot
      ctx.beginPath(); ctx.arc(px,py,2.5,0,Math.PI*2);
      ctx.fillStyle=mk.color; ctx.fill();
      // Age label (staggered to avoid overlap)
      const lx=Math.max(x.left+28,Math.min(px,x.right-28));
      const ly=y.top+12+(idx%2)*14;
      ctx.fillStyle=mk.color;
      ctx.font='bold 10px "Helvetica Neue","Hiragino Sans",sans-serif';
      ctx.textAlign='center';
      ctx.fillText(fmtAge(mk.age),lx,ly);
    });
    ctx.restore();
  }
};
Chart.register(markerPlugin);

/* ── Main render ─────────────────────────── */
let myChart=null;

function render(){
  const nr=Number(document.getElementById('rSlider').value)/100;
  const ia=Number(document.getElementById('iSlider').value);
  const taxOn=document.getElementById('taxToggle').checked;
  const tax=taxOn?TAX_RATE:0;

  // Update labels
  document.getElementById('rVal').textContent   =(nr*100).toFixed(1);
  document.getElementById('rAfter').textContent =(nr*(1-tax)*100).toFixed(2);
  document.getElementById('rTaxNote').textContent=taxOn?`（課税率 ${(TAX_RATE*100).toFixed(3)}%）`:'（非課税）';
  document.getElementById('iVal').textContent   =ia;

  // Compute wealth arrays
  const ws=SC.map(s=>calcW(s.age,nr,ia,tax));

  // Overall leader timeline
  const periods=leaderTimeline(ws);

  // Markers: placed at each leader-change transition (periods[1].start, periods[2].start, ...)
  const markers=periods.slice(1).flatMap(p=>{
    if(p.start>=MAXA) return [];
    const m=Math.min(Math.round((p.start-MINA)*12), MAPM);
    const wealth=ws[p.idx][m];
    return[{age:p.start, wealth, color:scColor(SC[p.idx])}];
  });

  // Chart datasets — use {x,y} so linear x-axis displays correctly
  const chartAges=Array.from({length:MAXA-MINA+1},(_,j)=>MINA+j);
  const datasets=SC.map((sc,i)=>({
    label:sc.label,
    data:chartAges.map(a=>({x:a, y:+(ws[i][(a-MINA)*12].toFixed(3))})),
    borderColor:scColor(sc),
    backgroundColor:'transparent',
    borderWidth:2.5,
    pointRadius:0,
    pointStyle:sc.dashed?'dash':'line',
    tension:0,
    borderDash:sc.dashed?[7,4]:[],
  }));

  if(!myChart){
    // 軸・凡例・ツールチップの色は生成時にしか設定されないので、
    // テーマが変わったときは下の Theme.onChange でグラフごと作り直す
    const cSub=Theme.color('--text-sub'), cGrid=Theme.color('--grid');
    myChart=new Chart(document.getElementById('chart'),{
      type:'line',
      data:{datasets},
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:200},
        interaction:{mode:'index', intersect:false},
        scales:{
          x:{
            type:'linear', min:MINA, max:MAXA,
            ticks:{
              stepSize:5,
              callback:v=>`${v}歳`,   // v is the actual numeric age here
              font:{size:11}, color:cSub, maxRotation:0,
            },
            grid:{color:cGrid},
            border:{color:cGrid},
          },
          y:{
            min:0,
            ticks:{font:{size:11}, color:cSub},
            grid:{color:cGrid},
            border:{color:cGrid},
            title:{display:true, text:'累積受取総額（年金年額＝1基準）', font:{size:11}, color:cSub},
          },
        },
        plugins:{
          tooltip:{
            callbacks:{
              title:items=>`${items[0].parsed.x}歳`,
              label:item =>`${item.dataset.label}：${item.parsed.y.toFixed(2)}年分`,
            },
            titleFont:{size:12}, bodyFont:{size:11},
            backgroundColor:Theme.color('--tooltip-bg'),
            titleColor:Theme.color('--tooltip-text'),
            bodyColor:Theme.color('--tooltip-text'),
          },
          legend:{labels:{font:{size:12}, usePointStyle:true, boxWidth:36, boxHeight:8, padding:14, color:cSub}},
          mpl:{data:markers},
        },
      },
    });
  } else {
    myChart.data.datasets=datasets;
    myChart.options.plugins.mpl.data=markers;
    myChart.update('none');
  }

  /* ── Build timeline rows (100歳以内のみ表示) ── */
  const visiblePeriods=periods.filter(p=>p.start<MAXA);
  const tl=document.getElementById('timeline');
  tl.innerHTML=visiblePeriods.map((p,i)=>{
    const sc=SC[p.idx];
    const isFirst=(i===0);
    const isLast =(i===visiblePeriods.length-1);
    // 終端が100歳を超える場合は「〇歳以降（100歳まで）」と表示
    const endCapped=Math.min(p.end, MAXA);

    let rangeText;
    if(isFirst && isLast){
      rangeText=`〜${MAXA}歳まで`;
    } else if(isFirst){
      rangeText=`〜${fmtAge(endCapped)}まで`;
    } else if(isLast){
      rangeText=p.end>MAXA
        ? `${fmtAge(p.start)}〜${MAXA}歳`
        : `${fmtAge(p.start)}以降`;
    } else {
      rangeText=`${fmtAge(p.start)}〜${fmtAge(endCapped)}`;
    }

    return `<div class="period" style="border-color:${scColor(sc)};background:${scBg(sc)}">
      <span class="age-col">${rangeText}</span>
      <span class="winner-col" style="color:${scColor(sc)}">${sc.label}が最も有利</span>
    </div>`;
  }).join('');

  // 条件が変わったら共有用QRコードも描き直す
  Share.refreshQr();
}

document.getElementById('rSlider').addEventListener('input',render);
document.getElementById('iSlider').addEventListener('input',render);
document.getElementById('taxToggle').addEventListener('change',render);

/* ---------- 共有 ---------- */
function collectState(){
  return {
    r: document.getElementById('rSlider').value,
    i: document.getElementById('iSlider').value,
    t: document.getElementById('taxToggle').checked ? 1 : 0,
  };
}
function buildShareUrl(){
  const params=new URLSearchParams();
  const s=collectState();
  for(const k in s) params.set(k,s[k]);
  return Share.urlWithParams(params);
}
Share.init({ buildUrl: buildShareUrl });

/* ---------- 初期化（URLパラメータがあれば復元） ---------- */
(function loadFromURL(){
  const q=new URLSearchParams(location.search);
  if(q.has('r')) document.getElementById('rSlider').value=q.get('r');
  if(q.has('i')) document.getElementById('iSlider').value=q.get('i');
  if(q.has('t')) document.getElementById('taxToggle').checked=q.get('t')==='1';
})();

render();

// グラフはCSS変数に自動では追従しない。scales / legend の色は生成時にしか
// 設定されないため update() では足りず、作り直す（render はDOMから状態を読み直す）
// テーマが変わったら、軸・凡例・ツールチップの色を差し替えて描き直す。
// グラフを作り直さないのは、生成直後の描画がアニメーション経由で非同期になり、
// 印刷時に beforeprint の中で描き終わらず白紙になってしまうため。
Theme.onChange(()=>{
  if(myChart){
    const cSub=Theme.color('--text-sub'), cGrid=Theme.color('--grid');
    const o=myChart.options;
    o.scales.x.ticks.color=cSub; o.scales.x.grid.color=cGrid; o.scales.x.border.color=cGrid;
    o.scales.y.ticks.color=cSub; o.scales.y.grid.color=cGrid; o.scales.y.border.color=cGrid;
    o.scales.y.title.color=cSub;
    o.plugins.legend.labels.color=cSub;
    o.plugins.tooltip.backgroundColor=Theme.color('--tooltip-bg');
    o.plugins.tooltip.titleColor=Theme.color('--tooltip-text');
    o.plugins.tooltip.bodyColor=Theme.color('--tooltip-text');
    myChart.resize();   // 印刷直前は .printing で幅が変わっているので測り直す
  }
  render();             // 線の色とマーカーの色を取り直して update('none') する
});
