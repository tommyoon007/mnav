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
    const val = el.value !== undefined && el.value !== "" ? el.value : el.textContent;
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
                if (price && price > 0) return parseFloat(price);
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
                    if (price && price > 0) return parseFloat(price);
                }
            }
        } catch (e) {}
    }
    return null;
}

async function fetchFuturesHistory(tf = '1M') {
    let period = '4h', oiLimit = 180, frLimit = 90;

    if (tf === '1D') { period = '15m'; oiLimit = 96; frLimit = 24; } 
    else if (tf === '3M') { period = '1d'; oiLimit = 90; frLimit = 270; } 
    else if (tf === '6M') { period = '1d'; oiLimit = 180; frLimit = 540; } 
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
        if (resFR && resFR.ok) {
            const parsedFr = await resFR.json();
            if (Array.isArray(parsedFr)) frList = parsedFr;
        }
        
        let lsList = [];
        if (resLS && resLS.ok) {
            const parsedLs = await resLS.json();
            if (Array.isArray(parsedLs)) lsList = parsedLs;
        }

        const labels = [], frData = [], oiData = [], lsData = [];

        oiList.forEach((oiItem) => {
            const dateObj = new Date(oiItem.timestamp);
            let dateStr = "";
            if (tf === '1D') {
                dateStr = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
            } else if (tf === '3M' || tf === '6M' || tf === '1Y' || tf === 'ALL') {
                dateStr = `${String(dateObj.getFullYear()).slice(2)}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
            } else {
                dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()} ${dateObj.getHours().toString().padStart(2, '0')}:00`;
            }
            labels.push(dateStr);
            oiData.push(parseFloat(oiItem.sumOpenInterest) / 1000); 

            if (frList.length > 0) {
                let closestFr = frList.reduce((prev, curr) => 
                    Math.abs(curr.fundingTime - oiItem.timestamp) < Math.abs(prev.fundingTime - oiItem.timestamp) ? curr : prev, frList[0]);
                frData.push(parseFloat(closestFr.fundingRate) * 100);
            } else {
                frData.push(0);
            }

            const matchedLs = lsList.find(l => Math.abs(l.timestamp - oiItem.timestamp) < 86400000);
            if (matchedLs && matchedLs.longShortRatio) {
                lsData.push(parseFloat(matchedLs.longShortRatio));
            } else {
                lsData.push(lsData.length > 0 ? lsData[lsData.length - 1] : 1.0);
            }
        });

        return { labels, frData, oiData, lsData };
    } catch (e) {
        return null;
    }
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
            const data = await resFR.json();
            if (data && data.lastFundingRate !== undefined) {
                rawFr = parseFloat(data.lastFundingRate) * 100;
                fundingRate = rawFr.toFixed(4) + "%";
            }
        }
        if (resOI && resOI.ok) {
            const data = await resOI.json();
            if (data && data.openInterest !== undefined) {
                rawOi = (parseFloat(data.openInterest) / 1000);
                openInterest = rawOi.toFixed(1) + "k ₿";
            }
        }
        if (resLS && resLS.ok) {
            const data = await resLS.json();
            if (Array.isArray(data) && data.length > 0 && data[0].longShortRatio !== undefined) {
                rawLs = parseFloat(data[0].longShortRatio);
                lsRatio = rawLs.toFixed(4);
            }
        }
    } catch (e) {}
    return { fundingRate, openInterest, lsRatio, rawFr, rawOi, rawLs };
}

function evaluateFuturesRisk(rawFr, rawLs) {
    if (rawFr === null || rawFr === undefined || isNaN(rawFr)) return { stage: "🟡 -단계", text: "데이터 수집 대기 중", color: "#aaa" };
    
    const fr = rawFr;
    const ls = isNaN(rawLs) ? 1.0 : rawLs;
    const lsText = ` (L/S: ${ls.toFixed(2)})`;

    if (fr >= 0.05) {
        if (ls >= 2.0) return { stage: "🔴 5단계 (극심한 위험)", text: "대규모 청산 임박! 개미 롱 극단적 쏠림" + lsText, color: "#f85149" };
        return { stage: "🟠 4단계 (과열 경고)", text: "과도한 탐욕 구간 (고래 주도 롱)" + lsText, color: "#db6d28" };
    } else if (fr >= 0.03) {
        if (ls >= 1.5) return { stage: "🟠 4단계 (과열 경고)", text: "롱 쏠림 심화 (조정 및 청산 위험)" + lsText, color: "#db6d28" };
        return { stage: "🟡 3단계 (열기 발생)", text: "롱 포지션 누적 (고래 주도 롱)" + lsText, color: "#d29922" };
    } else if (fr >= 0.015) {
        if (ls >= 1.5) return { stage: "🟡 3단계 (열기 발생)", text: "롱 포지션 누적 (과열 초기)" + lsText, color: "#d29922" };
        return { stage: "🟢 2단계 (건전/중립)", text: "적정 레버리지 (건전한 시장)" + lsText, color: "#3fb950" };
    } else if (fr <= -0.01) {
        if (ls <= 0.8) return { stage: "🟢 1단계 (숏 과열)", text: "숏 쏠림 심화 (스퀴즈 반등 주의)" + lsText, color: "#2ea043" };
        return { stage: "🟢 2단계 (건전/중립)", text: "적정 레버리지 (건전한 시장)" + lsText, color: "#3fb950" };
    } else {
        return { stage: "🟢 2단계 (건전/중립)", text: "적정 레버리지 (건전한 시장)" + lsText, color: "#3fb950" };
    }
}

