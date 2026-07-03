// nisa-common.js
// nisa20XX.html の共通ロジック。呼び出し側で const pop / accounts / nisaData を
// 定義した後にこのファイルを読み込むこと。

const nisaTotal={};
Object.keys(nisaData).forEach(a=>{ nisaTotal[a]=Object.values(nisaData[a]).reduce((s,v)=>s+v,0); });

const workingAges=['20代','30代','40代','50代'];
const workingPop=workingAges.reduce((s,a)=>s+pop[a],0);
const workingNisaData={'0':0,'60':0,'120':0,'180':0,'240':0,'300':0,'360':0};
workingAges.forEach(a=>Object.keys(workingNisaData).forEach(k=>{workingNisaData[k]+=nisaData[a][k];}));
const workingNisaTotal=Object.values(workingNisaData).reduce((s,v)=>s+v,0);

const categories=[
  {label:'300万円超（上限まで）', key:'360',color:'#4B9B00'},
  {label:'240万円超〜300万円以下',key:'300',color:'#8DB500'},
  {label:'180万円超〜240万円以下',key:'240',color:'#C8A800'},
  {label:'120万円超〜180万円以下',key:'180',color:'#E08500'},
  {label:'60万円超〜120万円以下', key:'120',color:'#C45E00'},
  {label:'0円超〜60万円以下',     key:'60', color:'#7D3C00'},
  {label:'0円（買付なし）',       key:'0',  color:'#D3D1C7'},
  {label:'口座未開設',            key:'none',color:'#B4B2A9'},
];

// ── テーブル描画 ──
(function buildSummary(){
  const sb=document.getElementById('summary-body');
  let tp=0,ta=0,tn=0;
  ['10代','20代','30代','40代','50代','60代','70代','80歳以上'].forEach(age=>{
    const isRef=age==='10代';
    const tr=document.createElement('tr'); if(isRef)tr.className='ref-row';
    const p=pop[age],a=accounts[age],n=nisaTotal[age];
    tr.innerHTML=`<td>${age}${isRef?' ※':''}</td><td>${(p/10000).toFixed(1)}万人</td><td>${(a/10000).toFixed(1)}万口座</td><td class="pct">${(a/p*100).toFixed(1)}%</td><td style="color:#888">${((p-n)/p*100).toFixed(1)}%</td>`;
    sb.appendChild(tr);
    if(!isRef){tp+=p;ta+=a;tn+=n;}
  });
  const tr=document.createElement('tr');tr.className='total-row';
  tr.innerHTML=`<td>20〜59歳 合計</td><td>${(tp/10000).toFixed(1)}万人</td><td>${(ta/10000).toFixed(1)}万口座</td><td class="pct">${(ta/tp*100).toFixed(1)}%</td><td style="color:#888">${((tp-tn)/tp*100).toFixed(1)}%</td>`;
  sb.appendChild(tr);
})();
(function buildTables(){
  function build(tbodyId,ages,showTotal){
    const tbody=document.getElementById(tbodyId);
    const totalPop=ages.reduce((s,a)=>s+pop[a],0);
    const cum={total:0};ages.forEach(a=>cum[a]=0);
    categories.forEach(cat=>{
      const tr=document.createElement('tr');
      if(cat.key==='none')tr.className='highlight-row';
      let rowTotal=0,cells=`<td>${cat.label}</td>`;
      ages.forEach(age=>{
        const val=cat.key==='none'?pop[age]-nisaTotal[age]:nisaData[age][cat.key];
        rowTotal+=val;cum[age]+=val;
        cells+=`<td><span class="pct">${(val/pop[age]*100).toFixed(1)}%</span><span class="cum">↑${(cum[age]/pop[age]*100).toFixed(1)}%</span></td>`;
      });
      if(showTotal){
        cum.total+=rowTotal;
        cells+=`<td><span class="pct">${(rowTotal/totalPop*100).toFixed(1)}%</span><span class="cum">↑${(cum.total/totalPop*100).toFixed(1)}%</span></td>`;
      }
      tr.innerHTML=cells;tbody.appendChild(tr);
    });
  }
  build('table-body-working',workingAges,true);
  build('table-body-ref',['10代','60代','70代','80歳以上'],false);
})();

