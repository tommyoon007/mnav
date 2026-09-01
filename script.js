// =========================================================
// MSTR mNAV & BTC FUTURES DASHBOARD - HYBRID REAL-TIME SCRIPT
// Portfolio Sync: 97 Shares @ $173.65
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

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value = val;
        } else {
            el.textContent = val;
        }
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

async function fetchLiveBtcPrice() {
    try {
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD", 3000);
        if (res?.ok) return parseFloat((await res.json())?.data?.amount || 0);
    } catch (e) {}
    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", 3000);
        if (res?.ok) return parseFloat((await res.json())?.price || 0);
    } catch (e) {}
    return null;
}

async function fetchLiveMstrPrice() {
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&range=1d&ts=${Date.now()}`;
    try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetchWithTimeout(proxyUrl, 3000);
        if (res?.ok) {
            const meta = (await res.json())?.chart?.result?.[0]?.meta;
            const price = meta?.preMarketPrice || meta?.postMarketPrice || meta?.regularMarketPrice;
            if (price > 0) return parseFloat(price);
        }
    } catch (e) {}
    
    if (FINNHUB_KEY) {
        try {
            const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`, 3000);
            if (res?.ok) {
                const data = await res.json();
                const price = (data?.c > 0) ? data.c : data?.pc;
                if (price > 0) return parseFloat(price);
            }
        } catch (e) {}
    }
    return null;
}

async function fetchFuturesData() {
    let fundingRate = null, openInterest = null;
    try {
        const [resFR, resOI] = await Promise.all([
            fetchWithTimeout("https://api.allorigins.win/raw?url=" + encodeURIComponent("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"), 3000),
            fetchWithTimeout("https://api.allorigins.win/raw?url=" + encodeURIComponent("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT"), 3000)
        ]);
        if (resFR?.ok) {
            const data = await resFR.json();
            if (data.lastFundingRate !== undefined) fundingRate = (parseFloat(data.lastFundingRate) * 100).toFixed(4) + "%";
        }
        if (resOI?.ok) {
            const data = await resOI.json();
            if (data.openInterest !== undefined) openInterest = (parseFloat(data.openInterest) / 1000).toFixed(1) + "k ₿";
        }
    } catch (e) {}

    if (!fundingRate || !openInterest) {
        try {
            const res = await fetchWithTimeout("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT", 3000);
            if (res?.ok) {
                const item = (await res.json())?.result?.list?.[0];
                if (item) {
                    if (!fundingRate && item.fundingRate) fundingRate = (parseFloat(item.fundingRate) * 100).toFixed(4) + "%";
                    if (!openInterest && item.openInterest) openInterest = (parseFloat(item.openInterest) / 1000).toFixed(1) + "k ₿";
                }
            }
        } catch (e) {}
    }
    return { fundingRate, openInterest };
}

function initBtcWebSocket() {
    const btcWs = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");
    btcWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data?.p) {
            setVal("btcPrice", parseFloat(data.p).toFixed(2));
            calculateDashboard(currentData);
        }
    };
}

function initMstrWebSocket() {
    if (!FINNHUB_KEY) return;
    const mstrWs = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
    mstrWs.onopen = () => mstrWs.send(JSON.stringify({ type: 'subscribe', symbol: 'MSTR' }));
    mstrWs.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.type === 'trade' && response.data?.[0]?.p) {
            const liveMstr = parseFloat(response.data[0].p);
            if (liveMstr > 0) {
                setVal("mstrPrice", liveMstr.toFixed(2));
                calculateDashboard(currentData);
            }
        }
    };
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
    const cards = document.querySelectorAll('.card, .result-card');
    cards.forEach(card => {
        if (card.textContent.includes(labelText)) {
            const target = card.querySelector('.result-value, .value, strong');
            if (target) target.textContent = valueText;
        }
    });
}

