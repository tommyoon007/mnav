const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

const DEFAULT_DATA = {
    btcHoldings: 845050,
    adso: 298.039,
    fdso: 424.479,
    usdAssetsUsdB: 6.690,
    debtUsdB: 6.754,
    preferredUsdB: 14.966
};

let currentData = { ...DEFAULT_DATA };
let futuresChartInstance = null;
let currentTf = '1M'; 
let updateTimer = null;
let autoSyncEnabled = true;

function setText(id, text) { 
    const el = document.getElementById(id); 
    if (el) el.textContent = text; 
}

function setVal(id, val) { 
    const el = document.getElementById(id); 
    if (el && document.activeElement !== el) {
        el.value = val; 
    }
}

function getNum(id) { 
    const el = document.getElementById(id); 
    if (!el) return 0; 
    const val = el.value !== undefined ? el.value : el.textContent; 
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, "")); 
    return isNaN(num) ? 0 : num; 
}

async function fetchWithTimeout(url, timeoutMs = 5000, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { 
        const res = await fetch(url, { ...options, signal: controller.signal }); 
        clearTimeout(timer); 
        return res; 
    } catch (e) { 
        clearTimeout(timer); 
        return null; 
    }
}

async function fetchLiveBtcPrice() {
    try { 
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD", 3000);
        if (res && res.ok) { 
            const data = await res.json(); 
            const p = parseFloat(data?.data?.amount); 
            if (p > 0) return p; 
        }
    } catch (e) {}
    try { 
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", 3000);
        if (res && res.ok) { 
            const data = await res.json(); 
            const p = parseFloat(data?.price); 
            if (p > 0) return p; 
        }
    } catch (e) {} 
    return null;
}

