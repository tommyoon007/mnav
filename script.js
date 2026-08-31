// =========================================================
// MSTR DASHBOARD - ULTIMATE SAFE SCRIPT
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

function setSafeText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// 1. 실시간 BTC 가격 수집 (코인베이스 우선, 실패시 바이낸스)
async function fetchLiveBtcPrice() {
    try {
        const res = await fetch("https://api.coinbase.com/v2/prices/spot?currency=USD");
        const json = await res.json();
        return parseFloat(json.data.amount);
    } catch (e) {
        try {
            const res = await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT");
            const json = await res.json();
            return parseFloat(json.price);
        } catch (err) { return null; }
    }
}

// 2. 바이낸스 선물 데이터 (CORS 우회 적용 완료)
async function fetchFuturesData() {
    const targetUrl = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT";
    const targetOiUrl = "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT";
    
    // CORS 걱정없는 안정적인 무료 우회 프록시 사용
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    const proxyOiUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetOiUrl)}`;

    let fundingRateDecimal = 0.0001; // 기본 중립값 설정 (에러 방지용)
    let oiUsdBillion = "$35.00B";

    try {
        const [pRes, oRes] = await Promise.all([fetch(proxyUrl), fetch(proxyOiUrl)]);
        if (pRes.ok && oRes.ok) {
            const pData = await pRes.json();
            const oData = await oRes.json();
            
            fundingRateDecimal = parseFloat(pData.lastFundingRate);
            const fundingRatePct = (fundingRateDecimal * 100).toFixed(4) + "%";
            
            const openInterestBtc = parseFloat(oData.openInterest);
            const markPrice = parseFloat(pData.markPrice);
            oiUsdBillion = `$${((openInterestBtc * markPrice) / 1_000_000_000).toFixed(2)}B`;

            // 값 세팅
            ["fundingRate", "btcFundingRate", "fundingValue", "liveFundingRate", "cardFundingRate"].forEach(id => setSafeText(id, fundingRatePct));
            ["btcOpenInterest", "openInterest", "oiValue", "liveBtcOi", "cardBtcOi"].forEach(id => setSafeText(id, oiUsdBillion));
        }
    } catch (e) {}

    // 🚦 경고등 표시 (DATA WAITING 완벽 강제 교체)
    let statusText = "🟡 <b>중립</b> (적정 레버리지 유지)";
    let color = "#ffb74d";

    if (fundingRateDecimal >= 0.0003) {
        statusText = "🔴 <b>과열</b> (롱 포지션 과도)";
        color = "#ff4d4d";
    } else if (fundingRateDecimal <= -0.0001) {
        statusText = "🟢 <b>숏 우세</b> (숏 스퀴즈 가능성)";
        color = "#00e676";
    }

    const warningEl = document.getElementById("leverageSignal") || document.getElementById("leverageWarning");
    if (warningEl) {
        warningEl.innerHTML = statusText;
        warningEl.style.color = color;
    } else {
        const elements = document.querySelectorAll("div, p, span");
        for (const el of elements) {
            if (el.textContent.includes("DATA WAITING") || el.textContent.includes("Risk Score")) {
                const parent = el.closest("div");
                if (parent) {
                    parent.innerHTML = `<div style="font-size: 1.1rem; font-weight: bold; color: ${color}; padding: 12px;">${statusText}</div>`;
                }
                break;
            }
        }
    }
}

// 3. 실시간 MSTR 주가 수집
async function fetchLiveMstrPrice() {
    if (FINNHUB_KEY) {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`);
            const data = await res.json();
            if (data && data.c && data.c > 0) return parseFloat(data.c);
        } catch (e) {}
    }
    return null;
}

// 4. 시나리오 테이블
function updateScenarioTable(netBpsUsd, currentBtc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !netBpsUsd) return;

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

