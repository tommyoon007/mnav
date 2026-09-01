// =========================================================
// MSTR mNAV & BTC DASHBOARD - PERFECT ZERO-PREVENTION CODE
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
    fallbackBtcPrice: 77990,
    fallbackMstrPrice: 132.94
};

let currentData = { ...DEFAULT_DATA };

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (document.activeElement !== el) {
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

async function fetchWithTimeout(url, timeoutMs = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        return null;
    }
}

// 1. BTC 실시간 가격 (Binance -> Coinbase)
async function fetchLiveBtcPrice() {
    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", 2500);
        if (res?.ok) {
            const p = parseFloat((await res.json())?.price);
            if (p > 0) return p;
        }
    } catch (e) {}

    try {
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD", 2500);
        if (res?.ok) {
            const p = parseFloat((await res.json())?.data?.amount);
            if (p > 0) return p;
        }
    } catch (e) {}

    return null;
}

// 2. MSTR 실시간 주가 (Finnhub -> 다중 우회 프록시)
async function fetchLiveMstrPrice() {
    // Finnhub REST (c: 실시간/종가, pc: 전일 종가)
    if (FINNHUB_KEY) {
        try {
            const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`, 2500);
            if (res?.ok) {
                const data = await res.json();
                const price = (data?.c > 0) ? data.c : data?.pc;
                if (price > 0) return parseFloat(price);
            }
        } catch (e) {}
    }

    // Yahoo Finance 다중 프록시 시도
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&range=1d&ts=${Date.now()}`;
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(yahooUrl)}`
    ];

    for (const proxy of proxies) {
        try {
            const res = await fetchWithTimeout(proxy, 2500);
            if (res?.ok) {
                const data = await res.json();
                const meta = data?.chart?.result?.[0]?.meta;
                const price = meta?.preMarketPrice || meta?.postMarketPrice || meta?.regularMarketPrice || meta?.chartPreviousClose;
                if (price > 0) return parseFloat(price);
            }
        } catch (e) {}
    }

    return null;
}

// 3. 선물 지표 수집
async function fetchFuturesData() {
    let fundingRate = null, openInterest = null;
    try {
        const res = await fetchWithTimeout("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT", 2500);
        if (res?.ok) {
            const item = (await res.json())?.result?.list?.[0];
            if (item) {
                if (item.fundingRate) fundingRate = (parseFloat(item.fundingRate) * 100).toFixed(4) + "%";
                if (item.openInterest) openInterest = (parseFloat(item.openInterest) / 1000).toFixed(1) + "k ₿";
            }
        }
    } catch (e) {}
    return { fundingRate, openInterest };
}

// --- 코어 계산 및 예외 방어 ---
function calculateDashboard(data = currentData) {
    let currentBtcPrice = getNum("btcPrice");
    let currentMstrPrice = getNum("mstrPrice");

    if (currentBtcPrice <= 0) {
        currentBtcPrice = DEFAULT_DATA.fallbackBtcPrice;
        setVal("btcPrice", currentBtcPrice.toFixed(2));
    }

    // MSTR 주가가 0이거나 가져오지 못했을 때 최근 주가($132.94)로 자동 복구
    if (currentMstrPrice <= 0) {
        currentMstrPrice = DEFAULT_DATA.fallbackMstrPrice;
        setVal("mstrPrice", currentMstrPrice.toFixed(2));
    }

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
}

async function updateDashboard() {
    const [fetchedBtc, fetchedMstr, futures] = await Promise.all([
        fetchLiveBtcPrice().catch(() => null),
        fetchLiveMstrPrice().catch(() => null),
        fetchFuturesData().catch(() => ({}))
    ]);

    if (fetchedBtc > 0) setVal("btcPrice", fetchedBtc.toFixed(2));
    
    if (fetchedMstr > 0) {
        setVal("mstrPrice", fetchedMstr.toFixed(2));
    } else if (getNum("mstrPrice") <= 0) {
        // 실시간 연동 실패 시 0으로 남지 않도록 기본 방어 주가 적용
        setVal("mstrPrice", DEFAULT_DATA.fallbackMstrPrice.toFixed(2));
    }

    if (futures.fundingRate) {
        const frEl = document.getElementById("fundingRate") || document.getElementById("frValue");
        if (frEl) frEl.textContent = futures.fundingRate;
    }

    const now = new Date();
    setText("dataStatus", `하이브리드 실시간 연동 중 (${now.toTimeString().split(' ')[0]})`);

    calculateDashboard(currentData);
}

function initApp() {
    updateDashboard();
    setInterval(updateDashboard, 10000);

    const inputs = ["mstrPrice", "btcPrice", "btcHoldings", "adso", "fdso"];
    inputs.forEach(id => {
        document.getElementById(id)?.addEventListener("input", () => calculateDashboard(currentData));
    });
}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}