async function fetchLiveMstrPrice() {
    if (FINNHUB_KEY) {
        try { 
            const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`, 3000);
            if (res && res.ok) { 
                const data = await res.json(); 
                const price = (data?.c > 0) ? data.c : data?.pc; 
                if (price > 0) return parseFloat(price); 
            }
        } catch (e) {}
    }
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&range=1d&includePrePost=true&ts=${Date.now()}`;
    const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`, `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`];
    for (const proxy of proxies) {
        try { 
            const res = await fetchWithTimeout(proxy, 3000);
            if (res && res.ok) { 
                const data = await res.json(); 
                const meta = data?.chart?.result?.[0]?.meta;
                if (meta) { 
                    const price = meta.postMarketPrice || meta.preMarketPrice || meta.regularMarketPrice || meta.chartPreviousClose; 
                    if (price > 0) return parseFloat(price); 
                }
            }
        } catch (e) {}
    } 
    return null;
}

async function fetchFearAndGreed() {
    try {
        const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1", 3000);
        if (res && res.ok) {
            const data = await res.json();
            return parseInt(data.data[0].value);
        }
    } catch (e) {}
    return null;
}

async function fetchFuturesHistory(tf = '1M') {
    let period = '2h', oiLimit = 360, frLimit = 120;
    if (tf === '1D') { period = '5m'; oiLimit = 288; frLimit = 24; } 
    else if (tf === '1M') { period = '2h'; oiLimit = 360; frLimit = 90; } 
    else if (tf === '3M') { period = '6h'; oiLimit = 360; frLimit = 270; } 
    else if (tf === '6M') { period = '12h'; oiLimit = 360; frLimit = 540; } 
    else if (tf === '1Y' || tf === 'ALL') { period = '1d'; oiLimit = 500; frLimit = 1000; } 

    try {
        const [resFR, resOI, resLS] = await Promise.all([
            fetchWithTimeout(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${frLimit}`, 6000),
            fetchWithTimeout(`https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=${period}&limit=${oiLimit}`, 6000),
            fetchWithTimeout(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${period}&limit=${oiLimit}`, 6000)
        ]);
        if (!resOI || !resOI.ok) return null;
        const oiList = await resOI.json(); 
        if (!Array.isArray(oiList)) return null; 

        let frList = []; 
        if (resFR && resFR.ok) { const parsedFr = await resFR.json(); if (Array.isArray(parsedFr)) frList = parsedFr; }
        let lsList = []; 
        if (resLS && resLS.ok) { const parsedLs = await resLS.json(); if (Array.isArray(parsedLs)) lsList = parsedLs; }

        const labels = [], frData = [], oiData = [], lsData = [];
        oiList.forEach((oiItem) => {
            const dateObj = new Date(oiItem.timestamp);
            let dateStr = tf === '1D' ? `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}` : 
                          (tf === '1Y' || tf === 'ALL' ? `${String(dateObj.getFullYear()).slice(2)}/${dateObj.getMonth() + 1}/${dateObj.getDate()}` : 
                          `${dateObj.getMonth() + 1}/${dateObj.getDate()} ${dateObj.getHours().toString().padStart(2, '0')}:00`);
            labels.push(dateStr);
            oiData.push(parseFloat(oiItem.sumOpenInterest) / 1000); 
            if (frList.length > 0) {
                let closestFr = frList.reduce((prev, curr) => Math.abs(curr.fundingTime - oiItem.timestamp) < Math.abs(prev.fundingTime - oiItem.timestamp) ? curr : prev, frList[0]);
                frData.push(parseFloat(closestFr.fundingRate) * 100);
            } else frData.push(0);
            
            const matchedLs = lsList.find(l => Math.abs(l.timestamp - oiItem.timestamp) < 86400000);
            lsData.push(matchedLs && matchedLs.longShortRatio ? parseFloat(matchedLs.longShortRatio) : null);
        });
        return { labels, frData, oiData, lsData };
    } catch (e) { return null; }
}

async function fetchFuturesData() {
    let fundingRate = null, openInterest = null, lsRatio = null, rawFr = 0, rawOi = 0, rawLs = 1.0;
    try {
        const [resFR, resOI, resLS] = await Promise.all([
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", 3000),
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", 3000),
            fetchWithTimeout("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1", 3000)
        ]);
        if (resFR && resFR.ok) { const data = await resFR.json(); if (data?.lastFundingRate !== undefined) { rawFr = parseFloat(data.lastFundingRate) * 100; fundingRate = rawFr.toFixed(4) + "%"; } }
        if (resOI && resOI.ok) { const data = await resOI.json(); if (data?.openInterest !== undefined) { rawOi = (parseFloat(data.openInterest) / 1000); openInterest = rawOi.toFixed(1) + "k ₿"; } }
        if (resLS && resLS.ok) { const data = await resLS.json(); if (Array.isArray(data) && data.length > 0 && data[0].longShortRatio !== undefined) { rawLs = parseFloat(data[0].longShortRatio); lsRatio = rawLs.toFixed(4); } }
    } catch (e) {}
    return { fundingRate, openInterest, lsRatio, rawFr, rawOi, rawLs };
}

function evaluateMultiRisk(rawFr, rawLs, fng, currentMnav) {
    if (rawFr === null || isNaN(rawFr)) return { stage: "🟡 분석 대기 중", text: "데이터 수집 중...", color: "#aaa" };

    let score = 0;
    let textFr = "", textLs = "";

    if (rawFr >= 0.05) { score += 4; textFr = "극단적 롱 쏠림"; }
    else if (rawFr >= 0.03) { score += 3; textFr = "과열 롱 펀딩비"; }
    else if (rawFr >= 0.015) { score += 1.5; textFr = "롱 포지션 우위"; }
    else if (rawFr <= -0.01) { score -= 1; textFr = "숏 우위 (스퀴즈 가능성)"; }
    else { textFr = "중립적 펀딩비"; }

    if (rawLs >= 2.0) { score += 2; textLs = "개미 롱 극대화"; }
    else if (rawLs >= 1.5) { score += 1; textLs = "롱 포지션 누적"; }
    else if (rawLs <= 0.8) { score -= 1; textLs = "숏 포지션 누적"; }
    else { textLs = "비율 안정화"; }

    if (fng !== null) {
        if (fng >= 80) score += 2;
        else if (fng >= 70) score += 1;
        else if (fng <= 30) score -= 1;
    }

    if (currentMnav !== null) {
        if (currentMnav >= 2.5) score += 2;
        else if (currentMnav >= 2.0) score += 1;
    }

    let stage, color;
    if (score >= 7) { stage = "🔴 5단계 (극심한 위험)"; color = "#f85149"; }
    else if (score >= 4.5) { stage = "🟠 4단계 (과열 경고)"; color = "#db6d28"; }
    else if (score >= 2.5) { stage = "🟡 3단계 (열기 발생)"; color = "#d29922"; }
    else if (score <= 0 && rawFr <= -0.01) { stage = "🟢 1단계 (숏 과열/기회)"; color = "#2ea043"; }
    else { stage = "🟢 2단계 (건전/중립)"; color = "#3fb950"; }

    return { stage, text: `선물시장: ${textFr} 및 ${textLs} 진행중`, color };
}

function updateCardValue(possibleIds, labelText, valueText) {
    if (!valueText) return;
    possibleIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = valueText; });
}

async function initOrUpdateFuturesChart(liveFr, liveOi, liveLs, forceReload = false) {
    const canvas = document.getElementById('futuresChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const riskThreshold = 0.030;

    if (!futuresChartInstance || forceReload) {
        if (futuresChartInstance) { futuresChartInstance.destroy(); futuresChartInstance = null; }

        const history = await fetchFuturesHistory(currentTf);
        let labels = [], frData = [], oiData = [], lsData = [];
        if (history && history.labels.length > 0) {
            labels = history.labels; frData = history.frData; oiData = history.oiData; lsData = history.lsData;
        } else {
            const now = new Date();
            labels = [`${now.getMonth()+1}/${now.getDate()} ${now.getHours()}:${now.getMinutes()}`];
            frData = [liveFr]; oiData = [liveOi]; lsData = [liveLs || 1.0];
        }

        const thresholdArray = new Array(labels.length).fill(riskThreshold);
        
        let gradientFR = ctx.createLinearGradient(0, 0, 0, 320);
        gradientFR.addColorStop(0, 'rgba(255, 159, 10, 0.4)');
        gradientFR.addColorStop(1, 'rgba(255, 159, 10, 0.0)');

        let gradientOI = ctx.createLinearGradient(0, 0, 0, 320);
        gradientOI.addColorStop(0, 'rgba(88, 166, 255, 0.3)');
        gradientOI.addColorStop(1, 'rgba(88, 166, 255, 0.0)');

        futuresChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: '펀딩비 (%)', data: frData, borderColor: '#ff9f0a', backgroundColor: gradientFR, fill: true, yAxisID: 'yFR', borderWidth: 2, tension: 0.4, pointRadius: 0, pointHoverRadius: 5 },
                    { label: '미결제약정 (k ₿)', data: oiData, borderColor: '#58a6ff', backgroundColor: gradientOI, fill: true, yAxisID: 'yOI', borderWidth: 1.5, tension: 0.4, pointRadius: 0, pointHoverRadius: 4 },
                    { label: '롱/숏 비율', data: lsData, borderColor: '#a371f7', backgroundColor: 'transparent', fill: false, yAxisID: 'yLS', borderWidth: 1.5, tension: 0.4, pointRadius: 0, pointHoverRadius: 4, borderDash: [2, 2], spanGaps: true },
                    { label: '위험 기준선 (0.03%)', data: thresholdArray, borderColor: '#f85149', borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0, fill: false, yAxisID: 'yFR' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: '#2a2a2a' }, ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 8 } },
                    yFR: { type: 'linear', position: 'left', grid: { color: '#2a2a2a' }, ticks: { color: '#ff9f0a', font: { size: 10 } } },
                    yOI: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#58a6ff', font: { size: 10 } } },
                    yLS: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#a371f7', font: { size: 10 } } }
                },
                plugins: { 
                    legend: { labels: { color: '#fff', font: { size: 11 }, boxWidth: 12 } },
                    tooltip: {
                        backgroundColor: 'rgba(22, 27, 34, 0.95)', titleFont: { size: 13 }, bodyFont: { size: 13, weight: 'bold' },
                        padding: 12, borderColor: '#30363d', borderWidth: 1, displayColors: true, boxPadding: 4,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null && context.parsed.y !== undefined) {
                                    if (context.datasetIndex === 0) label += context.parsed.y.toFixed(4) + '%';
                                    else if (context.datasetIndex === 1) label += context.parsed.y.toFixed(1) + 'k ₿';
                                    else if (context.datasetIndex === 2) label += context.parsed.y.toFixed(2);
                                    else if (context.datasetIndex === 3) label += context.parsed.y.toFixed(4) + '%';
                                } else label += 'N/A';
                                return label;
                            }
                        }
                    }
                }
            }
        });
    } else {
        const datasets = futuresChartInstance.data.datasets;
        if (datasets[0].data.length > 0) {
            datasets[0].data[datasets[0].data.length - 1] = liveFr;
            datasets[1].data[datasets[1].data.length - 1] = liveOi;
            datasets[2].data[datasets[2].data.length - 1] = liveLs;
            futuresChartInstance.update('none');
        }
    }
}

window.changeChartTimeframe = async function(tf) {
    if (currentTf === tf) return; 
    currentTf = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tf-${tf}`)?.classList.add('active');
    const futures = await fetchFuturesData();
    await initOrUpdateFuturesChart(futures.rawFr, futures.rawOi, futures.rawLs, true);
};

