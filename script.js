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

// UI 보조 함수
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

// 안전한 Fetch 타임아웃 함수
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

// BTC 실시간 가격 수집
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

// MSTR 실시간 주가 수집
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

// 공포 탐욕 지수 수집
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

// 선물 히스토리 차트 데이터 수집 (오류 수정됨)
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
            fetchWithTimeout(klineUrl, 6000),
            fetchWithTimeout(frUrl, 6000),
            fetchWithTimeout(oiUrl, 6000),
            fetchWithTimeout(lsUrl, 6000)
        ]);

        if (!resKline || !resKline.ok) return null;
        const klines = await resKline.json(); 
        if (!Array.isArray(klines)) return null; 

        let frList = [], oiList = [], lsList = [];
        if (resFR && resFR.ok) { const parsed = await resFR.json(); if (Array.isArray(parsed)) frList = parsed; }
        if (resOI && resOI.ok) { const parsed = await resOI.json(); if (Array.isArray(parsed)) oiList = parsed; }
        if (resLS && resLS.ok) { const parsed = await resLS.json(); if (Array.isArray(parsed)) lsList = parsed; }

        const labels = [], frData = [], oiData = [], lsData = [];
        
        // 날짜 오차 범위 보정 매핑 알고리즘
        const findClosest = (list, timeKey, targetTs, maxDiff) => {
            if (!list || !list.length) return null;
            let closest = null, minDiff = Infinity;
            for (let i = list.length - 1; i >= 0; i--) {
                const diff = Math.abs(list[i][timeKey] - targetTs);
                if (diff < minDiff) { minDiff = diff; closest = list[i]; }
                if (list[i][timeKey] < targetTs - maxDiff) break;
            }
            return minDiff <= maxDiff ? closest : null;
        };

        klines.forEach(k => {
            const ts = k[0]; 
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
            
            const cFr = findClosest(frList, 'fundingTime', ts, 12 * 60 * 60 * 1000);
            frData.push(cFr ? parseFloat(cFr.fundingRate) * 100 : null);
            
            const cOi = findClosest(oiList, 'timestamp', ts, 24 * 60 * 60 * 1000);
            oiData.push(cOi ? parseFloat(cOi.sumOpenInterest) / 1000 : null);
            
            const cLs = findClosest(lsList, 'timestamp', ts, 24 * 60 * 60 * 1000);
            lsData.push(cLs ? parseFloat(cLs.longShortRatio) : null);
        });
        
        return { labels, frData, oiData, lsData };
    } catch (e) { return null; }
}

