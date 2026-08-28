const DEFAULTS = {
  btcPrice: 0, mstrPrice: 0, btcHoldings: 0, assumedShares: 0,
  fullyDilutedShares: 0, otmDebt: 0, preferred: 0, usdReserve: 0
};
const ids = ['btcPrice','mstrPrice','btcHoldings','assumedShares','fullyDilutedShares','otmDebt','preferred','usdReserve','targetBtcPrice','targetMnav'];
const TARGET_IDS = ['targetBtcPrice','targetMnav'];
let autoData = null;

const val = id => parseFloat(document.getElementById(id)?.value);
const money = n => Number.isFinite(n) ? '$' + n.toLocaleString('en-US',{maximumFractionDigits:2}) : '-';
const moneyB = n => Number.isFinite(n) ? '$' + n.toLocaleString('en-US',{maximumFractionDigits:3}) + 'B' : '-';
const btcFmt = n => Number.isFinite(n) ? n.toLocaleString('en-US',{maximumFractionDigits:2}) + ' BTC' : '-';
const satsFmt = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') + ' sats' : '-';

async function loadAutoData() {
  try {
    const r = await fetch('data.json?ts=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('data.json');
    autoData = await r.json();

    setVal('btcHoldings', autoData.btcHoldings);
    setVal('assumedShares', autoData.assumedShares);
    setVal('fullyDilutedShares', autoData.fullyDilutedShares);
    setVal('otmDebt', autoData.otmDebt);
    setVal('preferred', autoData.preferred);
    setVal('usdReserve', autoData.usdReserve);

    if (Number.isFinite(autoData.mstrPrice)) setVal('mstrPrice', autoData.mstrPrice);

    document.getElementById('dataStatus').textContent =
      '자동 데이터: ' + (autoData.updatedAt ? new Date(autoData.updatedAt).toLocaleString('ko-KR') : '업데이트 대기');
    calculate(false);
  } catch(e) {
    document.getElementById('dataStatus').textContent = '자동 데이터 연결 실패 — 저장된 값으로 계산';
  }
}

async function loadLivePrices() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {cache:'no-store'});
    const j = await r.json();
    if (j.bitcoin?.usd) setVal('btcPrice', j.bitcoin.usd);
  } catch(e) {}
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m', {cache:'no-store'});
    const j = await r.json();
    const p = j.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (Number.isFinite(p)) setVal('mstrPrice', p);
  } catch(e) {}
  calculate(false);
}

function setVal(id,v){ const e=document.getElementById(id); if(e && Number.isFinite(Number(v))) e.value=v; }

function getData(){
  const d={
    btcPrice:val('btcPrice'),mstrPrice:val('mstrPrice'),btcHoldings:val('btcHoldings'),
    assumedShares:val('assumedShares'),fullyDilutedShares:val('fullyDilutedShares'),
    otmDebt:val('otmDebt')*1e9,preferred:val('preferred')*1e9,usdReserve:val('usdReserve')*1e9
  };
  if([d.btcPrice,d.btcHoldings,d.assumedShares,d.fullyDilutedShares].some(x=>!Number.isFinite(x)||x<=0))
    throw new Error('BTC 가격, BTC 보유량, 주식수 데이터가 없습니다.');
  d.btcTotalValue=d.btcPrice*d.btcHoldings;
  d.netBtc=d.btcHoldings-(d.otmDebt/d.btcPrice)-(d.preferred/d.btcPrice)+(d.usdReserve/d.btcPrice);
  d.grossBpsSats=d.btcHoldings*1e8/(d.assumedShares*1e6);
  d.netBpsSats=d.netBtc*1e8/(d.fullyDilutedShares*1e6);
  d.grossBpsUsd=d.btcTotalValue/(d.assumedShares*1e6);
  d.netBpsUsd=d.netBtc*d.btcPrice/(d.fullyDilutedShares*1e6);
  d.mnav=Number.isFinite(d.mstrPrice)&&d.mstrPrice>0?d.mstrPrice/d.netBpsUsd:NaN;
  d.premium=Number.isFinite(d.mnav)?(d.mnav-1)*100:NaN;
  return d;
}

