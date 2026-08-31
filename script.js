// =========================================================
// MSTR mNAV DASHBOARD - FAILSAFE AUTO UPDATE SCRIPT
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

// 통신 장애 시에도 화면을 즉시 채워줄 안전 백업 데이터
const DEFAULT_DATA = {
    btcHoldings: 845050,
    adso: 298.039,
    fdso: 424.479,
    usdAssetsUsdB: 6.690,
    debtUsdB: 6.754,
    preferredUsdB: 14.966,
    fallbackBtcPrice: 95000,
    fallbackMstrPrice: 300
};

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

// 1. 실시간 BTC 가격 수집 (다중 교차망)
async function fetchLiveBtcPrice() {
    try {
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD");
        if (res && res.ok) {
            const data = await res.json();
            const p = parseFloat(data?.data?.amount);
            if (p > 0) return p;
        }
    } catch (e) {}

    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        if (res && res.ok) {
            const data = await res.json();
            const p = parseFloat(data?.price);
            if (p > 0) return p;
        }
    } catch (e) {}

    try {
        const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
        if (res && res.ok) {
            const data = await res.json();
            const p = parseFloat(data?.bitcoin?.usd);
            if (p > 0) return p;
        }
    } catch (e) {}

    return null;
}

// 2. 실시간 MSTR 주가 수집
async function fetchLiveMstrPrice() {
    if (!FINNHUB_KEY) return null;
    try {
        const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`);
        if (res && res.ok) {
            const data = await res.json();
            if (data && data.c && data.c > 0) return parseFloat(data.c);
        }
    } catch (e) {}
    return null;
}

// 3. 고정 시나리오 표 생성
function updateScenarioTable(netBpsUsd, currentBtc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !netBpsUsd || !currentBtc) return;

    const fixedBtcTargets = [70000, 80000, 90000, 100000, 120000, 150000, 200000];
    const mnavMultipliers = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

    let html = "";
    fixedBtcTargets.forEach(targetBtc => {
        const ratio = targetBtc / currentBtc;
        const targetNetBps = netBpsUsd * ratio;
        html += `<tr><td>$${(targetBtc / 1000).toFixed(0)}k</td>`;
        mnavMultipliers.forEach(nav => {
            html += `<td>$${(targetNetBps * nav).toFixed(0)}</td>`;
        });
        html += `</tr>`;
    });
    tbody.innerHTML = html;
}

// 4. MSTR 가격 예측
window.targetPrice = function() {
    const targetBtc = getNum("targetBtcPrice");
    const targetMnav = getNum("targetMnav");

    if (targetBtc > 0) localStorage.setItem("savedTargetBtc", targetBtc);
    if (targetMnav > 0) localStorage.setItem("savedTargetMnav", targetMnav);

    if (!targetBtc || !targetMnav) return;

    const fdso = getNum("fullyDilutedShares") || DEFAULT_DATA.fdso;
    const btcHoldings = getNum("btcHoldings") || DEFAULT_DATA.btcHoldings;

    const fdsoShares = fdso * 1_000_000;
    const usdAssets = DEFAULT_DATA.usdAssetsUsdB * 1_000_000_000;
    const debt = DEFAULT_DATA.debtUsdB * 1_000_000_000;
    const preferred = DEFAULT_DATA.preferredUsdB * 1_000_000_000;

    const netBpsUsd = (btcHoldings * targetBtc + usdAssets - debt - preferred) / fdsoShares;
    const predictedMstr = netBpsUsd * targetMnav;

    setText("predictedMstrPrice", `$${predictedMstr.toFixed(2)}`);
    setText("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
};

// 5. 화면 수치 계산 및 출력
function calculateDashboard(data) {
    let currentBtcPrice = getNum("btcPrice");
    let currentMstrPrice = getNum("mstrPrice");

    if (currentBtcPrice <= 0) currentBtcPrice = DEFAULT_DATA.fallbackBtcPrice;
    if (currentMstrPrice <= 0) currentMstrPrice = DEFAULT_DATA.fallbackMstrPrice;

    const fdsoShares = data.fdso * 1_000_000;
    const usdAssets = data.usdAssetsUsdB * 1_000_000_000;
    const debt = data.debtUsdB * 1_000_000_000;
    const preferred = data.preferredUsdB * 1_000_000_000;

    const btcValueUsd = data.btcHoldings * currentBtcPrice;
    const grossBpsUsd = btcValueUsd / fdsoShares;
    const grossBpsSats = (data.btcHoldings / fdsoShares) * 100_000_000;

    const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
    const netBpsUsd = netReserveUsd / fdsoShares;
    const netBtcHoldings = netReserveUsd / currentBtcPrice;
    const netBpsSats = (netBtcHoldings / fdsoShares) * 100_000_000;

    setText("grossBpsSats", Math.round(grossBpsSats).toLocaleString());
    setText("netBpsSats", Math.round(netBpsSats).toLocaleString());
    setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);
    setText("btcTotalValue", `$${(btcValueUsd / 1_000_000_000).toFixed(2)}B`);
    setText("seniorClaims", `$${((debt + preferred) / 1_000_000_000).toFixed(2)}B`);
    setText("reserveValue", `$${(usdAssets / 1_000_000_000).toFixed(2)}B`);
    setText("netBtc", `${Math.round(netBtcHoldings).toLocaleString()} ₿`);
    setText("grossBpsUsd", `$${grossBpsUsd.toFixed(2)}`);
    setText("fdsoDisplay", `${data.fdso.toFixed(3)}M`);

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

// 6. 메인 업데이트 로직
async function updateDashboard() {
    let currentData = { ...DEFAULT_DATA };

    // [1단계] 접속 즉시 화면부터 100% 채우기 (먹통 방지)
    setVal("btcHoldings", currentData.btcHoldings);
    setVal("assumedShares", currentData.adso.toFixed(3));
    setVal("fullyDilutedShares", currentData.fdso.toFixed(3));
    calculateDashboard(currentData);

    // [2단계] data.json 로드 시도
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

            setVal("btcHoldings", currentData.btcHoldings);
            setVal("assumedShares", currentData.adso.toFixed(3));
            setVal("fullyDilutedShares", currentData.fdso.toFixed(3));
        }
    } catch (e) {}

    // [3단계] 실시간 시세 연동
    try {
        const [fetchedBtc, fetchedMstr] = await Promise.all([
            fetchLiveBtcPrice(),
            fetchLiveMstrPrice()
        ]);

        if (fetchedBtc && fetchedBtc > 0) setVal("btcPrice", fetchedBtc.toFixed(2));
        if (fetchedMstr && fetchedMstr > 0) setVal("mstrPrice", fetchedMstr.toFixed(2));

        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        setText("dataStatus", `최신 데이터 연동 완료 (${timeStr})`);
    } catch (e) {
        setText("dataStatus", "실시간 시세 연결 대기 중 (기본값 동작)");
    }

    // [4단계] 최종 재계산
    calculateDashboard(currentData);
}

// 이벤트 초기화
document.addEventListener("DOMContentLoaded", () => {
    const savedBtc = localStorage.getItem("savedTargetBtc");
    const savedMnav = localStorage.getItem("savedTargetMnav");
    if (savedBtc) setVal("targetBtcPrice", savedBtc);
    if (savedMnav) setVal("targetMnav", savedMnav);

    updateDashboard();

    document.getElementById("targetBtcPrice")?.addEventListener("input", window.targetPrice);
    document.getElementById("targetMnav")?.addEventListener("input", window.targetPrice);
    document.getElementById("mstrPrice")?.addEventListener("input", () => calculateDashboard(DEFAULT_DATA));
    document.getElementById("btcPrice")?.addEventListener("input", () => calculateDashboard(DEFAULT_DATA));

    // 10초 주기 자동 갱신
    setInterval(updateDashboard, 10000);

    // 모바일 백그라운드 복귀 시 갱신
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) updateDashboard();
    });
});
