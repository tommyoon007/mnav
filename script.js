// =========================================================
// MSTR mNAV DASHBOARD - FULL FIELD SYNC & SAFE INITIALIZER
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

const CONFIG = {
    btcPrice:    { labels: ["BTC 가격", "BTC Price"],    ids: ["btcPrice", "btc_price", "btcInput", "btc"],       defaultVal: 77963.83 },
    mstrPrice:   { labels: ["MSTR 주가", "MSTR Price"],   ids: ["mstrPrice", "mstr_price", "mstrInput", "mstr"],   defaultVal: 132.94 },
    btcHoldings: { labels: ["BTC 보유량", "BTC Holdings"], ids: ["btcHoldings", "btc_holdings", "holdings"],        defaultVal: 845050 },
    adso:        { labels: ["ADSO"],                    ids: ["adso", "adsoShares"],                             defaultVal: 298.039 },
    fdso:        { labels: ["FDSO"],                    ids: ["fdso", "fdsoShares"],                             defaultVal: 424.479 }
};

const EXTRA_DATA = {
    usdAssetsUsdB: 6.690,
    debtUsdB: 6.754,
    preferredUsdB: 14.966
};

// --- 스마트 입력창 DOM 검색 (ID 및 라벨 추적) ---
function getFieldInput(key) {
    const item = CONFIG[key];
    if (!item) return null;

    // 1) ID 탐색
    for (const id of item.ids) {
        const el = document.getElementById(id);
        if (el) return el;
    }

    // 2) 라벨 텍스트 기반 탐색
    const elements = Array.from(document.querySelectorAll('div, label, span, p'));
    for (const el of elements) {
        if (item.labels.some(lbl => el.textContent.includes(lbl))) {
            const container = el.closest('.card, .input-group, div') || el.parentElement;
            if (container) {
                const input = container.querySelector('input, textarea');
                if (input) return input;
            }
        }
    }
    return null;
}

function getVal(key) {
    const el = getFieldInput(key);
    if (!el) return CONFIG[key]?.defaultVal || 0;
    const val = el.value !== undefined && el.value !== "" ? el.value : el.textContent;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) || num <= 0 ? CONFIG[key].defaultVal : num;
}

function setVal(key, val) {
    const el = getFieldInput(key);
    if (!el) return;
    if (document.activeElement !== el) {
        const formatted = typeof val === 'number' ? (Number.isInteger(val) ? val.toString() : val.toString()) : val;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value = formatted;
        } else {
            el.textContent = formatted;
        }
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// --- API 호출 ---
async function fetchWithTimeout(url, timeoutMs = 2500) {
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

async function fetchLiveBtcPrice() {
    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        if (res?.ok) {
            const p = parseFloat((await res.json())?.price);
            if (p > 0) return p;
        }
    } catch (e) {}
    return null;
}

async function fetchLiveMstrPrice() {
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

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&range=1d&ts=${Date.now()}`;
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`
    ];

    for (const proxy of proxies) {
        try {
            const res = await fetchWithTimeout(proxy);
            if (res?.ok) {
                const data = await res.json();
                const meta = data?.chart?.result?.[0]?.meta;
                const price = meta?.preMarketPrice || meta?.postMarketPrice || meta?.regularMarketPrice;
                if (price > 0) return parseFloat(price);
            }
        } catch (e) {}
    }
    return null;
}

// --- 계산 및 화면 업데이트 ---
function calculateDashboard() {
    const btcPrice = getVal('btcPrice');
    const mstrPrice = getVal('mstrPrice');
    const btcHoldings = getVal('btcHoldings');
    const adso = getVal('adso');
    const fdso = getVal('fdso');

    const fdsoShares = fdso * 1_000_000;
    const btcValueUsd = btcHoldings * btcPrice;
    const netReserveUsd = btcValueUsd + EXTRA_DATA.usdAssetsUsdB * 1e9 - EXTRA_DATA.debtUsdB * 1e9 - EXTRA_DATA.preferredUsdB * 1e9;
    const netBpsUsd = netReserveUsd / fdsoShares;

    setText("grossBpsSats", Math.round((btcHoldings / fdsoShares) * 1e8).toLocaleString());
    setText("netBpsSats", Math.round(((netReserveUsd / btcPrice) / fdsoShares) * 1e8).toLocaleString());
    setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);
    setText("btcTotalValue", `$${(btcValueUsd / 1e9).toFixed(2)}B`);
    setText("seniorClaims", `$${(EXTRA_DATA.debtUsdB + EXTRA_DATA.preferredUsdB).toFixed(2)}B`);
    setText("reserveValue", `$${EXTRA_DATA.usdAssetsUsdB.toFixed(2)}B`);
    setText("netBtc", `${Math.round(netReserveUsd / btcPrice).toLocaleString()} ₿`);
    setText("grossBpsUsd", `$${(btcValueUsd / fdsoShares).toFixed(2)}`);

    if (mstrPrice > 0 && netBpsUsd > 0) {
        const mnav = mstrPrice / netBpsUsd;
        setText("mnavMultiple", `${mnav.toFixed(2)}×`);
        setText("premium", `프리미엄: ${mnav >= 1 ? '+' : ''}${((mnav - 1) * 100).toFixed(1)}%`);
        setText("signal", mnav < 1.0 ? "🟢 극심한 저평가 (NAV 대비 할인)" : mnav > 2.5 ? "🔴 과열 주의 (높은 프리미엄)" : "🟡 중립 (적정 주가 구간)");
    }
}

// 모든 입력창에 기본값 세팅
function populateAllDefaults() {
    Object.keys(CONFIG).forEach(key => {
        setVal(key, CONFIG[key].defaultVal);
    });
}

async function updateDashboard() {
    populateAllDefaults(); // 비어있는 칸 기본값 세팅

    const [fetchedBtc, fetchedMstr] = await Promise.all([
        fetchLiveBtcPrice().catch(() => null),
        fetchLiveMstrPrice().catch(() => null)
    ]);

    if (fetchedBtc > 0) setVal('btcPrice', fetchedBtc.toFixed(2));
    if (fetchedMstr > 0) setVal('mstrPrice', fetchedMstr.toFixed(2));

    const now = new Date();
    setText("dataStatus", `하이브리드 실시간 연동 중 (${now.toTimeString().split(' ')[0]})`);

    calculateDashboard();
}

function initApp() {
    populateAllDefaults();
    calculateDashboard();

    updateDashboard();
    setInterval(updateDashboard, 10000);

    // 이벤트 리스너 등록
    Object.keys(CONFIG).forEach(key => {
        const el = getFieldInput(key);
        if (el) el.addEventListener("input", calculateDashboard);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}
