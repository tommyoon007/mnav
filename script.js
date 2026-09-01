// =========================================================
// MSTR mNAV & BTC FUTURES DASHBOARD - STABLE PRODUCTION CODE
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

const DEFAULT_DATA = {
    btcHoldings: 845050,
    adso: 298.039,
    fdso: 424.479,
    usdAssetsUsdB: 6.690,
    debtUsdB: 6.754,
    preferredUsdB: 14.966,
    fallbackBtcPrice: 95000,
    fallbackMstrPrice: 130
};

let currentData = { ...DEFAULT_DATA };
let chartInstance = null;

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

// 1. 실시간 BTC 가격 수집
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

// 2. 실시간 MSTR 주가 수집
async function fetchLiveMstrPrice() {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&range=1d&includePrePost=true&ts=${Date.now()}`;
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(yahooUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`
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

    try {
        const res = await fetchWithTimeout("https://scanner.tradingview.com/america/scan", 3000, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({
                symbols: { tickers: ["NASDAQ:MSTR"] },
                columns: ["extended_hours_price", "close"]
            })
        });
        if (res && res.ok) {
            const data = await res.json();
            const row = data?.data?.[0]?.d;
            if (row) {
                const extPrice = row[0];
                const regPrice = row[1];
                const price = (extPrice && extPrice > 0) ? extPrice : regPrice;
                if (price && price > 0) return parseFloat(price);
            }
        }
    } catch (e) {}

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

    return null;
}

// 3. 선물 지표 수집
async function fetchFuturesData() {
    let fundingRate = null;
    let openInterest = null;

    try {
        const [resFR, resOI] = await Promise.all([
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", 3000),
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", 3000)
        ]);

        if (resFR && resFR.ok) {
            const data = await resFR.json();
            if (data.lastFundingRate !== undefined) {
                fundingRate = (parseFloat(data.lastFundingRate) * 100).toFixed(4) + "%";
            }
        }
        if (resOI && resOI.ok) {
            const data = await resOI.json();
            if (data.openInterest !== undefined) {
                const oiBtc = parseFloat(data.openInterest);
                openInterest = (oiBtc / 1000).toFixed(1) + "k ₿";
            }
        }
    } catch (e) {}

    if (!fundingRate || !openInterest) {
        try {
            const res = await fetchWithTimeout("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT", 3000);
            if (res && res.ok) {
                const json = await res.json();
                const item = json?.result?.list?.[0];
                if (item) {
                    if (!fundingRate && item.fundingRate) {
                        fundingRate = (parseFloat(item.fundingRate) * 100).toFixed(4) + "%";
                    }
                    if (!openInterest && item.openInterest) {
                        openInterest = (parseFloat(item.openInterest) / 1000).toFixed(1) + "k ₿";
                    }
                }
            }
        } catch (e) {}
    }

    return { fundingRate, openInterest };
}

// 4. 레버리지 위험도 계산
function evaluateFuturesRisk(fundingRateStr) {
    if (!fundingRateStr) return { stage: "🟡 -단계", text: "데이터 수집 대기 중", color: "#aaa" };

    const fr = parseFloat(String(fundingRateStr).replace("%", ""));
    if (isNaN(fr)) return { stage: "🟡 -단계", text: "데이터 분석 불가", color: "#aaa" };

    if (fr < -0.01) {
        return { stage: "🟢 1단계 (숏 과열)", text: "숏 쏠림 심화 (스퀴즈 반등 주의)", color: "#2ea043" };
    } else if (fr <= 0.015) {
        return { stage: "🟢 2단계 (건전/중립)", text: "적정 레버리지 (건전한 시장)", color: "#3fb950" };
    } else if (fr <= 0.030) {
        return { stage: "🟡 3단계 (열기 발생)", text: "롱 포지션 누적 (과열 초기)", color: "#d29922" };
    } else if (fr <= 0.050) {
        return { stage: "🟠 4단계 (과열 경고)", text: "롱 쏠림 심화 (조정 및 청산 위험)", color: "#db6d28" };
    } else {
        return { stage: "🔴 5단계 (극심한 위험)", text: "극단적 탐욕 (대규모 청산빔 주의)", color: "#f85149" };
    }
}

function updateCardValue(possibleIds, labelText, valueText) {
    if (!valueText) return;
    for (const id of possibleIds) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = valueText;
            return;
        }
    }
}