function calculate(showAlert=true){
  try{
    const d=getData();
    document.getElementById('grossBpsSats').textContent=satsFmt(d.grossBpsSats);
    document.getElementById('netBpsSats').textContent=satsFmt(d.netBpsSats);
    document.getElementById('netBpsUsd').textContent=money(d.netBpsUsd);
    document.getElementById('mnavMultiple').textContent=Number.isFinite(d.mnav)?d.mnav.toFixed(2)+'×':'-';
    document.getElementById('premium').textContent=Number.isFinite(d.premium)?`${d.premium>=0?'+':''}${d.premium.toFixed(1)}% ${d.premium>=0?'프리미엄':'디스카운트'}`:'MSTR 주가 입력 필요';
    document.getElementById('btcTotalValue').textContent=moneyB(d.btcTotalValue/1e9);
    document.getElementById('seniorClaims').textContent=moneyB((d.otmDebt+d.preferred)/1e9);
    document.getElementById('reserveValue').textContent=moneyB(d.usdReserve/1e9);
    document.getElementById('netBtc').textContent=btcFmt(d.netBtc);
    document.getElementById('grossBpsUsd').textContent=money(d.grossBpsUsd);
    document.getElementById('fdsoDisplay').textContent=d.fullyDilutedShares.toLocaleString('en-US',{maximumFractionDigits:3})+'M';
    updateSignal(d.mnav); buildScenarioTable(); saveInputs(); return d;
  }catch(e){if(showAlert)alert(e.message);return null}
}

function updateSignal(m){
  const e=document.getElementById('signal');
  if(!Number.isFinite(m)){e.textContent='MSTR 주가를 입력하면 현재 mNAV가 계산됩니다.';e.className='signal neutral';return}
  if(m>=3){e.textContent='🔴 3× 이상 — 매우 높은 프리미엄';e.className='signal danger'}
  else if(m>=2){e.textContent='🟠 2–3× — 높은 프리미엄';e.className='signal warning'}
  else if(m>=1.5){e.textContent='🟡 1.5–2× — 중간 프리미엄';e.className='signal warning'}
  else if(m>=1){e.textContent='🟢 1–1.5× — 비교적 낮은 프리미엄';e.className='signal success'}
  else {e.textContent='🔵 1× 미만 — Net BTC 가치보다 낮은 가격';e.className='signal success'}
}

function targetNetBtc(d,p){return d.btcHoldings-(d.otmDebt/p)-(d.preferred/p)+(d.usdReserve/p)}
function predictMstrPrice(){
  try{
    const d=getData(),p=val('targetBtcPrice'),m=val('targetMnav');
    if(!Number.isFinite(p)||p<=0||!Number.isFinite(m)||m<=0)throw new Error('목표 BTC 가격과 목표 mNAV를 입력해주세요.');
    const nb=targetNetBtc(d,p),bps=nb*p/(d.fullyDilutedShares*1e6);
    document.getElementById('predictedMstrPrice').textContent=money(bps*m);
    document.getElementById('predictedNetBps').textContent=`목표 BTC ${money(p)} → Net BPS $${bps.toFixed(2)} × ${m.toFixed(2)}×`;
  }catch(e){alert(e.message)}
}
function scenario(p){document.getElementById('targetBtcPrice').value=p;if(!val('targetMnav')||val('targetMnav')<=0)document.getElementById('targetMnav').value=1.5;predictMstrPrice();window.scrollTo({top:document.querySelector('.quick-calc-section').offsetTop,behavior:'smooth'})}
function buildScenarioTable(){
  let d;try{d=getData()}catch(_){return}
  const mult=[1,1.25,1.5,2,2.5,3],prices=[70000,80000,90000,100000,120000,150000],tb=document.getElementById('scenarioTable');
  tb.innerHTML=prices.map(p=>{const b=targetNetBtc(d,p),bps=b*p/(d.fullyDilutedShares*1e6);return `<tr><td><strong>$${(p/1000).toFixed(0)}K</strong></td>${mult.map(m=>`<td>${money(bps*m)}</td>`).join('')}</tr>`}).join('');
}
function saveInputs(){const x={};ids.forEach(id=>{const e=document.getElementById(id);if(e)x[id]=e.value});localStorage.setItem('mstrCalculatorInputsV3',JSON.stringify(x))}
function loadInputs(){try{const x=JSON.parse(localStorage.getItem('mstrCalculatorInputsV3')||'null');if(x)ids.forEach(id=>{if(x[id]!==undefined)document.getElementById(id).value=x[id]})}catch(_){}}

document.addEventListener('DOMContentLoaded',async()=>{
  loadInputs();
  await loadAutoData();
  await loadLivePrices();
  calculate(false);
  ids.forEach(id=>{
    const e=document.getElementById(id);if(!e)return;
    e.addEventListener('input',saveInputs);
    e.addEventListener('blur',()=>TARGET_IDS.includes(id)?predictMstrPrice():calculate(false));
    e.addEventListener('keypress',ev=>{if(ev.key==='Enter')TARGET_IDS.includes(id)?predictMstrPrice():calculate()});
  });
  setInterval(loadLivePrices, 60000);
});