function updateScenarioTable(netBpsUsd, currentBtc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !netBpsUsd || !currentBtc) return;
    const fixedBtcTargets = [70000, 80000, 90000, 100000, 120000, 150000, 200000];
    const mnavMultipliers = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
    let html = "";
    fixedBtcTargets.forEach(targetBtc => {
        const targetNetBps = netBpsUsd * (targetBtc / currentBtc);
        html += `<tr><td>$${(targetBtc / 1000).toFixed(0)}k</td>`;
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

    const fdsoShares = (getNum("fullyDilutedShares") || currentData.fdso) * 1_000_000;
    const btcHoldings = getNum("btcHoldings") || currentData.btcHoldings;
    const netBpsUsd = (btcHoldings * targetBtc + currentData.usdAssetsUsdB * 1e9 - currentData.debtUsdB * 1e9 - currentData.preferredUsdB * 1e9) / fdsoShares;
    
    setText("predictedMstrPrice", `$${(netBpsUsd * targetMnav).toFixed(2)}`);
    setText("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
};

function calculateDashboard(data = currentData) {
    let currentBtcPrice = getNum("btcPrice") || DEFAULT_DATA.fallbackBtcPrice;
    let currentMstrPrice = getNum("mstrPrice") || DEFAULT_DATA.fallbackMstrPrice;

    const fdsoShares = data.fdso * 1_000_000;
    const btcValueUsd = data.btcHoldings * currentBtcPrice;
    const netReserveUsd = btcValueUsd + data.usdAssetsUsdB * 1e9 - data.debtUsdB * 1e9 - data.preferredUsdB * 1e9;
    const netBpsUsd = netReserveUsd / fdsoShares;

    setText("grossBpsSats", Math.round((data.btcHoldings / fdsoShares) * 1e8).toLocaleString());
    setText("netBpsSats", Math.round(((netReserveUsd / currentBtcPrice) / fdsoShares) * 1e8).toLocaleString());
    setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);
    setText("btcTotalValue", `$${(btcValueUsd / 1e9).toFixed(2)}B`);
    setText("seniorClaims", `$${(data.debtUsdB + data.preferredUsdB).toFixed(2)}B`);
    setText("reserveValue", `$${data.usdAssetsUsdB.toFixed(2)}B`);
    setText("netBtc", `${Math.round(netReserveUsd / currentBtcPrice).toLocaleString()} ₿`);
    setText("grossBpsUsd", `$${(btcValueUsd / fdsoShares).toFixed(2)}`);
    setText("fdsoDisplay", `${data.fdso.toFixed(3)}M`);

    if (currentMstrPrice > 0 && netBpsUsd > 0) {
        const mnav = currentMstrPrice / netBpsUsd;
        setText("mnavMultiple", `${mnav.toFixed(2)}×`);
        setText("premium", `프리미엄: ${mnav >= 1 ? '+' : ''}${((mnav - 1) * 100).toFixed(1)}%`);
        setText("signal", mnav < 1.0 ? "🟢 극심한 저평가 (NAV 대비 할인)" : mnav > 2.5 ? "🔴 과열 주의 (높은 프리미엄)" : "🟡 중립 (적정 주가 구간)");
    }
    updateScenarioTable(netBpsUsd, currentBtcPrice);
    window.targetPrice();
}

async function updateDashboard() {
    try {
        const res = await fetchWithTimeout("./data.json?cache=" + Date.now(), 2000);
        if (res?.ok) {
            const json = await res.json();
            ['btcHoldings', 'adso', 'fdso', 'usdAssetsUsdB', 'debtUsdB', 'preferredUsdB'].forEach(key => {
                if (json[key]) currentData[key] = parseFloat(json[key]);
            });
        }
    } catch (e) {}

    if (currentData.adso > currentData.fdso) {
        [currentData.adso, currentData.fdso] = [currentData.fdso, currentData.adso];
    }

    setVal("btcHoldings", currentData.btcHoldings);
    setVal("assumedShares", currentData.adso.toFixed(3));
    setVal("fullyDilutedShares", currentData.fdso.toFixed(3));

    try {
        const [fetchedBtc, fetchedMstr, futures] = await Promise.all([
            fetchLiveBtcPrice(), fetchLiveMstrPrice(), fetchFuturesData()
        ]);
        if (fetchedBtc > 0) setVal("btcPrice", fetchedBtc.toFixed(2));
        if (fetchedMstr > 0) setVal("mstrPrice", fetchedMstr.toFixed(2));
        if (futures.fundingRate) updateCardValue(["fundingRate", "fundingRateValue", "frValue"], "Funding Rate", futures.fundingRate);
        if (futures.openInterest) updateCardValue(["btcOi", "btcOiValue", "oiValue"], "BTC OI", futures.openInterest);
        setText("dataStatus", `하이브리드 실시간 연동 중 (${new Date().toTimeString().split(' ')[0]})`);
    } catch (e) {
        setText("dataStatus", "실시간 시세 연동 대기 중");
    }
    calculateDashboard(currentData);
}

async function initApp() {
    const savedBtc = localStorage.getItem("savedTargetBtc");
    const savedMnav = localStorage.getItem("savedTargetMnav");
    if (savedBtc) setVal("targetBtcPrice", savedBtc);
    if (savedMnav) setVal("targetMnav", savedMnav);

    await updateDashboard();
    initBtcWebSocket();
    initMstrWebSocket();

    ['targetBtcPrice', 'targetMnav'].forEach(id => document.getElementById(id)?.addEventListener("input", window.targetPrice));
    ['mstrPrice', 'btcPrice'].forEach(id => document.getElementById(id)?.addEventListener("input", () => calculateDashboard(currentData)));

    setInterval(updateDashboard, 10000);
    document.addEventListener("visibilitychange", () => !document.hidden && updateDashboard());
}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}