// ── Chart.js 円グラフ ──
function getChartDatasets(age, inclInactive) {
  const isW = age==='現役世代合計';
  const p   = isW ? workingPop : pop[age];
  const nd  = isW ? workingNisaData : nisaData[age];
  const nt  = isW ? workingNisaTotal : nisaTotal[age];

  const filtered = categories.filter(c=>{
    if(!inclInactive && (c.key==='none'||c.key==='0')) return false;
    return true;
  });

  const vals   = filtered.map(c=> c.key==='none' ? p-nt : nd[c.key]);
  const total  = vals.reduce((s,v)=>s+v,0);
  const labels = filtered.map(c=>c.label);
  const colors = filtered.map(c=>c.color);
  const pcts   = vals.map(v=>(v/total*100));

  return { labels, colors, vals, pcts, total };
}

const pieCtx = document.getElementById('pieChart').getContext('2d');
Chart.register(ChartDataLabels);
let chart = null;

function updateCenterLabel(age) {
  const displayAge = age === '現役世代合計' ? '20〜50代' : age;
  document.getElementById('centerAge').textContent = displayAge;
}

function updateLegendList(labels, colors, pcts) {
  const ul = document.getElementById('chartLegend');
  ul.innerHTML = '';
  labels.forEach((label, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:${colors[i]}"></span><span class="leg-label">${label}</span><span class="leg-pct">${pcts[i].toFixed(1)}%</span>`;
    ul.appendChild(li);
  });
}

function updateChart() {
  const age         = document.getElementById('ageSelect').value;
  const inclInactive= document.getElementById('chkInactive').checked;
  const { labels, colors, pcts } = getChartDatasets(age, inclInactive);

  updateCenterLabel(age);
  updateLegendList(labels, colors, pcts);

  if (chart) {
    chart.data.labels         = labels;
    chart.data.datasets[0].data            = pcts;
    chart.data.datasets[0].backgroundColor = colors;
    chart.data.datasets[0].hoverBackgroundColor = colors.map(c=>c);
    chart.update();
  } else {
    chart = new Chart(pieCtx, {
      type: 'doughnut',
      plugins: [ChartDataLabels],
      data: {
        labels,
        datasets: [{
          data: pcts,
          backgroundColor: colors,
          hoverBackgroundColor: colors,
          borderColor: '#fff',
          borderWidth: 2,
          hoverOffset: 14,
        }]
      },
      options: {
        animation: { animateRotate: true, animateScale: false, duration: 600, easing: 'easeInOutQuart' },
        cutout: '28%',
        plugins: {
          datalabels: {
            color: (ctx) => {
              const bg = ctx.dataset.backgroundColor[ctx.dataIndex];
              return (bg === '#D3D1C7' || bg === '#B4B2A9') ? '#555' : '#fff';
            },
            font: (ctx) => {
              const w = ctx.chart.width;
              const size = w < 320 ? 9 : w < 420 ? 10.5 : 12;
              return { size, weight: 'bold', family: 'sans-serif' };
            },
            formatter(value, ctx) {
              const w = ctx.chart.width;
              const threshold = w < 320 ? 6 : w < 420 ? 4 : 3;
              if (value < threshold) return '';
              const label = ctx.chart.data.labels[ctx.dataIndex];
              return label + '\n' + value.toFixed(1) + '%';
            },
            textAlign: 'center',
            anchor: 'center',
            align: 'center',
            clip: false,
          },
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `  ${ctx.label}：${ctx.parsed.toFixed(1)}%`;
              }
            },
            bodyFont: { size: 13 },
            padding: 10,
            backgroundColor: 'rgba(30,30,30,0.85)',
          }
        },
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1,
      }
    });
  }
}

document.getElementById('ageSelect').addEventListener('change', updateChart);
document.getElementById('chkInactive').addEventListener('change', updateChart);
updateChart();

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (chart) chart.update(); }, 150);
});
