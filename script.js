const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

// MicroStrategy (Strategy.com) 기준 주요 재무 데이터 Default
const DEFAULT_DATA = {
    btcHoldings: 845050,      // 보유 BTC 수량
    adso: 298.039,           // Basic Shares (M)
    fdso: 424.479,           // Fully Diluted Shares (M)
    usdAssetsUsdB: 6.690,    // 현금 및 USD 자산 ($B)
    debtUsdB: 6.754,         // 총 부채 ($B)
    preferredUsdB: 14.966    // 우선주/Convertible Preferred ($B)
};

let currentData = { ...DEFAULT_DATA };
let futuresChartInstance = null;
let currentTf = '1M'; 
let updateTimer = null;
let autoSyncEnabled = true;

const USER_STORAGE_KEYS = ["btcHoldings", "assumedShares", "fullyDilutedShares", "targetBtcPrice", "targetMnav", "btcPrice", "mstrPrice"];

// LocalStorage 저장/불러오기
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

// Helper Functions
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

// 실시간 BTC 시세 (Coinbase -> Binance 순 fallback)
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

// 실시간 MSTR 주가 (Finnhub -> Yahoo Finance Proxy fallback)
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
    const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`, 
        `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`
    ];
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

// 공포탐욕 지수
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

// 선물 실시간 데이터 (Binance + Bybit Fallback)
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
            if (dataLS[0] && dataLS[0].longShortRatio !== undefined) { 
                rawLs = parseFloat(dataLS[0].longShortRatio); 
                lsRatio = rawLs.toFixed(2); 
            } 
        }
    } catch (e) {}

    // Bybit Fallback
    if (!fundingRate || !openInterest) {
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

// 선물 히스토리 수집
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

// Chart.js 렌더링
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
                    display: true, 
                    position: 'right', 
                    grace: '15%',
                    ticks: { color: '#3fb950' }, 
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

// 선물 위험도 진단
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

// Strategy.com 기준 MNAV 산출 및 화면 업데이트
function calculateMNAV() {
    const bPrice = getNum("btcPrice"), mPrice = getNum("mstrPrice");
    const h = getNum("btcHoldings"), a = getNum("assumedShares"), fd = getNum("fullyDilutedShares");

    if (!bPrice || !mPrice || !h || !a || !fd) {
        setText("grossBpsSats", "-");
        setText("grossBtcValue", "-");
        setText("netBpsSats", "-");
        setText("netBpsUsd", "-");
        setText("mnavMultiple", "-");
        setText("premium", "입력 대기 중...");
        setText("signal", "수치를 입력해주세요.");
        return null;
    }

    // 1. Gross BTC per Share (Sats): 주당 비트코인 보유량 (Satoshis)
    // Formula: (Total BTC / Shares in Millions) * 100
    const grossBpsSats = (h / a) * 100;
    setText("grossBpsSats", grossBpsSats.toLocaleString(undefined, { maximumFractionDigits: 0 }));

    // 2. Gross BTC Value ($): 주당 비트코인 평가액
    // Formula: (Total BTC * BTC Price) / (Shares in Millions * 1,000,000)
    const grossBtcValueUsd = (h * bPrice) / (a * 1e6);
    const formattedGrossUsd = "$" + grossBtcValueUsd.toFixed(2);
    
    const grossBtcIds = ["grossBtcValue", "grossValue", "grossBpsUsd", "grossBtcUsd"];
    grossBtcIds.forEach(id => setText(id, formattedGrossUsd));

    // 3. Net Assets Calculation (Strategy.com 기준)
    // 주가 희석 구간 조건 판단 (주가 상승 시 Fully Diluted 적용)
    const fdSharesForCalc = (mPrice > 143.4) ? fd : a;
    const { usdAssetsUsdB, debtUsdB, preferredUsdB } = currentData;
    
    const btcValueUsdB = (h * bPrice) / 1e9;
    const netBtcAssetsUsdB = btcValueUsdB + usdAssetsUsdB - debtUsdB - preferredUsdB;
    
    let netBpsUsd = 0, currentPremium = 0, signal = "";
    
    if (netBtcAssetsUsdB > 0) {
        // Net BPS ($) = Net BTC Assets ($) / Diluted Shares
        netBpsUsd = (netBtcAssetsUsdB * 1e9) / (fdSharesForCalc * 1e6);
        currentPremium = mPrice / netBpsUsd;
        const netBpsSats = (netBpsUsd / bPrice) * 1e8;
        
        setText("netBpsSats", netBpsSats.toLocaleString(undefined, { maximumFractionDigits: 0 }));
        setText("netBpsUsd", "$" + netBpsUsd.toFixed(2));
        setText("mnavMultiple", currentPremium.toFixed(2) + "×");
        setText("premium", `현재 Premium: ${(currentPremium * 100).toFixed(1)}%`);
        
        if (currentPremium < 1.0) signal = "매수 기회: MNAV 1.0 미만 (역프리미엄)";
        else if (currentPremium < 1.3) signal = "평균적 밸류에이션 (보통)";
        else if (currentPremium < 2.0) signal = "프리미엄 확대 구간 (주의)";
        else signal = "고평가 가능성: MNAV 2.0 이상 (분할 매도 고려)";
    } else {
        setText("netBpsSats", "N/A");
        setText("netBpsUsd", "N/A");
        setText("mnavMultiple", "N/A");
        setText("premium", "Net Assets < 0");
        signal = "리스크 경고: 부채 초과 상태";
    }
    
    const sigEl = document.getElementById("signal");
    if (sigEl) {
        sigEl.textContent = signal;
        sigEl.style.color = currentPremium < 1.0 ? "#3fb950" : (currentPremium >= 2.0 ? "#ff4d4d" : "#58a6ff");
    }
    
    return { currentPremium, fdSharesForCalc };
}

// 목표가 시뮬레이터
function runSimulator(fdSharesForCalc) {
    const targetBtcPrice = getNum("targetBtcPrice"), targetMnav = getNum("targetMnav"), h = getNum("btcHoldings");
    if (!targetBtcPrice || !targetMnav || !h || !fdSharesForCalc) {
        setText("predictedMstrPrice", "$0.00");
        setText("predictedNetBps", "예상 Net BPS: $0.00");
        return;
    }

    const { usdAssetsUsdB, debtUsdB, preferredUsdB } = currentData;
    const targetBtcValueUsdB = (h * targetBtcPrice) / 1e9;
    const targetNetBtcAssetsUsdB = targetBtcValueUsdB + usdAssetsUsdB - debtUsdB - preferredUsdB;
    
    if (targetNetBtcAssetsUsdB > 0) {
        const targetNetBpsUsd = (targetNetBtcAssetsUsdB * 1e9) / (fdSharesForCalc * 1e6);
        const predictedMstr = targetNetBpsUsd * targetMnav;
        setText("predictedMstrPrice", "$" + predictedMstr.toFixed(2));
        setText("predictedNetBps", "예상 Net BPS: $" + targetNetBpsUsd.toFixed(2));
    } else {
        setText("predictedMstrPrice", "N/A");
        setText("predictedNetBps", "예상 Net BPS: N/A");
    }
}

// 시나리오 시뮬레이션 표 생성
function generateScenarioTable(fdSharesForCalc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !fdSharesForCalc) return;
    
    const { usdAssetsUsdB, debtUsdB, preferredUsdB } = currentData;
    const h = getNum("btcHoldings");
    const btcPrices = [30000, 50000, 70000, 100000, 150000, 200000, 300000, 500000];
    const mnavMultiples = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
    
    let html = "";
    btcPrices.forEach(p => {
        const valB = (h * p) / 1e9;
        const netB = valB + usdAssetsUsdB - debtUsdB - preferredUsdB;
        const bps = (netB > 0) ? (netB * 1e9) / (fdSharesForCalc * 1e6) : 0;
        
        let row = `<tr><td style="font-weight:bold;color:#fff;">$${(p/1000).toFixed(0)}k</td>`;
        mnavMultiples.forEach(m => {
            if (bps > 0) {
                const est = bps * m;
                row += `<td style="color:${m >= 2.0 ? '#ff9f0a' : '#58a6ff'}">$${est.toFixed(0)}</td>`;
            } else { 
                row += `<td style="color:#666;">-</td>`; 
            }
        });
        row += `</tr>`;
        html += row;
    });
    tbody.innerHTML = html;
}

// 대시보드 전체 업데이트
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
        setText("badge-ls", futures.lsRatio ? `L/S 비율: ${futures.lsRatio}` : `L/S 비율: -`);
    }

    if (!futuresChartInstance || forceChartRefresh) {
        const cData = await fetchFuturesHistory(currentTf);
        if (cData) renderChart(cData);
    }

    // 상단 갱신 시간 기록
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    setText("lastUpdated", `(최근 갱신: ${timeStr})`);
}

function recalculateOnly() {
    const calc = calculateMNAV();
    if (calc && calc.fdSharesForCalc) {
        runSimulator(calc.fdSharesForCalc);
        generateScenarioTable(calc.fdSharesForCalc);
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

// 이벤트 리스너 바인딩 및 초기화
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