// 5. 시나리오 표 생성 ($30,000 ~ $500,000 확장)
function updateScenarioTable(netBpsUsd, currentBtc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !netBpsUsd || !currentBtc) return;

    const fixedBtcTargets = [
        30000, 40000, 50000, 60000, 70000, 80000, 90000, 
        100000, 120000, 150000, 180000, 200000, 250000, 300000, 400000, 500000
    ];
    const mnavMultipliers = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

    let html = "";
    fixedBtcTargets.forEach(targetBtc => {
        const ratio = targetBtc / currentBtc;
        const targetNetBps = netBpsUsd * ratio;
        
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

// 6. 차트 업데이트 로직 (독립 실행하여 입력 버그 방지)
function updateChartData(btcPrice, mstrPrice) {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const now = new Date();
    const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    if (!chartInstance) {
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [timeLabel],
                datasets: [
                    {
                        label: 'BTC 가격 ($)',
                        data: [btcPrice],
                        borderColor: '#ff9f0a',
                        backgroundColor: 'rgba(255, 159, 10, 0.1)',
                        yAxisID: 'yBtc',
                        borderWidth: 2,
                        tension: 0.1,
                        pointRadius: 2
                    },
                    {
                        label: 'MSTR 주가 ($)',
                        data: [mstrPrice],
                        borderColor: '#3fb950',
                        backgroundColor: 'rgba(63, 185, 80, 0.1)',
                        yAxisID: 'yMstr',
                        borderWidth: 2,
                        tension: 0.1,
                        pointRadius: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: '#2a2a2a' },
                        ticks: { color: '#8b949e', font: { size: 10 } },
                        title: { display: true, text: '수집 시각 (시간:분:초)', color: '#aaa', font: { size: 11 } }
                    },
                    yBtc: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: '#2a2a2a' },
                        ticks: { color: '#ff9f0a', font: { size: 10 } },
                        title: { display: true, text: 'BTC ($)', color: '#ff9f0a', font: { size: 11 } }
                    },
                    yMstr: {
                        type: 'linear',
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#3fb950', font: { size: 10 } },
                        title: { display: true, text: 'MSTR ($)', color: '#3fb950', font: { size: 11 } }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#fff', font: { size: 11 } } }
                }
            }
        });
    } else {
        chartInstance.data.labels.push(timeLabel);
        chartInstance.data.datasets[0].data.push(btcPrice);
        chartInstance.data.datasets[1].data.push(mstrPrice);

        if (chartInstance.data.labels.length > 25) {
            chartInstance.data.labels.shift();
            chartInstance.data.datasets[0].data.shift();
            chartInstance.data.datasets[1].data.shift();
        }
        chartInstance.update();
    }
}

// 7. MSTR 목표가 예측
window.targetPrice = function() {
    const targetBtc = getNum("targetBtcPrice");
    const targetMnav = getNum("targetMnav");

    if (targetBtc > 0) localStorage.setItem("savedTargetBtc", targetBtc);
    if (targetMnav > 0) localStorage.setItem("savedTargetMnav", targetMnav);

    if (!targetBtc || !targetMnav) return;

    const fdso = getNum("fullyDilutedShares") || currentData.fdso;
    const btcHoldings = getNum("btcHoldings") || currentData.btcHoldings;

    const fdsoShares = fdso * 1_000_000;
    const usdAssets = currentData.usdAssetsUsdB * 1_000_000_000;
    const debt = currentData.debtUsdB * 1_000_000_000;
    const preferred = currentData.preferredUsdB * 1_000_000_000;

    const netBpsUsd = (btcHoldings * targetBtc + usdAssets - debt - preferred) / fdsoShares;
    const predictedMstr = netBpsUsd * targetMnav;

    setText("predictedMstrPrice", `$${predictedMstr.toFixed(2)}`);
    setText("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
};

// 8. 대시보드 계산 (사용자 수동 입력 필드 직접 참조하도록 수정)
function calculateDashboard() {
    let currentBtcPrice = getNum("btcPrice") || DEFAULT_DATA.fallbackBtcPrice;
    let currentMstrPrice = getNum("mstrPrice") || DEFAULT_DATA.fallbackMstrPrice;
    let btcHoldings = getNum("btcHoldings") || currentData.btcHoldings;
    let fdso = getNum("fullyDilutedShares") || currentData.fdso;

    const fdsoShares = fdso * 1_000_000;
    const usdAssets = currentData.usdAssetsUsdB * 1_000_000_000;
    const debt = currentData.debtUsdB * 1_000_000_000;
    const preferred = currentData.preferredUsdB * 1_000_000_000;

    const btcValueUsd = btcHoldings * currentBtcPrice;
    const grossBpsSats = (btcHoldings / fdsoShares) * 100_000_000;

    const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
    const netBpsUsd = netReserveUsd / fdsoShares;
    const netBtcHoldings = netReserveUsd / currentBtcPrice;
    const netBpsSats = (netBtcHoldings / fdsoShares) * 100_000_000;

    setText("grossBpsSats", Math.round(grossBpsSats).toLocaleString());
    setText("netBpsSats", Math.round(netBpsSats).toLocaleString());
    setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);

    if (currentMstrPrice > 0 && netBpsUsd > 0) {
        const mnav = currentMstrPrice / netBpsUsd;
        const premiumPct = (mnav - 1) * 100;

        setText("mnavMultiple", `${mnav.toFixed(2)}×`);
        setText("premium", `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`);

        let signalText = "🟡 중립 (적정 주가 구간)";
        if (mnav < 1.0) signalText = "🟢 극심한 저평가 (NAV 대비 할인)";
        else if (mnav > 2.5) signalText = "🔴 과열 주의 (높은 프리미엄)";
        setText("signal", signalText);
    }

    updateScenarioTable(netBpsUsd, currentBtcPrice);
    window.targetPrice();
}

