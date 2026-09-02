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

const USER_STORAGE_KEYS = ["btcHoldings", "assumedShares", "fullyDilutedShares", "targetBtcPrice", "targetMnav"];

function saveInputsToStorage() {
    USER_STORAGE_KEYS.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value.trim() !== "") {
            localStorage.setItem("mstr_app_" + id, el.value.trim());
        }
    });
}

function loadInputsFromStorage() {
    USER_STORAGE_KEYS.forEach(id => {
        const saved = localStorage.getItem("mstr_app_" + id);
        const el = document.getElementById(id);
        if (saved !== null && saved.trim() !== "" && el) {
            el.value = saved;
        }
    });
}

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

async function fetchWithTimeout(url, timeoutMs = 4000, options = {}) {
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

async function fetchFuturesData() {
    let fundingRate = null, openInterest = null, lsRatio = null, rawFr = 0, rawOi = 0, rawLs = 1.0;
    
    try {
        const [resFR, resOI, resLS] = await Promise.all([
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", 3000),
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", 3000),
            fetchWithTimeout("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1", 3000)
        ]);

        if (resFR && resFR.ok) { 
            const dataFR = await resFR.json(); 
            if (dataFR.lastFundingRate !== undefined) { 
                rawFr = parseFloat(dataFR.lastFundingRate); 
                fundingRate = (rawFr * 100).toFixed(4) + "%"; 
            } 
        }
        if (resOI && resOI.ok) { 
            const dataOI = await resOI.json(); 
            if (dataOI.openInterest !== undefined) { 
                rawOi = parseFloat(dataOI.openInterest); 
                openInterest = (rawOi / 1000).toFixed(1) + "K BTC"; 
            } 
        }
        if (resLS && resLS.ok) { 
            const dataLS = await resLS.json(); 
            if (Array.isArray(dataLS) && dataLS[0] && dataLS[0].longShortRatio !== undefined) { 
                rawLs = parseFloat(dataLS[0].longShortRatio); 
                lsRatio = rawLs.toFixed(2); 
            } 
        }
    } catch (e) {}

    if (!fundingRate || !openInterest || !lsRatio) {
        try {
            const resBybit = await fetchWithTimeout("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT", 3000);
            if (resBybit && resBybit.ok) {
                const dataBybit = await resBybit.json();
                const item = dataBybit?.result?.list?.[0];
                if (item) {
                    if (!fundingRate && item.fundingRate) {
                        rawFr = parseFloat(item.fundingRate);
                        fundingRate = (rawFr * 100).toFixed(4) + "%";
                    }
                    if (!openInterest && item.openInterest) {
                        rawOi = parseFloat(item.openInterest);
                        openInterest = (rawOi / 1000).toFixed(1) + "K BTC";
                    }
                }
            }
        } catch (e) {}
    }
    
    return { fundingRate, openInterest, lsRatio, rawFr, rawOi, rawLs };
}

async function fetchFuturesHistory(tf = '1M') {
    let interval = '2h', period = '2h', limit = 360, frLimit = 90;
    
    if (tf === '1D') { interval = '5m'; period = '5m'; limit = 288; frLimit = 24; } 
    else if (tf === '1M') { interval = '2h'; period = '2h'; limit = 360; frLimit = 90; } 
    else if (tf === '3M') { interval = '6h'; period = '6h'; limit = 360; frLimit = 270; } 
    else if (tf === '6M') { interval = '12h'; period = '12h'; limit = 360; frLimit = 540; } 
    else if (tf === '1Y') { interval = '1d'; period = '1d'; limit = 365; frLimit = 1000; } 
    else if (tf === 'MAX') { interval = '1d'; period = '1d'; limit = 1500; frLimit = 1000; }

    try {
        const klineUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
        const frUrl = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${frLimit}`;
        const oiUrl = `https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=${period}&limit=500`;
        const lsUrl = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${period}&limit=500`;

        const [resKline, resFR, resOI, resLS] = await Promise.all([
            fetchWithTimeout(klineUrl, 5000),
            fetchWithTimeout(frUrl, 5000),
            fetchWithTimeout(oiUrl, 5000),
            fetchWithTimeout(lsUrl, 5000)
        ]);

        if (!resKline || !resKline.ok) return null;
        const klines = await resKline.json(); 
        if (!Array.isArray(klines)) return null; 

        let frList = [], oiList = [], lsList = [];
        if (resFR && resFR.ok) { const parsed = await resFR.json(); if (Array.isArray(parsed)) frList = parsed; }
        if (resOI && resOI.ok) { const parsed = await resOI.json(); if (Array.isArray(parsed)) oiList = parsed; }
        if (resLS && resLS.ok) { const parsed = await resLS.json(); if (Array.isArray(parsed)) lsList = parsed; }

        const labels = [], frData = [], oiData = [], lsData = [];
        
        const findClosest = (list, timeKey, targetTs, maxDiff) => {
            if (!list || !list.length) return null;
            let closest = null, minDiff = Infinity;
            for (let i = list.length - 1; i >= 0; i--) {
                const itemTime = Number(list[i][timeKey]);
                const diff = Math.abs(itemTime - targetTs);
                if (diff < minDiff) { minDiff = diff; closest = list[i]; }
            }
            return minDiff <= maxDiff ? closest : null;
        };

        klines.forEach(k => {
            const ts = Number(k[0]); 
            const dateObj = new Date(ts);
            
            let dateStr = "";
            if (tf === '1D') {
                dateStr = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
            } else if (tf === '1Y' || tf === 'MAX') {
                dateStr = `${String(dateObj.getFullYear()).slice(2)}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getDate()).padStart(2, '0')}`;
            } else {
                dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()} ${dateObj.getHours().toString().padStart(2, '0')}:00`;
            }
            
            labels.push(dateStr);
            
            const cFr = findClosest(frList, 'fundingTime', ts, 24 * 60 * 60 * 1000);
            frData.push(cFr ? parseFloat(cFr.fundingRate) * 100 : null);
            
            const cOi = findClosest(oiList, 'timestamp', ts, 48 * 60 * 60 * 1000);
            oiData.push(cOi ? parseFloat(cOi.sumOpenInterest) / 1000 : null);
            
            const cLs = findClosest(lsList, 'timestamp', ts, 48 * 60 * 60 * 1000);
            lsData.push(cLs ? parseFloat(cLs.longShortRatio) : null);
        });
        
        return { labels, frData, oiData, lsData };
    } catch (e) { return null; }
}

// Chart.js 다중 우측 축 교정 (우측 롱숏비율 축 선명하게 복원)
function renderChart(chartData) {
    if (!chartData || !chartData.labels.length) return;
    const canvas = document.getElementById('futuresChart');
    if (!canvas) return;
    
    if (futuresChartInstance) { 
        futuresChartInstance.destroy(); 
        futuresChartInstance = null; 
    }

    const { labels, frData, oiData, lsData } = chartData;

    futuresChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { 
                    label: 'Funding Rate (%)', 
                    data: frData, 
                    borderColor: '#ff9f0a', 
                    backgroundColor: 'rgba(255, 159, 10, 0.1)', 
                    yAxisID: 'yFR', 
                    pointRadius: 0, 
                    borderWidth: 1.5, 
                    fill: true, 
                    tension: 0.2,
                    spanGaps: true
                },
                { 
                    label: 'Open Interest (K)', 
                    data: oiData, 
                    borderColor: '#58a6ff', 
                    backgroundColor: 'transparent', 
                    yAxisID: 'yOI', 
                    pointRadius: 0, 
                    borderWidth: 1.5, 
                    tension: 0.2,
                    spanGaps: true
                },
                { 
                    label: 'Long/Short Ratio', 
                    data: lsData, 
                    borderColor: '#3fb950', 
                    backgroundColor: 'transparent', 
                    yAxisID: 'yLS', 
                    pointRadius: 0, 
                    borderWidth: 1.5, 
                    tension: 0.2,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false,
            layout: { padding: { top: 10, bottom: 10, left: 5, right: 5 } },
            interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { labels: { color: '#8b949e', boxWidth: 12 } } 
            },
            scales: {
                x: { 
                    ticks: { color: '#8b949e', maxTicksLimit: 6 }, 
                    grid: { color: '#30363d' } 
                },
                yFR: { 
                    type: 'linear', 
                    display: true, 
                    position: 'left', 
                    grace: '15%',
                    ticks: { color: '#ff9f0a' }, 
                    grid: { color: '#30363d' } 
                },
                yOI: { 
                    type: 'linear', 
                    display: true, 
                    position: 'right', 
                    grace: '15%',
                    ticks: { color: '#58a6ff' }, 
                    grid: { drawOnChartArea: false } 
                },
                yLS: { 
                    type: 'linear', 
                    display: true, // 복원 완료: 우측 두번째 축으로 명확히 표기
                    position: 'right', 
                    grace: '15%',
                    ticks: { color: '#3fb950' }, 
                    grid: { drawOnChartArea: false } 
                }
            }
        }
    });
}

function determineFuturesRiskStage(fng, fr, premium, ls) {
    let score = 0;
    if (fng !== null) { 
        if (fng > 80) score += 3; else if (fng > 70) score += 2; else if (fng > 60) score += 1; else if (fng < 30) score -= 2; 
    }
    if (fr !== null) { 
        if (fr > 0.0005) score += 3; else if (fr > 0.0002) score += 2; else if (fr > 0.0001) score += 1; else if (fr < 0) score -= 1; 
    }
    if (premium !== null) { 
        if (premium > 2.5) score += 3; else if (premium > 2.0) score += 2; else if (premium > 1.5) score += 1; else if (premium < 1.0) score -= 2; 
    }
    if (ls !== null) { 
        if (ls > 2.5) score += 2; else if (ls > 1.5) score += 1; else if (ls < 0.8) score -= 1; 
    }
    
    if (score >= 8) return { stage: "🔥 5단계: 극단적 과열 (초고위험)", color: "#ff4d4d", text: "레버리지 포지션이 포화 상태이며 조정 임박 가능성이 매우 높습니다." };
    if (score >= 5) return { stage: "⚠️ 4단계: 과열 진입 (고위험)", color: "#ff9f0a", text: "시장 흥분도가 높으며 롱 스퀴즈(연쇄 청산) 위험이 증가하고 있습니다." };
    if (score >= 2) return { stage: "🟡 3단계: 상승세 (중위험)", color: "#f1e05a", text: "일반적인 강세장 수준으로 레버리지가 적절히 쌓이고 있습니다." };
    if (score >= -2) return { stage: "🟢 2단계: 안정적 (저위험)", color: "#3fb950", text: "과도한 레버리지가 해소된 안정적인 시장 상태입니다." };
    return { stage: "🧊 1단계: 극도의 공포 (침체)", color: "#58a6ff", text: "시장이 심하게 위축되었으며 숏 포지션이 지배적인 딥(Dip) 상태일 수 있습니다." };
}

// Strategy.com 표준 mNAV 및 Net BPS 정밀 수식
function calculateMNAV() {
    const bPrice = getNum("btcPrice"), mPrice = getNum("mstrPrice");
    const h = getNum("btcHoldings"), a = getNum("assumedShares"), fd = getNum("fullyDilutedShares");

    if (!bPrice || !mPrice || !h || !a || !fd) {
        setText("grossBpsSats", "-");
        setText("grossBpsUsd", "-");
        setText("mnavMultiple", "-");
        setText("netBpsUsd", "-");
        setText("netBpsSats", "Sats: -");
        setText("premium", "입력 대기 중...");
        setText("signal", "수치를 입력해주세요.");
        return null;
    }

    // 1. Gross BTC per Share (Sats) - Strategy.com 공식 계산법
    const grossBpsSats = (h / a) * 1e8 / 1e6; // (h * 100,000,000) / (a * 1,000,000) = (h / a) * 100
    const grossBpsUsd = (grossBpsSats / 1e8) * bPrice; // 주당 비트코인 가치 ($)
    
    // 2. Strategy.com 공식 mNAV = MSTR 주가 / Gross BTC 가치
    const currentPremium = mPrice / grossBpsUsd;

    setText("grossBpsSats", Math.round(grossBpsSats).toLocaleString());
    setText("grossBpsUsd", "$" + grossBpsUsd.toFixed(2));
    setText("mnavMultiple", currentPremium.toFixed(2) + "×");
    setText("premium", `현재 프리미엄: ${((currentPremium - 1) * 100).toFixed(1)}%`);

    // 3. Net BPS (순자산 반영) - 희석 주식수(FDSO) 사용 시 부채/우선주 전환 고려 정밀 계산
    const { usdAssetsUsdB, debtUsdB, preferredUsdB } = currentData;
    const btcValueUsdB = (h * bPrice) / 1e9;
    
    // FDSO 적용 시 전환우선주/사채가 주식으로 바뀌었으므로 순 현금/순 비전환부채만 차감
    const netBtcAssetsUsdB = btcValueUsdB + usdAssetsUsdB - debtUsdB; 
    const netBpsUsd = (netBtcAssetsUsdB * 1e9) / (fd * 1e6);
    const netBpsSats = (netBpsUsd / bPrice) * 1e8;

    setText("netBpsUsd", "$" + netBpsUsd.toFixed(2));
    setText("netBpsSats", "Sats: " + Math.round(netBpsSats).toLocaleString());

    let signal = "";
    if (currentPremium < 1.0) signal = "매수 기회: mNAV 1.0 미만 (역프리미엄)";
    else if (currentPremium < 1.3) signal = "Strategy.com 적정 밸류에이션 구간";
    else if (currentPremium < 2.0) signal = "프리미엄 확대 구간 (주의)";
    else signal = "고평가 경고: mNAV 2.0 이상 (분할 매도 고려)";

    const sigEl = document.getElementById("signal");
    if (sigEl) {
        sigEl.textContent = signal;
        sigEl.style.color = currentPremium < 1.0 ? "#3fb950" : (currentPremium >= 2.0 ? "#ff4d4d" : "#58a6ff");
    }
    
    return { currentPremium, grossBpsUsd };
}

function runSimulator(grossBpsUsd) {
    const targetBtcPrice = getNum("targetBtcPrice"), targetMnav = getNum("targetMnav"), h = getNum("btcHoldings"), a = getNum("assumedShares");
    if (!targetBtcPrice || !targetMnav || !h || !a) {
        setText("predictedMstrPrice", "$0.00");
        setText("predictedNetBps", "예상 Gross BTC Value: $0.00");
        return;
    }

    const predictedGrossBpsUsd = (h / a * 100 / 1e8) * targetBtcPrice;
    const predictedMstr = predictedGrossBpsUsd * targetMnav;
    
    setText("predictedMstrPrice", "$" + predictedMstr.toFixed(2));
    setText("predictedNetBps", "예상 Gross BTC Value: $" + predictedGrossBpsUsd.toFixed(2));
}

function generateScenarioTable() {
    const tbody = document.getElementById("scenarioTable");
    const h = getNum("btcHoldings"), a = getNum("assumedShares");
    if (!tbody || !h || !a) return;
    
    const btcPrices = [30000, 50000, 70000, 100000, 150000, 200000, 300000, 500000];
    const mnavMultiples = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
    
    let html = "";
    btcPrices.forEach(p => {
        const grossUsd = (h / a * 100 / 1e8) * p;
        let row = `<tr><td style="font-weight:bold;color:#fff;">$${(p/1000).toFixed(0)}k</td>`;
        mnavMultiples.forEach(m => {
            const est = grossUsd * m;
            row += `<td style="color:${m >= 2.0 ? '#ff9f0a' : '#58a6ff'}">$${est.toFixed(0)}</td>`;
        });
        row += `</tr>`;
        html += row;
    });
    tbody.innerHTML = html;
}

async function updateDashboard(forceChartRefresh = false) {
    if (autoSyncEnabled) {
        const liveBtc = await fetchLiveBtcPrice();
        if (liveBtc) setVal("btcPrice", liveBtc.toFixed(2));
        const liveMstr = await fetchLiveMstrPrice();
        if (liveMstr) setVal("mstrPrice", liveMstr.toFixed(2));
    }

    recalculateOnly();
    
    const calc = calculateMNAV();
    const currentPremium = calc ? calc.currentPremium : null;

    const fng = await fetchFearAndGreed();
    const futures = await fetchFuturesData();
    
    if (futures) {
        setText("fundingRate", futures.fundingRate || "-");
        setText("btcOi", futures.openInterest || "-");
        
        const risk = determineFuturesRiskStage(fng, futures.rawFr, currentPremium, futures.rawLs);
        setText("futuresRiskStage", risk.stage);
        const stageEl = document.getElementById("futuresRiskStage");
        if (stageEl) stageEl.style.color = risk.color;
        setText("futuresRiskText", risk.text);
        
        setText("badge-fng", fng !== null ? `공포탐욕: ${fng}` : `공포탐욕: 연동중`);
        setText("badge-premium", currentPremium ? `MSTR 프리미엄: ${currentPremium.toFixed(2)}x` : `MSTR 프리미엄: -`);
        setText("badge-ls", futures.lsRatio ? `L/S 비율: ${futures.lsRatio}` : `L/S 비율: ${futures.rawLs ? futures.rawLs.toFixed(2) : '-'}`);
    }

    if (!futuresChartInstance || forceChartRefresh) {
        const cData = await fetchFuturesHistory(currentTf);
        if (cData) renderChart(cData);
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    setText("lastUpdated", `(최근 갱신: ${timeStr})`);
}

function recalculateOnly() {
    const calc = calculateMNAV();
    if (calc && calc.grossBpsUsd) {
        runSimulator(calc.grossBpsUsd);
        generateScenarioTable();
    }
}

async function changeChartTimeframe(tf) {
    currentTf = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('tf-' + tf);
    if (activeBtn) activeBtn.classList.add('active');
    
    const cData = await fetchFuturesHistory(tf);
    if (cData) renderChart(cData);
}

function handleInput() {
    saveInputsToStorage();
    recalculateOnly();
}

function handlePriceInput() {
    if (autoSyncEnabled) {
        const toggle = document.getElementById("autoSyncToggle");
        if (toggle) toggle.checked = false;
        setText("autoSyncLabel", "자동 동기화 OFF");
        const label = document.getElementById("autoSyncLabel");
        if (label) label.style.color = "#8b949e";
        setText("dataStatus", "사용자 직접 입력 (수동 모드)");
        autoSyncEnabled = false;
    }
    handleInput();
}

function toggleAutoSync() {
    const toggle = document.getElementById("autoSyncToggle");
    const isChecked = toggle ? toggle.checked : false;
    autoSyncEnabled = isChecked;
    
    const label = document.getElementById("autoSyncLabel");
    if (isChecked) {
        setText("autoSyncLabel", "자동 동기화 ON");
        if (label) label.style.color = "#ff9f0a";
        setText("dataStatus", "실시간 데이터 연동 중...");
        updateDashboard(false); 
    } else {
        setText("autoSyncLabel", "자동 동기화 OFF");
        if (label) label.style.color = "#8b949e";
        setText("dataStatus", "사용자 직접 입력 (수동 모드)");
    }
}

document.querySelectorAll('input').forEach(input => {
    if (input.id === "btcPrice" || input.id === "mstrPrice") {
        input.addEventListener('input', handlePriceInput);
    } else if (input.id !== "autoSyncToggle") {
        input.addEventListener('input', handleInput);
    }
});

const syncToggle = document.getElementById("autoSyncToggle");
if (syncToggle) syncToggle.addEventListener('change', toggleAutoSync);

document.addEventListener("DOMContentLoaded", () => {
    loadInputsFromStorage();
    updateDashboard(true);
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() => updateDashboard(false), 30000);
});