function updateCardValue(possibleIds, labelText, valueText) {
    if (!valueText) return;
    for (const id of possibleIds) {
        const el = document.getElementById(id);
        if (el) { el.textContent = valueText; return; }
    }
}

async function initOrUpdateFuturesChart(liveFr, liveOi, liveLs, forceReload = false) {
    const canvas = document.getElementById('futuresChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const riskThreshold = 0.030;

    if (!futuresChartInstance || forceReload) {
        if (futuresChartInstance) {
            futuresChartInstance.destroy();
            futuresChartInstance = null;
        }

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
        const pointRadiusVal = labels.length > 150 ? 0 : 1; 

        futuresChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: '펀딩비 (%)', data: frData, borderColor: '#ff9f0a', backgroundColor: 'rgba(255, 159, 10, 0.15)', yAxisID: 'yFR', borderWidth: 2, tension: 0.1, pointRadius: pointRadiusVal },
                    { label: '미결제약정 (k ₿)', data: oiData, borderColor: '#58a6ff', backgroundColor: 'rgba(88, 166, 255, 0.05)', yAxisID: 'yOI', borderWidth: 1.5, tension: 0.1, pointRadius: pointRadiusVal },
                    { label: '롱/숏 비율', data: lsData, borderColor: '#a371f7', backgroundColor: 'rgba(163, 113, 247, 0.05)', yAxisID: 'yLS', borderWidth: 1.5, tension: 0.1, pointRadius: pointRadiusVal },
                    { label: '위험 기준선 (0.03%)', data: thresholdArray, borderColor: '#f85149', borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0, fill: false, yAxisID: 'yFR' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: '#2a2a2a' }, ticks: { color: '#8b949e', font: { size: 9 }, maxTicksLimit: 10 } },
                    yFR: { type: 'linear', position: 'left', grid: { color: '#2a2a2a' }, ticks: { color: '#ff9f0a', font: { size: 9 } } },
                    yOI: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#58a6ff', font: { size: 9 } } },
                    yLS: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#a371f7', font: { size: 9 } } }
                },
                plugins: { legend: { labels: { color: '#fff', font: { size: 10 }, boxWidth: 12 } } }
            }
        });
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
    
    // Division by zero 방어
    if (fdso <= 0) return;

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

    // 공백 입력 등 비정상 상황 시 계산 방어 (Infinity/NaN 방지)
    if (fdso <= 0 || currentBtcPrice <= 0) return;

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
        const futures = await fetchFuturesData();

        if (autoSyncEnabled) {
            const [fetchedBtc, fetchedMstr] = await Promise.all([
                fetchLiveBtcPrice(),
                fetchLiveMstrPrice()
            ]);

            if (fetchedBtc && fetchedBtc > 0) {
                setVal("btcPrice", fetchedBtc.toFixed(2));
                localStorage.setItem("savedBtcPrice", fetchedBtc.toFixed(2));
            }
            if (fetchedMstr && fetchedMstr > 0) {
                setVal("mstrPrice", fetchedMstr.toFixed(2));
                localStorage.setItem("savedMstrPrice", fetchedMstr.toFixed(2));
            }
            
            const now = new Date();
            const timeStr = now.toTimeString().split(' ')[0];
            setText("dataStatus", `시세 및 데이터 연동 완료 (${timeStr})`);
        } else {
            setText("dataStatus", "자동 동기화 일시 정지 (수동 모드)");
        }

        if (futures.fundingRate !== null) {
            updateCardValue(["fundingRate"], "Funding Rate", futures.fundingRate);
            const risk = evaluateFuturesRisk(futures.rawFr, futures.rawLs);
            setText("futuresRiskStage", risk.stage);
            setText("futuresRiskText", risk.text);
            const riskStageEl = document.getElementById("futuresRiskStage");
            if (riskStageEl) riskStageEl.style.color = risk.color;
            
            if (!futuresChartInstance) {
                await initOrUpdateFuturesChart(futures.rawFr, futures.rawOi, futures.rawLs);
            }
        }
        if (futures.openInterest !== null) {
            updateCardValue(["btcOi"], "BTC OI", futures.openInterest);
        }

    } catch (e) {
        if (autoSyncEnabled) setText("dataStatus", "시세 연동 대기 중");
    }

    calculateDashboard();
}

function startAutoUpdates() {
    updateDashboard();
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() => {
        if (!document.hidden) updateDashboard();
    }, 10000);
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
        document.getElementById(id)?.addEventListener("input", () => {
            const val = getNum(id);
            if (val >= 0) { // 빈칸 방어 통과 후 로컬스토리지 저장
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

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            updateDashboard();
        }
    });
});