// 5. 목표가 저장 및 계산
async function targetPrice() {
    const targetBtcInput = document.getElementById("targetBtcPrice");
    const targetMnavInput = document.getElementById("targetMnav");
    if (!targetBtcInput || !targetMnavInput) return;

    const targetBtc = parseFloat(targetBtcInput.value);
    const targetMnav = parseFloat(targetMnavInput.value);

    if (!isNaN(targetBtc)) localStorage.setItem("savedTargetBtc", targetBtc);
    if (!isNaN(targetMnav)) localStorage.setItem("savedTargetMnav", targetMnav);

    if (!targetBtc || !targetMnav) return;

    const fdso = parseFloat(document.getElementById("fullyDilutedShares")?.value || 424.479) * 1_000_000;
    const btcHoldings = parseFloat(document.getElementById("btcHoldings")?.value || 845050);

    let usdAssets = 6.690 * 1_000_000_000;
    let debt = 6.754 * 1_000_000_000;
    let preferred = 14.966 * 1_000_000_000;

    try {
        const dataRes = await fetch("./data.json?cache=" + Date.now());
        const data = await dataRes.json();
        usdAssets = parseFloat(data.usdAssetsUsdB || 6.690) * 1_000_000_000;
        debt = parseFloat(data.debtUsdB || 6.754) * 1_000_000_000;
        preferred = parseFloat(data.preferredUsdB || 14.966) * 1_000_000_000;
    } catch (e) {}

    const netBpsUsd = (btcHoldings * targetBtc + usdAssets - debt - preferred) / fdso;
    const predictedMstr = netBpsUsd * targetMnav;

    setSafeText("predictedMstrPrice", `$${predictedMstr.toFixed(2)}`);
    setSafeText("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
}

function loadSavedTargetValues() {
    const savedBtc = localStorage.getItem("savedTargetBtc");
    const savedMnav = localStorage.getItem("savedTargetMnav");
    const btcInput = document.getElementById("targetBtcPrice");
    const mnavInput = document.getElementById("targetMnav");
    if (savedBtc && btcInput) btcInput.value = savedBtc;
    if (savedMnav && mnavInput) mnavInput.value = savedMnav;
}

// 6. 메인 업데이트 로직
async function updateDashboard() {
    try {
        const dataRes = await fetch("./data.json?cache=" + Date.now());
        const data = await dataRes.json();

        const [btcPrice, fetchedMstrPrice] = await Promise.all([fetchLiveBtcPrice(), fetchLiveMstrPrice()]);
        fetchFuturesData();

        const btcInput = document.getElementById("btcPrice");
        if (btcPrice && btcInput) btcInput.value = btcPrice.toFixed(2);

        const mstrInput = document.getElementById("mstrPrice");
        let mstrPrice = fetchedMstrPrice || (parseFloat(mstrInput?.value) || 0);
        if (fetchedMstrPrice && mstrInput) mstrInput.value = fetchedMstrPrice.toFixed(2);

        const rawVal1 = parseFloat(data.adso || 298.039);
        const rawVal2 = parseFloat(data.fdso || 424.479);
        const adso = Math.min(rawVal1, rawVal2);
        const fdso = Math.max(rawVal1, rawVal2);
        const fdsoShares = fdso * 1_000_000;

        const currentBtcPrice = parseFloat(btcInput?.value) || 0;
        const btcHoldings = parseFloat(data.btcHoldings || 845050);
        const usdAssets = parseFloat(data.usdAssetsUsdB || 6.690) * 1_000_000_000;
        const debt = parseFloat(data.debtUsdB || 6.754) * 1_000_000_000;
        const preferred = parseFloat(data.preferredUsdB || 14.966) * 1_000_000_000;

        const hInput = document.getElementById("btcHoldings");
        if (hInput) hInput.value = btcHoldings;
        const aInput = document.getElementById("assumedShares");
        if (aInput) aInput.value = adso.toFixed(3);
        const fInput = document.getElementById("fullyDilutedShares");
        if (fInput) fInput.value = fdso.toFixed(3);

        if (currentBtcPrice <= 0) return;

        const btcValueUsd = btcHoldings * currentBtcPrice;
        const grossBpsUsd = btcValueUsd / fdsoShares;
        const grossBpsSats = (btcHoldings / fdsoShares) * 100_000_000;
        const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
        const netBpsUsd = netReserveUsd / fdsoShares;
        const netBtcHoldings = netReserveUsd / currentBtcPrice;
        const netBpsSats = (netBtcHoldings / fdsoShares) * 100_000_000;

        setSafeText("grossBpsSats", Math.round(grossBpsSats).toLocaleString());
        setSafeText("netBpsSats", Math.round(netBpsSats).toLocaleString());
        setSafeText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);
        setSafeText("btcTotalValue", `$${(btcValueUsd / 1_000_000_000).toFixed(2)}B`);
        setSafeText("seniorClaims", `$${((debt + preferred) / 1_000_000_000).toFixed(2)}B`);
        setSafeText("reserveValue", `$${(usdAssets / 1_000_000_000).toFixed(2)}B`);
        setSafeText("netBtc", `${Math.round(netBtcHoldings).toLocaleString()} ₿`);
        setSafeText("grossBpsUsd", `$${grossBpsUsd.toFixed(2)}`);
        setSafeText("fdsoDisplay", `${fdso.toFixed(3)}M`);

        if (mstrPrice > 0 && netBpsUsd > 0) {
            const mnav = mstrPrice / netBpsUsd;
            const premiumPct = (mnav - 1) * 100;
            setSafeText("mnavMultiple", `${mnav.toFixed(2)}×`);
            setSafeText("premium", `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`);
        }

        updateScenarioTable(netBpsUsd, currentBtcPrice);
        targetPrice();
    } catch (e) {}
}

document.addEventListener("DOMContentLoaded", () => {
    loadSavedTargetValues();
    updateDashboard();

    document.getElementById("targetBtcPrice")?.addEventListener("input", targetPrice);
    document.getElementById("targetMnav")?.addEventListener("input", targetPrice);
    document.getElementById("mstrPrice")?.addEventListener("input", updateDashboard);
    document.getElementById("btcPrice")?.addEventListener("input", updateDashboard);

    setInterval(updateDashboard, 10000);
});
