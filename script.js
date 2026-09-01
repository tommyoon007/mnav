// =========================================================
// MSTR mNAV DASHBOARD - BULLETPROOF AUTO-RECOVERY SCRIPT
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
    fallbackBtcPrice: 77954.24,
    fallbackMstrPrice: 132.94
};

let currentData = { ...DEFAULT_DATA };

// --- 1. 스마트 DOM 요소 탐색 (ID 불일치 및 레이아웃 오류 완벽 방지) ---
function getInputElement(type) {
    const targetLabel = type === 'mstr' ? 'MSTR 주가' : 'BTC 가격';
    const possibleIds = type === 'mstr' 
        ? ["mstrPrice", "mstr_price", "mstrInput", "mstr"] 
        : ["btcPrice", "btc_price", "btcInput", "btc"];

    // 1) ID 기반 탐색
    for (const id of possibleIds) {
        const el = document.getElementById(id);
        if (el) return el;
    }

    // 2) 라벨 텍스트 기반 자동 추적 (ID가 달라도 탐색 가능)
    const elements = Array.from(document.querySelectorAll('div, label, span, p'));
    for (const el of elements) {
        if (el.textContent.includes(targetLabel)) {
            const container = el.closest('.card, .input-group, div') || el.parentElement;
            if (container) {
                const input = container.querySelector('input');
                if (input) return input;
            }
        }
    }
    return null;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setInputValue(type, val) {
    const el = getInputElement(type);
    if (!el) return;
    // 사용자가 입력 중이 아닐 때만 값 업데이트
    if (document.activeElement !== el) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value = val;
        } else {
            el.textContent = val;
        }
    }
}

function getInputValue(type) {
    const el = getInputElement(type);
    if (!el) return 0;
    const val = el.value !== undefined && el.value !== "" ? el.value : el.textContent;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
}

// --- 2. 실시간 시세 수집 ---
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

// --- 3. 대시보드 계산 로직 ---
function calculateDashboard() {
    let currentBtcPrice = getInputValue('btc');
    let currentMstrPrice = getInputValue('mstr');

    // 0이 입력되어 있을 경우 기본 방어 주가로 즉시 복구
    if (currentBtcPrice <= 0) {
        currentBtcPrice = DEFAULT_DATA.fallbackBtcPrice;
        setInputValue('btc', currentBtcPrice.toFixed(2));
    }
    if (currentMstrPrice <= 0) {
        currentMstrPrice = DEFAULT_DATA.fallbackMstrPrice;
        setInputValue('mstr', currentMstrPrice.toFixed(2));
    }

    const fdsoShares = DEFAULT_DATA.fdso * 1_000_000;
    const btcValueUsd = DEFAULT_DATA.btcHoldings * currentBtcPrice;
    const netReserveUsd = btcValueUsd + DEFAULT_DATA.usdAssetsUsdB * 1e9 - DEFAULT_DATA.debtUsdB * 1e9 - DEFAULT_DATA.preferredUsdB * 1e9;
    const netBpsUsd = netReserveUsd / fdsoShares;

    setText("grossBpsSats", Math.round((DEFAULT_DATA.btcHoldings / fdsoShares) * 1e8).toLocaleString());
    setText("netBpsSats", Math.round(((netReserveUsd / currentBtcPrice) / fdsoShares) * 1e8).toLocaleString());
    setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);
    setText("btcTotalValue", `$${(btcValueUsd / 1e9).toFixed(2)}B`);
    setText("seniorClaims", `$${(DEFAULT_DATA.debtUsdB + DEFAULT_DATA.preferredUsdB).toFixed(2)}B`);
    setText("reserveValue", `$${DEFAULT_DATA.usdAssetsUsdB.toFixed(2)}B`);
    setText("netBtc", `${Math.round(netReserveUsd / currentBtcPrice).toLocaleString()} ₿`);
    setText("grossBpsUsd", `$${(btcValueUsd / fdsoShares).toFixed(2)}`);

    if (currentMstrPrice > 0 && netBpsUsd > 0) {
        const mnav = currentMstrPrice / netBpsUsd;
        setText("mnavMultiple", `${mnav.toFixed(2)}×`);
        setText("premium", `프리미엄: ${mnav >= 1 ? '+' : ''}${((mnav - 1) * 100).toFixed(1)}%`);
        setText("signal", mnav < 1.0 ? "🟢 극심한 저평가 (NAV 대비 할인)" : mnav > 2.5 ? "🔴 과열 주의 (높은 프리미엄)" : "🟡 중립 (적정 주가 구간)");
    }
}

// --- 4. 메인 동기화 주기 ---
async function updateDashboard() {
    // 1) 수집 전 0 방지 기본값 세팅
    if (getInputValue('mstr') <= 0) setInputValue('mstr', DEFAULT_DATA.fallbackMstrPrice.toFixed(2));
    if (getInputValue('btc') <= 0) setInputValue('btc', DEFAULT_DATA.fallbackBtcPrice.toFixed(2));
    calculateDashboard();

    // 2) 비동기 시세 수집
    const [fetchedBtc, fetchedMstr] = await Promise.all([
        fetchLiveBtcPrice().catch(() => null),
        fetchLiveMstrPrice().catch(() => null)
    ]);

    if (fetchedBtc > 0) setInputValue('btc', fetchedBtc.toFixed(2));
    if (fetchedMstr > 0) setInputValue('mstr', fetchedMstr.toFixed(2));

    const now = new Date();
    setText("dataStatus", `하이브리드 실시간 연동 중 (${now.toTimeString().split(' ')[0]})`);

    calculateDashboard();
}

function initApp() {
    // 앱 시작 즉시 기본값 주입 (0 화면 표시 차단)
    setInputValue('mstr', DEFAULT_DATA.fallbackMstrPrice.toFixed(2));
    setInputValue('btc', DEFAULT_DATA.fallbackBtcPrice.toFixed(2));
    calculateDashboard();

    updateDashboard();
    setInterval(updateDashboard, 10000);

    // 수동 수정 이벤트 연동
    const mstrEl = getInputElement('mstr');
    const btcEl = getInputElement('btc');
    if (mstrEl) mstrEl.addEventListener("input", calculateDashboard);
    if (btcEl) btcEl.addEventListener("input", calculateDashboard);
}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}
