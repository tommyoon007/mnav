// =========================================================
// MSTR mNAV DASHBOARD - MULTI-SOURCE REALTIME STOCK SCRIPPER
// =========================================================

// 핀허브 API 키 (finnhub.io에서 발급받은 본인 키로 교체하면 100% 안정적 연동 가능)
let FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30"; 

const DEFAULTS = [77958.01, 132.94, 845050, 298.039, 424.479]; 
const EXTRA = { usdAssetsUsdB: 6.690, debtUsdB: 6.754, preferredUsdB: 14.966 };

function safeSetText(id, text) {
    try { const el = document.getElementById(id); if (el) el.textContent = text; } catch(e) {}
}

function getTargetInput(index, idName) {
    const el = document.getElementById(idName);
    if (el) return el;
    const inputs = document.querySelectorAll("input");
    return inputs.length > index ? inputs[index] : null;
}

function getNum(index, idName, fallback) {
    const el = getTargetInput(index, idName);
    if (!el || !el.value) return fallback;
    const num = parseFloat(el.value.replace(/[^0-9.-]+/g, ""));
    return isNaN(num) || num <= 0 ? fallback : num;
}

function setVal(index, idName, val) {
    const el = getTargetInput(index, idName);
    if (el && document.activeElement !== el) {
        el.value = val;
    }
}

// Timeout 제어
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

// 1. BTC 실시간 시세 (바이낸스 -> 코인베이스)
async function fetchLiveBtcPrice() {
    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        if (res?.ok) {
            const p = parseFloat((await res.json())?.price);
            if (p > 0) return p;
        }
    } catch (e) {}

    try {
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD");
        if (res?.ok) {
            const p = parseFloat((await res.json())?.data?.amount);
            if (p > 0) return p;
        }
    } catch (e) {}
    return null;
}

// 2. MSTR 실시간 주가 (4단계 다중 우회 로직)
async function fetchLiveMstrPrice() {
    // [시도 1] Stooq 금융 API (CSV 우회 수집)
    try {
        const stooqUrl = "https://stooq.com/q/l/?s=mstr.us&f=sd2t2ohlcv&h&e=csv";
        const res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(stooqUrl)}`);
        if (res?.ok) {
            const text = await res.text();
            const lines = text.split('\n');
            if (lines.length > 1) {
                const cols = lines[1].split(',');
                const closePrice = parseFloat(cols[6]); 
                if (!isNaN(closePrice) && closePrice > 0) return closePrice;
            }
        }
    } catch (e) {}

    // [시도 2] Finnhub REST API
    if (FINNHUB_KEY) {
        try {
            const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`);
            if (res?.ok) {
                const data = await res.json();
                const price = (data?.c > 0) ? data.c : data?.pc;
                if (price > 0) return parseFloat(price);
            }
        } catch (e) {}
    }

    // [시도 3] Yahoo Options API (단순 Chart API보다 차단율이 낮음)
    try {
        const yahooOptUrl = "https://query1.finance.yahoo.com/v7/finance/options/MSTR";
        const res = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(yahooOptUrl)}`);
        if (res?.ok) {
            const data = await res.json();
            const price = data?.optionChain?.result?.[0]?.quote?.regularMarketPrice;
            if (price > 0) return parseFloat(price);
        }
    } catch (e) {}

    // [시도 4] AllOrigins 프록시 우회
    try {
        const yahooChartUrl = "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m";
        const res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(yahooChartUrl)}`);
        if (res?.ok) {
            const data = await res.json();
            const meta = data?.chart?.result?.[0]?.meta;
            const price = meta?.regularMarketPrice || meta?.chartPreviousClose;
            if (price > 0) return parseFloat(price);
        }
    } catch (e) {}

    return null; // 모든 시도 실패 시 null 반환
}

// 대시보드 계산 로직
function calculateDashboard() {
    const btcPrice = getNum(0, 'btcPrice', DEFAULTS[0]);
    const mstrPrice = getNum(1, 'mstrPrice', DEFAULTS[1]);
    const btcHoldings = getNum(2, 'btcHoldings', DEFAULTS[2]);
    const adso = getNum(3, 'adso', DEFAULTS[3]);
    const fdso = getNum(4, 'fdso', DEFAULTS[4]);

    const fdsoShares = fdso * 1_000_000;
    const btcValueUsd = btcHoldings * btcPrice;
    const netReserveUsd = btcValueUsd + EXTRA.usdAssetsUsdB * 1e9 - EXTRA.debtUsdB * 1e9 - EXTRA.preferredUsdB * 1e9;
    const netBpsUsd = netReserveUsd / fdsoShares;

    safeSetText("grossBpsSats", Math.round((btcHoldings / fdsoShares) * 1e8).toLocaleString());
    safeSetText("netBpsSats", Math.round(((netReserveUsd / btcPrice) / fdsoShares) * 1e8).toLocaleString());
    safeSetText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);
    safeSetText("btcTotalValue", `$${(btcValueUsd / 1e9).toFixed(2)}B`);
    safeSetText("seniorClaims", `$${(EXTRA.debtUsdB + EXTRA.preferredUsdB).toFixed(2)}B`);
    safeSetText("reserveValue", `$${EXTRA.usdAssetsUsdB.toFixed(2)}B`);
    safeSetText("netBtc", `${Math.round(netReserveUsd / btcPrice).toLocaleString()} ₿`);
    safeSetText("grossBpsUsd", `$${(btcValueUsd / fdsoShares).toFixed(2)}`);

    if (mstrPrice > 0 && netBpsUsd > 0) {
        const mnav = mstrPrice / netBpsUsd;
        safeSetText("mnavMultiple", `${mnav.toFixed(2)}×`);
        safeSetText("premium", `프리미엄: ${mnav >= 1 ? '+' : ''}${((mnav - 1) * 100).toFixed(1)}%`);
        safeSetText("signal", mnav < 1.0 ? "🟢 극심한 저평가" : mnav > 2.5 ? "🔴 과열 주의" : "🟡 중립 (적정 주가 구간)");
    }
}

// 메인 동기화 함수
async function updateDashboard() {
    const [fetchedBtc, fetchedMstr] = await Promise.all([
        fetchLiveBtcPrice(),
        fetchLiveMstrPrice()
    ]);

    let statusBtc = "BTC ❌";
    let statusMstr = "MSTR ❌";

    if (fetchedBtc > 0) {
        setVal(0, 'btcPrice', fetchedBtc.toFixed(2));
        statusBtc = "BTC ✅";
    }

    if (fetchedMstr > 0) {
        setVal(1, 'mstrPrice', fetchedMstr.toFixed(2));
        statusMstr = "MSTR ✅";
    }

    const now = new Date();
    safeSetText("dataStatus", `실시간 연동 [${statusBtc} | ${statusMstr}] (${now.toTimeString().split(' ')[0]})`);

    calculateDashboard();
}

function initApp() {
    // 1. 초기 기본값 주입
    const inputIds = ['btcPrice', 'mstrPrice', 'btcHoldings', 'adso', 'fdso'];
    inputIds.forEach((idName, i) => {
        const el = getTargetInput(i, idName);
        if (el && !el.value) el.value = DEFAULTS[i];
    });

    calculateDashboard();
    
    // 2. 실시간 시세 수집 시작
    updateDashboard();
    setInterval(updateDashboard, 10000);

    // 3. 입력 이벤트 연동
    inputIds.forEach((idName, i) => {
        const el = getTargetInput(i, idName);
        if (el) el.addEventListener("input", calculateDashboard);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}