// 9. 메인 수집 로직
async function updateDashboard() {
    try {
        const res = await fetchWithTimeout("./data.json?cache=" + Date.now(), 2000);
        if (res && res.ok) {
            const json = await res.json();
            currentData.btcHoldings = parseFloat(json.btcHoldings) || currentData.btcHoldings;
            currentData.adso = parseFloat(json.adso) || currentData.adso;
            currentData.fdso = parseFloat(json.fdso) || currentData.fdso;
            currentData.usdAssetsUsdB = parseFloat(json.usdAssetsUsdB) || currentData.usdAssetsUsdB;
            currentData.debtUsdB = parseFloat(json.debtUsdB) || currentData.debtUsdB;
            currentData.preferredUsdB = parseFloat(json.preferredUsdB) || currentData.preferredUsdB;
        }
    } catch (e) {}

    setVal("btcHoldings", currentData.btcHoldings);
    setVal("assumedShares", currentData.adso.toFixed(3));
    setVal("fullyDilutedShares", currentData.fdso.toFixed(3));

    try {
        const [fetchedBtc, fetchedMstr, futures] = await Promise.all([
            fetchLiveBtcPrice(),
            fetchLiveMstrPrice(),
            fetchFuturesData()
        ]);

        if (fetchedBtc && fetchedBtc > 0) setVal("btcPrice", fetchedBtc.toFixed(2));
        if (fetchedMstr && fetchedMstr > 0) setVal("mstrPrice", fetchedMstr.toFixed(2));

        if (futures.fundingRate) {
            updateCardValue(["fundingRate"], "Funding Rate", futures.fundingRate);
            const risk = evaluateFuturesRisk(futures.fundingRate);
            setText("futuresRiskStage", risk.stage);
            setText("futuresRiskText", risk.text);
            const riskStageEl = document.getElementById("futuresRiskStage");
            if (riskStageEl) riskStageEl.style.color = risk.color;
        }
        if (futures.openInterest) {
            updateCardValue(["btcOi"], "BTC OI", futures.openInterest);
        }

        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        setText("dataStatus", `실시간 데이터 연동 완료 (${timeStr})`);

        // 차트는 실시간 수집 성공 시에만 갱신
        const currentBtc = getNum("btcPrice");
        const currentMstr = getNum("mstrPrice");
        if (currentBtc > 0 && currentMstr > 0) {
            updateChartData(currentBtc, currentMstr);
        }
    } catch (e) {
        setText("dataStatus", "실시간 시세 연동 대기 중");
    }

    calculateDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
    const savedBtc = localStorage.getItem("savedTargetBtc");
    const savedMnav = localStorage.getItem("savedTargetMnav");
    if (savedBtc) setVal("targetBtcPrice", savedBtc);
    if (savedMnav) setVal("targetMnav", savedMnav);

    updateDashboard();

    // 모든 입력창 변경에 즉각 반응하도록 이벤트 바인딩 처리
    const inputIds = ["btcPrice", "mstrPrice", "btcHoldings", "assumedShares", "fullyDilutedShares", "targetBtcPrice", "targetMnav"];
    inputIds.forEach(id => {
        document.getElementById(id)?.addEventListener("input", calculateDashboard);
    });

    setInterval(updateDashboard, 10000);

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) updateDashboard();
    });
});
