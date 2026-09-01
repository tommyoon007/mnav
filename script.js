// =========================================================
// MSTR mNAV DASHBOARD - COMPLETE ENGINE WITH EXTENDED HOURS
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

const DEFAULT_DATA = {
    usdAssetsUsdB: 6.690,
    debtUsdB: 6.754,
    preferredUsdB: 14.966
};

function getVal(id) {
    const el = document.getElementById(id);
    if (!el || !el.value) return 0;
    const num = parseFloat(String(el.value).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) {
        el.value = val;
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

async function fetchWithTimeout(url, timeoutMs = 3500) {
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

// 1. 비트코인 실시간 시세 (Binance -> Coinbase)
async function fetchLiveBtcPrice() {
    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        if (res?.ok) {
            const price = parseFloat((await res.json())?.price);
            if (price > 0) return price;
        }
    } catch (e) {}

    try {
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD");
        if (res?.ok) {
            const price = parseFloat((await res.json())?.data?.amount);
            if (price > 0) return price;
        }
    } catch (e) {}

    return null;
}

// 2. MSTR 장외/프리/애프터마켓 포함 실시간 주가 수집
async function fetchLiveMstrPrice() {
    // includePrePost=true 옵션으로 프리마켓/애프터마켓 가격 포함 요청
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&includePrePost=true&ts=${Date.now()}`;
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(yahooUrl)}`
    ];

    // [시도 1] 야후 파이낸스 장외 거래 데이터 우회 수집
    for (const proxy of proxies) {
        try {
            const res = await fetchWithTimeout(proxy, 3000);
            if (res?.ok) {
                const data = await res.json();
                const meta = data?.chart?.result?.[0]?.meta;
                if (meta) {
                    // 애프터마켓 -> 프리마켓 -> 정규장 순서로 최신 가격 탐색
                    const price = meta.postMarketPrice || meta.preMarketPrice || meta.regularMarketPrice || meta.chartPreviousClose;
                    if (price > 0) return parseFloat(price);
                }
            }
        } catch (e) {}
    }

    // [시도 2] Finnhub REST API
    if (FINNHUB_KEY) {
        try {
            const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`, 3000);
            if (res?.ok) {
                const data = await res.json();
                const price = data?.c > 0 ? data.c : data?.pc;
                if (price > 0) return parseFloat(price);
            }
        } catch (e) {}
    }

    return null;
}

// 3. mNAV 계산 함수
function calculate() {
    const btcPrice = getVal("btcPrice");
    const mstrPrice = getVal("mstrPrice");
    const btcHoldings = getVal("btcHoldings");
    const fdso = getVal("fdso");

    if (!fdso || !btcPrice) return;

    const fdsoShares = fdso * 1_000_000;
    const btcValueUsd = btcHoldings * btcPrice;
    const netReserveUsd = btcValueUsd + DEFAULT_DATA.usdAssetsUsdB * 1e9 - DEFAULT_DATA.debtUsdB * 1e9 - DEFAULT_DATA.preferredUsdB * 1e9;
    const netBpsUsd = netReserveUsd / fdsoShares;

    setText("grossBpsSats", Math.round((btcHoldings / fdsoShares) * 1e8).toLocaleString());
    setText("netBpsSats", Math.round(((netReserveUsd / btcPrice) / fdsoShares) * 1e8).toLocaleString());
    setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);

    if (mstrPrice > 0 && netBpsUsd > 0) {
        const mnav = mstrPrice / netBpsUsd;
        setText("mnavMultiple", `${mnav.toFixed(2)}×`);
        setText("premium", `프리미엄: ${mnav >= 1 ? '+' : ''}${((mnav - 1) * 100).toFixed(1)}%`);
        setText("signal", mnav < 1.0 ? "🟢 극심한 저평가" : mnav > 2.5 ? "🔴 과열 주의" : "🟡 중립 (적정 주가 구간)");
    }
}

// 4. 시세 동기화 메인 루프
async function updateRates() {
    const [fetchedBtc, fetchedMstr] = await Promise.all([
        fetchLiveBtcPrice(),
        fetchLiveMstrPrice()
    ]);

    let btcStatus = "BTC ❌";
    let mstrStatus = "MSTR ❌";

    if (fetchedBtc > 0) {
        setVal("btcPrice", fetchedBtc.toFixed(2));
        btcStatus = "BTC ✅";
    }

    if (fetchedMstr > 0) {
        setVal("mstrPrice", fetchedMstr.toFixed(2));
        mstrStatus = "MSTR ✅";
    }

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    setText("dataStatus", `실시간 연동 [${btcStatus} | ${mstrStatus}] (${timeStr})`);

    calculate();
}

document.addEventListener("DOMContentLoaded", () => {
    calculate();
    updateRates();
    setInterval(updateRates, 10000);

    ["btcPrice", "mstrPrice", "btcHoldings", "adso", "fdso"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", calculate);
    });
});