function updateScenarioTable(netBpsUsd, currentBtc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !netBpsUsd || !currentBtc) return;
    const fixedBtcTargets = [30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 120000, 150000, 180000, 200000, 250000, 300000, 400000, 500000];
    const mnavMultipliers = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
    let html = "";
    fixedBtcTargets.forEach(targetBtc => {
        const targetNetBps = netBpsUsd * (targetBtc / currentBtc);
        const isCurrentZone = Math.abs(targetBtc - currentBtc) < 5000;
        const rowStyle = isCurrentZone ? 'style="background-color: #26382b; font-weight: bold; color: #3fb950;"' : '';
        html += `<tr ${rowStyle}><td>$${(targetBtc / 1000).toFixed(0)}k</td>`;
        mnavMultipliers.forEach(nav => { html += `<td>$${(targetNetBps * nav).toFixed(0)}</td>`; }); 
        html += `</tr>`;
    }); 
    tbody.innerHTML = html;
}

window.targetPrice = function() {
    const targetBtc = getNum("targetBtcPrice"); 
    const targetMnav = getNum("targetMnav");
    if (targetBtc > 0) localStorage.setItem("savedTargetBtc", targetBtc);
    if (targetMnav > 0) localStorage.setItem("savedTargetMnav", targetMnav);
    if (!targetBtc || !targetMnav) return;

    const fdso = getNum("fullyDilutedShares") || currentData.fdso;
    const btcHoldings = getNum("btcHoldings") || currentData.btcHoldings;
    if (fdso <= 0) return;

    const netBpsUsd = (btcHoldings * targetBtc + (currentData.usdAssetsUsdB * 1e9) - (currentData.debtUsdB * 1e9) - (currentData.preferredUsdB * 1e9)) / (fdso * 1e6);
    const predictedMstr = netBpsUsd * targetMnav;
    setText("predictedMstrPrice", `$${predictedMstr.toFixed(2)}`);
    setText("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
};

function calculateDashboard() {
    let currentBtcPrice = getNum("btcPrice") || parseFloat(localStorage.getItem("savedBtcPrice")) || 95000;
    let currentMstrPrice = getNum("mstrPrice") || parseFloat(localStorage.getItem("savedMstrPrice")) || 130;
    let btcHoldings = getNum("btcHoldings") || currentData.btcHoldings;
    let fdso = getNum("fullyDilutedShares") || currentData.fdso;
    if (fdso <= 0 || currentBtcPrice <= 0) return null;

    const netReserveUsd = (btcHoldings * currentBtcPrice) + (currentData.usdAssetsUsdB * 1e9) - (currentData.debtUsdB * 1e9) - (currentData.preferredUsdB * 1e9);
    const grossBpsSats = (btcHoldings / (fdso * 1e6)) * 100_000_000;
    const netBpsUsd = netReserveUsd / (fdso * 1e6);
    const netBpsSats = ((netReserveUsd / currentBtcPrice) / (fdso * 1e6)) * 100_000_000;

    setText("grossBpsSats", Math.round(grossBpsSats).toLocaleString());
    setText("netBpsSats", Math.round(netBpsSats).toLocaleString());
    setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);

    let mnav = null;
    if (currentMstrPrice > 0 && netBpsUsd > 0) {
        mnav = currentMstrPrice / netBpsUsd;
        const premiumPct = (mnav - 1) * 100;
        setText("mnavMultiple", `${mnav.toFixed(2)}×`);
        setText("premium", `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`);
        setText("signal", mnav < 1.0 ? "🟢 극심한 저평가 (NAV 대비 할인)" : (mnav > 2.5 ? "🔴 과열 주의 (높은 프리미엄)" : "🟡 중립 (적정 주가 구간)"));
    }

    updateScenarioTable(netBpsUsd, currentBtcPrice);
    return mnav; 
}

