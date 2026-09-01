// =========================================================
// MSTR mNAV & BTC FUTURES DASHBOARD - DIAGNOSTIC SAFE MODE
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

const DEFAULT_DATA = { btcHoldings: 845050, adso: 298.039, fdso: 424.479, usdAssetsUsdB: 6.690, debtUsdB: 6.754, preferredUsdB: 14.966 };
let currentData = { ...DEFAULT_DATA };

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setVal(id, val) {
    const el = document.getElementById(id);
    if (!el || document.activeElement === el) return; // 입력 중일 때 덮어쓰기 방지
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = val;
    else el.textContent = val;
}
function getNum(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const val = el.value || el.textContent;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
}

// 1. MSTR 안전한 다중 데이터 호출
async function fetchLiveMstrPrice() {
    if (FINNHUB_KEY) {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`);
            if (res.ok) {
                const data = await res.json();
                if (data?.c > 0) return parseFloat(data.c);
            }
        } catch (e) {}
    }
    try { // 야후 파이낸스 우회 경로 
        const url = encodeURIComponent("https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m");
        const res = await fetch(`https://api.allorigins.win/get?url=${url}`);
        if (res.ok) {
            const parsed = JSON.parse((await res.json()).contents);
            const price = parsed?.chart?.result?.[0]?.meta?.preMarketPrice || parsed?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (price > 0) return parseFloat(price);
        }
    } catch (e) {}
    return null;
}

// 2. BTC 안전한 다중 데이터 호출
async function fetchLiveBtcPrice() {
    try { 
        const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"); 
        if (res.ok) return parseFloat((await res.json()).price); 
    } catch (e) {}
    return null;
}

// 3. 선물 지표 안전 호출
async function fetchFuturesData() {
    let fundingRate = null, openInterest = null;
    try {
        const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT");
        if (res.ok) {
            const item = (await res.json())?.result?.list?.[0];
            if (item) {
                if (item.fundingRate) fundingRate = (parseFloat(item.fundingRate) * 100).toFixed(4) + "%";
                if (item.openInterest) openInterest = (parseFloat(item.openInterest) / 1000).toFixed(1) + "k ₿";
            }
        }
    } catch (e) {}
    return { fundingRate, openInterest };
}

// --- 코어 대시보드 계산 로직 ---
function calculateDashboard(data = currentData) {
    let currentBtcPrice = getNum("btcPrice") || 95000;
    let currentMstrPrice = getNum("mstrPrice") || 130;

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

    if (currentMstrPrice > 0 && netBpsUsd > 0) {
        const mnav = currentMstrPrice / netBpsUsd;
        setText("mnavMultiple", `${mnav.toFixed(2)}×`);
        setText("premium", `프리미엄: ${mnav >= 1 ? '+' : ''}${((mnav - 1) * 100).toFixed(1)}%`);
        setText("signal", mnav < 1.0 ? "🟢 극심한 저평가" : mnav > 2.5 ? "🔴 과열 주의" : "🟡 중립 (적정 주가 구간)");
    }
}

// --- 메인 사이클 (에러 추적 상태창 포함) ---
async function updateDashboard() {
    // 하나가 실패해도 전체가 멈추지 않도록 각각 catch 처리 (핵심 해결책)
    const [fetchedBtc, fetchedMstr, futures] = await Promise.all([
        fetchLiveBtcPrice().catch(() => null),
        fetchLiveMstrPrice().catch(() => null),
        fetchFuturesData().catch(() => ({}))
    ]);

    let diagnosticMsg = `⏱ ${new Date().toTimeString().split(' ')[0]} | `;

    if (fetchedBtc > 0) {
        setVal("btcPrice", fetchedBtc.toFixed(2));
        diagnosticMsg += "BTC ✅ | ";
    } else {
        diagnosticMsg += "BTC ❌ | ";
    }

    if (fetchedMstr > 0) {
        setVal("mstrPrice", fetchedMstr.toFixed(2));
        diagnosticMsg += "MSTR ✅";
    } else {
        diagnosticMsg += "MSTR ❌";
    }

    setText("dataStatus", diagnosticMsg);

    if (futures.fundingRate) {
        const frEl = document.getElementById("fundingRate") || document.getElementById("frValue");
        if (frEl) frEl.textContent = futures.fundingRate;
    }

    calculateDashboard(currentData);
}

document.addEventListener("DOMContentLoaded", () => {
    updateDashboard();
    setInterval(updateDashboard, 10000); // 10초마다 시세 갱신
    
    // 수동 입력 창 계산 이벤트 연동
    const inputs = ["mstrPrice", "btcPrice", "btcHoldings", "adso", "fdso"];
    inputs.forEach(id => {
        document.getElementById(id)?.addEventListener("input", () => calculateDashboard(currentData));
    });
});