// 실시간 선물 레버리지 지표 수집
async function fetchFuturesData() {
    let fundingRate = null, openInterest = null, lsRatio = null, rawFr = 0, rawOi = 0, rawLs = 1.0;
    try {
        const [resFR, resOI, resLS] = await Promise.all([
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", 4000),
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT", 4000),
            fetchWithTimeout("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1", 4000)
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
    
    return { fundingRate, openInterest, lsRatio, rawFr, rawOi, rawLs };
}

// Chart.js 렌더링
function renderChart(chartData) {
    if (!chartData || !chartData.labels.length) return;
    const ctx = document.getElementById('futuresChart');
    if (!ctx) return;
    
    if (futuresChartInstance) { 
        futuresChartInstance.destroy(); 
        futuresChartInstance = null; 
    }

    const { labels, frData, oiData } = chartData;

    futuresChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Funding Rate (%)', data: frData, borderColor: '#ff9f0a', backgroundColor: 'rgba(255, 159, 10, 0.1)', yAxisID: 'yFR', pointRadius: 0, borderWidth: 1, fill: true, tension: 0.2 },
                { label: 'Open Interest (K)', data: oiData, borderColor: '#58a6ff', backgroundColor: 'transparent', yAxisID: 'yOI', pointRadius: 0, borderWidth: 1.5, tension: 0.2 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#8b949e', boxWidth: 12 } } },
            scales: {
                x: { ticks: { color: '#8b949e', maxTicksLimit: 6 }, grid: { color: '#30363d' } },
                yFR: { type: 'linear', display: true, position: 'left', ticks: { color: '#ff9f0a' }, grid: { color: '#30363d' } },
                yOI: { type: 'linear', display: true, position: 'right', ticks: { color: '#58a6ff' }, grid: { drawOnChartArea: false } }
            }
        }
    });
}

// 선물 레버리지 위험도 5단계 측정
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

// MNAV 및 BPS 핵심 계산 로직 (예외 처리 강화)
function calculateMNAV() {
    const bPrice = getNum("btcPrice"), mPrice = getNum("mstrPrice");
    const h = getNum("btcHoldings"), a = getNum("assumedShares"), fd = getNum("fullyDilutedShares");

    if (!bPrice || !mPrice || !h || !a || !fd) {
        setText("grossBpsSats", "-");
        setText("netBpsSats", "-");
        setText("netBpsUsd", "-");
        setText("mnavMultiple", "-");
        setText("premium", "입력 대기 중...");
        setText("signal", "수치를 입력해주세요.");
        return null;
    }

    const satsPerBtc = 1e8, grossBpsSats = (h / a) * satsPerBtc;
    setText("grossBpsSats", grossBpsSats.toLocaleString(undefined, { maximumFractionDigits: 0 }));

    const fdSharesForCalc = (mPrice > 143.4) ? fd : a;
    const { usdAssetsUsdB, debtUsdB, preferredUsdB } = currentData;
    const btcValueUsdB = (h * bPrice) / 1e9;
    const netBtcAssetsUsdB = btcValueUsdB + usdAssetsUsdB - debtUsdB - preferredUsdB;
    
    let netBpsUsd = 0, currentPremium = 0, signal = "";
    
    if (netBtcAssetsUsdB > 0) {
        netBpsUsd = (netBtcAssetsUsdB * 1e9) / (fdSharesForCalc * 1e6);
        currentPremium = mPrice / netBpsUsd;
        const netBpsSats = (netBpsUsd / bPrice) * satsPerBtc;
        
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

// 목표가 시뮬레이터 실행
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

// 가격별 mNAV 시나리오 표 생성
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
            } else { row += `<td style="color:#666;">-</td>`; }
        });
        row += `</tr>`;
        html += row;
    });
    tbody.innerHTML = html;
}

// API 호출을 수반하는 대시보드 전체 업데이트
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
        
        setText("badge-fng", fng !== null ? `공포탐욕: ${fng}` : `공포탐욕: 실패`);
        setText("badge-premium", currentPremium ? `MSTR 프리미엄: ${currentPremium.toFixed(2)}x` : `MSTR 프리미엄: -`);
        setText("badge-ls", futures.lsRatio ? `L/S 비율: ${futures.lsRatio}` : `L/S 비율: -`);
    }

    if (!futuresChartInstance || forceChartRefresh) {
        const cData = await fetchFuturesHistory(currentTf);
        if (cData) renderChart(cData);
    }
}

// 입력 즉시 실행되는 빠른 순수 계산 함수 (API 호출 없음)
function recalculateOnly() {
    const calc = calculateMNAV();
    if (calc && calc.fdSharesForCalc) {
        runSimulator(calc.fdSharesForCalc);
        generateScenarioTable(calc.fdSharesForCalc);
    }
}

// 차트 기간 변경 이벤트
async function changeChartTimeframe(tf) {
    currentTf = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('tf-' + tf);
    if (activeBtn) activeBtn.classList.add('active');
    
    const cData = await fetchFuturesHistory(tf);
    if (cData) renderChart(cData);
}

// 사용자가 숫자를 수정할 때 (API 호출 폭주 방지 로직)
function handleInput() {
    recalculateOnly();
}

// 실시간 가격을 사용자가 직접 입력할 때 (자동 동기화 OFF 전환)
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
    recalculateOnly();
}

// 자동 동기화 토글 스위치 이벤트
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

// 이벤트 리스너 바인딩 (수정됨)
document.querySelectorAll('input').forEach(input => {
    if (input.id === "btcPrice" || input.id === "mstrPrice") {
        input.addEventListener('input', handlePriceInput);
    } else if (input.id !== "autoSyncToggle") {
        input.addEventListener('input', handleInput);
    }
});

const syncToggle = document.getElementById("autoSyncToggle");
if (syncToggle) syncToggle.addEventListener('change', toggleAutoSync);

// 페이지 로드 시 초기화 및 30초 주기 타이머 실행
document.addEventListener("DOMContentLoaded", () => {
    updateDashboard(true);
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() => updateDashboard(false), 30000);
});