async function updateDashboard() {
    try {
        const futures = await fetchFuturesData();
        const fngIndex = await fetchFearAndGreed();

        if (autoSyncEnabled) {
            const [fetchedBtc, fetchedMstr] = await Promise.all([ fetchLiveBtcPrice(), fetchLiveMstrPrice() ]);
            if (fetchedBtc > 0) { setVal("btcPrice", fetchedBtc.toFixed(2)); localStorage.setItem("savedBtcPrice", fetchedBtc.toFixed(2)); }
            if (fetchedMstr > 0) { setVal("mstrPrice", fetchedMstr.toFixed(2)); localStorage.setItem("savedMstrPrice", fetchedMstr.toFixed(2)); }
            
            const now = new Date();
            setText("dataStatus", `시세 및 데이터 연동 완료 (${now.toTimeString().split(' ')[0]})`);
        } else {
            setText("dataStatus", "자동 동기화 일시 정지 (수동 모드)");
        }

        const currentMnav = calculateDashboard();

        if (fngIndex !== null) setText("badge-fng", `공포탐욕: ${fngIndex}`);
        if (currentMnav !== null) setText("badge-premium", `MSTR 프리미엄: ${currentMnav.toFixed(2)}x`);
        if (futures.rawLs !== null) setText("badge-ls", `L/S 비율: ${futures.rawLs.toFixed(2)}`);

        if (futures.fundingRate !== null) {
            updateCardValue(["fundingRate"], "Funding Rate", futures.fundingRate);
            const risk = evaluateMultiRisk(futures.rawFr, futures.rawLs, fngIndex, currentMnav);
            
            setText("futuresRiskStage", risk.stage);
            setText("futuresRiskText", risk.text);
            const riskStageEl = document.getElementById("futuresRiskStage");
            if (riskStageEl) riskStageEl.style.color = risk.color;
            
            await initOrUpdateFuturesChart(futures.rawFr, futures.rawOi, futures.rawLs);
        }
        if (futures.openInterest !== null) updateCardValue(["btcOi"], "BTC OI", futures.openInterest);

    } catch (e) {
        if (autoSyncEnabled) setText("dataStatus", "시세 연동 대기 중");
        calculateDashboard();
    } finally {
        window.targetPrice();
    }
}

