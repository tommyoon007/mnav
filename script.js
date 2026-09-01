// =========================================================
// MSTR mNAV & BTC DASHBOARD - ULTRA-FAST PARALLEL RACE FETCH
// =========================================================

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
let isChartInitialized = false;

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
    const val = el.value !== undefined && el.value !== "" ? el.value : el.textContent;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
}

async function fetchWithTimeout(url, timeoutMs = 3000, options = {}) {
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

// ---------------------------------------------------------
// [초고속] BTC 실시간 가격 - 병렬 레이싱
// ---------------------------------------------------------
async function fetchLiveBtcPriceFast() {
    const sources = [
        async () => {
            const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD", 2000);
            if (!res || !res.ok) throw new Error();
            const data = await res.json();
            const p = parseFloat(data?.data?.amount);
            if (p > 0) return { price: p, src: "Coinbase" };
            throw new Error();
        },
        async () => {
            const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", 2000);
            if (!res || !res.ok) throw new Error();
            const data = await res.json();
            const p = parseFloat(data?.price);
            if (p > 0) return { price: p, src: "Binance" };
            throw new Error();
        },
        async () => {
            const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", 2000);
            if (!res || !res.ok) throw new Error();
            const data = await res.json();
            const p = parseFloat(data?.bitcoin?.usd);
            if (p > 0) return { price: p, src: "CoinGecko" };
            throw new Error();
        }
    ];

    try {
        const result = await Promise.any(sources.map(fn => fn()));
        console.log(`[BTC 성공] 출처: ${result.src}, 가격: $${result.price}`);
        return result.price;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------
// [초고속] MSTR 실시간 주가 - 병렬 레이싱
// ---------------------------------------------------------
async function fetchLiveMstrPriceFast() {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&range=1d&includePrePost=true&ts=${Date.now()}`;
    const sources = [];

    if (FINNHUB_KEY) {
        sources.push(async () => {
            const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`, 2000);
            if (!res || !res.ok) throw new Error();
            const data = await res.json();
            const price = (data?.c > 0) ? data.c : data?.pc;
            if (price && price > 0) return { price: parseFloat(price), src: "Finnhub" };
            throw new Error();
        });
    }

    sources.push(async () => {
        const res = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`, 2500);
        if (!res || !res.ok) throw new Error();
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        const price = meta?.postMarketPrice || meta?.preMarketPrice || meta?.regularMarketPrice || meta?.chartPreviousClose;
        if (price && price > 0) return { price: parseFloat(price), src: "Yahoo-CorsProxy" };
        throw new Error();
    });

    sources.push(async () => {
        const res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`, 2500);
        if (!res || !res.ok) throw new Error();
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        const price = meta?.postMarketPrice || meta?.preMarketPrice || meta?.regularMarketPrice || meta?.chartPreviousClose;
        if (price && price > 0) return { price: parseFloat(price), src: "Yahoo-AllOrigins" };
        throw new Error();
    });

    try {
        const result = await Promise.any(sources.map(fn => fn()));
        console.log(`[MSTR 성공] 출처: ${result.src}, 가격: $${result.price}`);
        return result.price;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------
// [장기 차트] 1년(365일) 월/년 단위 바이낸스 선물 과거 데이터 수집
// ---------------------------------------------------------
async function fetchFuturesHistory() {
    try {
        const [resFR, resOI] = await Promise.all([
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1000", 5000),
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/openInterestHist?symbol=BTCUSDT&period=1d&limit=365", 5000)
        ]);

        if (!resFR || !resFR.ok) return null;

        const frList = await resFR.json();
        let oiList = [];
        if (resOI && resOI.ok) oiList = await resOI.json();

        // 8시간 단위 펀딩비를 날짜별(YYYY-MM-DD) 일일 합산 펀딩비로 변환
        const dailyFrMap = {};
        frList.forEach(item => {
            const dateObj = new Date(item.fundingTime);
            const dateKey = `${dateObj.getFullYear()}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-${dateObj.getDate().toString().padStart(2, '0')}`;
            if (!dailyFrMap[dateKey]) dailyFrMap[dateKey] = 0;
            dailyFrMap[dateKey] += parseFloat(item.fundingRate) * 100;
        });

        const labels = [], frData = [], oiData = [];

        if (oiList.length > 0) {
            oiList.forEach(oiItem => {
                const dateObj = new Date(oiItem.timestamp);
                const dateKey = `${dateObj.getFullYear()}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-${dateObj.getDate().toString().padStart(2, '0')}`;
                const displayDate = `${dateObj.getFullYear().toString().slice(2)}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
                
                labels.push(displayDate);
                frData.push(dailyFrMap[dateKey] !== undefined ? dailyFrMap[dateKey] : 0.03);
                oiData.push(parseFloat(oiItem.sumOpenInterest) / 1000);
            });
        }

        return { labels, frData, oiData };
    } catch (e) {
        return null;
    }
}

// 실시간 선물 지표 수집
async function fetchFuturesData() {
    let fundingRate = null, openInterest = null, rawFr = 0, rawOi = 0;
    try {
        const [resFR, resOI] = await Promise.all([
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", 2500),
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", 2500)
        ]);

        if (resFR && resFR.ok) {
            const data = await resFR.json();
            if (data.lastFundingRate !== undefined) {
                rawFr = parseFloat(data.lastFundingRate) * 100;
                fundingRate = rawFr.toFixed(4) + "%";
            }
        }
        if (resOI && resOI.ok) {
            const data = await resOI.json();
            if (data.openInterest !== undefined) {
                rawOi = (parseFloat(data.openInterest) / 1000);
                openInterest = rawOi.toFixed(1) + "k ₿";
            }
        }
    } catch (e) {}

    return { fundingRate, openInterest, rawFr, rawOi };
}

function evaluateFuturesRisk(fundingRateStr) {
    if (!fundingRateStr) return { stage: "🟡 -단계", text: "데이터 수집 대기 중", color: "#aaa" };
    const fr = parseFloat(String(fundingRateStr).replace("%", ""));
    if (isNaN(fr)) return { stage: "🟡 -단계", text: "데이터 분석 불가", color: "#aaa" };

    if (fr < -0.01) return { stage: "🟢 1단계 (숏 과열)", text: "숏 쏠림 심화 (스퀴즈 반등 주의)", color: "#2ea043" };
    else if (fr <= 0.015) return { stage: "🟢 2단계 (건전/중립)", text: "적정 레버리지 (건전한 시장)", color: "#3fb950" };
    else if (fr <= 0.030) return { stage: "🟡 3단계 (열기 발생)", text: "롱 포지션 누적 (과열 초기)", color: "#d29922" };
    else if (fr <= 0.050) return { stage: "🟠 4단계 (과열 경고)", text: "롱 쏠림 심화 (조정 및 청산 위험)", color: "#db6d28" };
    else return { stage: "🔴 5단계 (극심한 위험)", text: "극단적 탐욕 (대규모 청산빔 주의)", color: "#f85149" };
}

function updateCardValue(possibleIds, labelText, valueText) {
    if (!valueText) return;
    for (const id of possibleIds) {
        const el = document.getElementById(id);
        if (el) { el.textContent = valueText; return; }
    }
}

async function initOrUpdateFuturesChart(liveFr, liveOi) {
    const canvas = document.getElementById('futuresChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // 일일 누적 기준 위험 선 (0.03% * 3회 = 0.09%)
    const dailyRiskThreshold = 0.09;

    if (!isChartInitialized) {
        const history = await fetchFuturesHistory();
        let labels = [], frData = [], oiData = [];

        if (history && history.labels.length > 0) {
            labels = history.labels; frData = history.frData; oiData = history.oiData;
        } else {
            const now = new Date();
            labels = [`${now.getFullYear().toString().slice(2)}/${now.getMonth()+1}/${now.getDate()}`];
            frData = [liveFr * 3]; oiData = [liveOi];
        }

        const thresholdArray = new Array(labels.length).fill(dailyRiskThreshold);

        futuresChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: '일일 펀딩비 합계 (%)', data: frData, borderColor: '#ff9f0a', backgroundColor: 'rgba(255, 159, 10, 0.15)', yAxisID: 'yFR', borderWidth: 1.5, tension: 0.1, pointRadius: 0 },
                    { label: '미결제약정 (k ₿)', data: oiData, borderColor: '#58a6ff', backgroundColor: 'rgba(88, 166, 255, 0.05)', yAxisID: 'yOI', borderWidth: 1.5, tension: 0.1, pointRadius: 0 },
                    { label: '일일 과열 기준선 (0.09%)', data: thresholdArray, borderColor: '#f85149', borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0, fill: false, yAxisID: 'yFR' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: '#2a2a2a' }, ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 12 } },
                    yFR: { type: 'linear', position: 'left', grid: { color: '#2a2a2a' }, ticks: { color: '#ff9f0a', font: { size: 10 } } },
                    yOI: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#58a6ff', font: { size: 10 } } }
                },
                plugins: { legend: { labels: { color: '#fff', font: { size: 11 } } } }
            }
        });
        isChartInitialized = true;
    } else if (futuresChartInstance) {
        const lastIdx = futuresChartInstance.data.datasets[0].data.length - 1;
        if (lastIdx >= 0) {
            futuresChartInstance.data.datasets[1].data[lastIdx] = liveOi;
            futuresChartInstance.update('none');
        }
    }
}

function updateScenarioTable(netBpsUsd, currentBtc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !netBpsUsd || !currentBtc) return;

    const fixedBtcTargets = [30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 120000, 150000, 180000, 200000, 250000, 300000, 400000, 500000];
    const mnavMultipliers = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

    let html = "";
    fixedBtcTargets.forEach(targetBtc => {
        const targetNetBps = netBpsUsd * (targetBtc / currentBtc);
        const isCurrentZone = Math.abs(targetBtc - currentBtc) < 5000;
        const rowStyle = isCurrentZone ? 'style="background-color: #26382b; font-weight: bold;"' : '';

        html += `<tr ${rowStyle}><td>$${(targetBtc / 1000).toFixed(0)}k</td>`;
        mnavMultipliers.forEach(nav => {
            html += `<td>$${(targetNetBps * nav).toFixed(0)}</td>`;
        });
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

    const netBpsUsd = (btcHoldings * targetBtc + (currentData.usdAssetsUsdB * 1e9) - (currentData.debtUsdB * 1e9) - (currentData.preferredUsdB * 1e9)) / (fdso * 1e6);
    const predictedMstr = netBpsUsd * targetMnav;

    setText("predictedMstrPrice", `$${predictedMstr.toFixed(2)}`);
    setText("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
};

function calculateDashboard() {
    let currentBtcPrice = getNum("btcPrice");
    let currentMstrPrice = getNum("mstrPrice");
    
    if (!currentBtcPrice) currentBtcPrice = parseFloat(localStorage.getItem("savedBtcPrice")) || 95000;
    if (!currentMstrPrice) currentMstrPrice = parseFloat(localStorage.getItem("savedMstrPrice")) || 130;

    let btcHoldings = getNum("btcHoldings") || currentData.btcHoldings;
    let fdso = getNum("fullyDilutedShares") || currentData.fdso;

    const fdsoShares = fdso * 1_000_000;
    const netReserveUsd = (btcHoldings * currentBtcPrice) + (currentData.usdAssetsUsdB * 1e9) - (currentData.debtUsdB * 1e9) - (currentData.preferredUsdB * 1e9);
    
    const grossBpsSats = (btcHoldings / fdsoShares) * 100_000_000;
    const netBpsUsd = netReserveUsd / fdsoShares;
    const netBpsSats = ((netReserveUsd / currentBtcPrice) / fdsoShares) * 100_000_000;

    setText("grossBpsSats", Math.round(grossBpsSats).toLocaleString());
    setText("netBpsSats", Math.round(netBpsSats).toLocaleString());
    setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);

    if (currentMstrPrice > 0 && netBpsUsd > 0) {
        const mnav = currentMstrPrice / netBpsUsd;
        const premiumPct = (mnav - 1) * 100;
        setText("mnavMultiple", `${mnav.toFixed(2)}×`);
        setText("premium", `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`);
        setText("signal", mnav < 1.0 ? "🟢 극심한 저평가 (NAV 대비 할인)" : (mnav > 2.5 ? "🔴 과열 주의 (높은 프리미엄)" : "🟡 중립 (적정 주가 구간)"));
    }

    updateScenarioTable(netBpsUsd, currentBtcPrice);
    window.targetPrice();
}

async function updateDashboard() {
    try {
        const [fetchedBtc, fetchedMstr, futures] = await Promise.all([
            fetchLiveBtcPriceFast(),
            fetchLiveMstrPriceFast(),
            fetchFuturesData()
        ]);

        if (fetchedBtc && fetchedBtc > 0) {
            setVal("btcPrice", fetchedBtc.toFixed(2));
            localStorage.setItem("savedBtcPrice", fetchedBtc.toFixed(2));
        }
        if (fetchedMstr && fetchedMstr > 0) {
            setVal("mstrPrice", fetchedMstr.toFixed(2));
            localStorage.setItem("savedMstrPrice", fetchedMstr.toFixed(2));
        }

        if (futures.fundingRate) {
            updateCardValue(["fundingRate"], "Funding Rate", futures.fundingRate);
            const risk = evaluateFuturesRisk(futures.fundingRate);
            setText("futuresRiskStage", risk.stage);
            setText("futuresRiskText", risk.text);
            const riskStageEl = document.getElementById("futuresRiskStage");
            if (riskStageEl) riskStageEl.style.color = risk.color;
            await initOrUpdateFuturesChart(futures.rawFr, futures.rawOi);
        }
        if (futures.openInterest) {
            updateCardValue(["btcOi"], "BTC OI", futures.openInterest);
        }

        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        setText("dataStatus", `실시간 초고속 연동 완료 (${timeStr})`);
    } catch (e) {
        setText("dataStatus", "시세 연동 완료");
    }

    calculateDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
    const savedBtcHoldings = localStorage.getItem("savedBtcHoldings");
    const savedAdso = localStorage.getItem("savedAdso");
    const savedFdso = localStorage.getItem("savedFdso");
    const savedTargetBtc = localStorage.getItem("savedTargetBtc");
    const savedTargetMnav = localStorage.getItem("savedTargetMnav");
    const savedBtcPrice = localStorage.getItem("savedBtcPrice");
    const savedMstrPrice = localStorage.getItem("savedMstrPrice");

    if (savedBtcHoldings) currentData.btcHoldings = parseFloat(savedBtcHoldings);
    if (savedAdso) currentData.adso = parseFloat(savedAdso);
    if (savedFdso) currentData.fdso = parseFloat(savedFdso);
    
    setVal("btcHoldings", currentData.btcHoldings);
    setVal("assumedShares", currentData.adso.toFixed(3));
    setVal("fullyDilutedShares", currentData.fdso.toFixed(3));
    
    if (savedTargetBtc) setVal("targetBtcPrice", savedTargetBtc);
    if (savedTargetMnav) setVal("targetMnav", savedTargetMnav);
    if (savedBtcPrice) setVal("btcPrice", savedBtcPrice);
    if (savedMstrPrice) setVal("mstrPrice", savedMstrPrice);

    updateDashboard();

    const inputIds = ["btcPrice", "mstrPrice", "btcHoldings", "assumedShares", "fullyDilutedShares", "targetBtcPrice", "targetMnav"];
    inputIds.forEach(id => {
        document.getElementById(id)?.addEventListener("input", () => {
            const val = getNum(id);
            if (val > 0) {
                if (id === "btcHoldings") {
                    currentData.btcHoldings = val;
                    localStorage.setItem("savedBtcHoldings", val);
                } else if (id === "assumedShares") {
                    currentData.adso = val;
                    localStorage.setItem("savedAdso", val);
                } else if (id === "fullyDilutedShares") {
                    currentData.fdso = val;
                    localStorage.setItem("savedFdso", val);
                } else if (id === "btcPrice") {
                    localStorage.setItem("savedBtcPrice", val);
                } else if (id === "mstrPrice") {
                    localStorage.setItem("savedMstrPrice", val);
                }
            }
            calculateDashboard();
        });
    });

    setInterval(updateDashboard, 5000);

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) updateDashboard();
    });
});