function startAutoUpdates() {
    updateDashboard();
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() => { if (!document.hidden) updateDashboard(); }, 30000);
}

document.addEventListener("DOMContentLoaded", () => {
    const savedBtcHoldings = localStorage.getItem("savedBtcHoldings");
    const savedAdso = localStorage.getItem("savedAdso");
    const savedFdso = localStorage.getItem("savedFdso");
    const savedTargetBtc = localStorage.getItem("savedTargetBtc");
    const savedTargetMnav = localStorage.getItem("savedTargetMnav");
    const savedBtcPrice = localStorage.getItem("savedBtcPrice");
    const savedMstrPrice = localStorage.getItem("savedMstrPrice");

    if (savedBtcHoldings && !isNaN(parseFloat(savedBtcHoldings))) currentData.btcHoldings = parseFloat(savedBtcHoldings);
    if (savedAdso && !isNaN(parseFloat(savedAdso))) currentData.adso = parseFloat(savedAdso);
    if (savedFdso && !isNaN(parseFloat(savedFdso))) currentData.fdso = parseFloat(savedFdso);
    
    setVal("btcHoldings", currentData.btcHoldings);
    setVal("assumedShares", currentData.adso.toFixed(3));
    setVal("fullyDilutedShares", currentData.fdso.toFixed(3));
    if (savedTargetBtc && !isNaN(parseFloat(savedTargetBtc))) setVal("targetBtcPrice", savedTargetBtc);
    if (savedTargetMnav && !isNaN(parseFloat(savedTargetMnav))) setVal("targetMnav", savedTargetMnav);
    if (savedBtcPrice && !isNaN(parseFloat(savedBtcPrice))) setVal("btcPrice", savedBtcPrice);
    if (savedMstrPrice && !isNaN(parseFloat(savedMstrPrice))) setVal("mstrPrice", savedMstrPrice);

    const toggle = document.getElementById("autoSyncToggle");
    const toggleLabel = document.getElementById("autoSyncLabel");
    if (toggle) {
        toggle.addEventListener("change", (e) => {
            autoSyncEnabled = e.target.checked;
            if (toggleLabel) {
                toggleLabel.textContent = autoSyncEnabled ? "자동 동기화 ON" : "자동 동기화 OFF";
                toggleLabel.style.color = autoSyncEnabled ? "#ff9f0a" : "#8b949e";
            }
            if (autoSyncEnabled) updateDashboard(); 
        });
    }

    startAutoUpdates();

    const inputIds = ["btcPrice", "mstrPrice", "btcHoldings", "assumedShares", "fullyDilutedShares", "targetBtcPrice", "targetMnav"];
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", () => {
                const val = getNum(id);
                if (val >= 0) { 
                    if (id === "btcHoldings") { currentData.btcHoldings = val; localStorage.setItem("savedBtcHoldings", val); } 
                    else if (id === "assumedShares") { currentData.adso = val; localStorage.setItem("savedAdso", val); } 
                    else if (id === "fullyDilutedShares") { currentData.fdso = val; localStorage.setItem("savedFdso", val); } 
                    else if (id === "btcPrice") localStorage.setItem("savedBtcPrice", val);
                    else if (id === "mstrPrice") localStorage.setItem("savedMstrPrice", val);
                }
                calculateDashboard();
                window.targetPrice();
            });
        }
    });

    document.addEventListener("visibilitychange", () => { if (!document.hidden) updateDashboard(); });
});
