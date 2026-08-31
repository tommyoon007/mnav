// =========================================================
// MSTR DASHBOARD - FULL REALTIME SCRIPT (No HTML Editing Needed)
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

// 1. 실시간 BTC 가격 수집
async function fetchLiveBtcPrice() {
    try {
        const res = await fetch("https://api.coinbase.com/v2/prices/spot?currency=USD");
        const json = await res.json();
        return parseFloat(json.data.amount);
    } catch (e) {
        try {
            const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
            const json = await res.json();
            return parseFloat(json.price);
        } catch (err) { return null; }
    }
}

// 2. 바이낸스 선물 데이터 및 자동 경고등 교체
async function fetchFuturesData() {
    const rawPremiumUrl = "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT";
    const rawOiUrl = "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT";

    let premiumData = null;
    let oiData = null;

    try {
        const [pRes, oRes] = await Promise.all([fetch(rawPremiumUrl), fetch(rawOiUrl)]);
        if (pRes.ok && oRes.ok) {
            premiumData = await pRes.json();
            oiData = await oRes.json();
        }
    } catch (e) {}

    if (!premiumData || !oiData) {
        const proxyList = [
            url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
            url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
        ];
        for (const getProxyUrl of proxyList) {
            try {
                const [pRes, oRes] = await Promise.all([
                    fetch(getProxyUrl(rawPremiumUrl)),
                    fetch(getProxyUrl(rawOiUrl))
                ]);
                if (pRes.ok && oRes.ok) {
                    premiumData = await pRes.json();
                    oiData = await oRes.json();
                    break;
                }
            } catch (err) {}
        }
    }

    if (!premiumData || !oiData) return;

    const fundingRateDecimal = parseFloat(premiumData.lastFundingRate);
    const fundingRatePct = (fundingRateDecimal * 100).toFixed(4) + "%";

    const openInterestBtc = parseFloat(oiData.openInterest);
    const markPrice = parseFloat(premiumData.markPrice);
    const oiUsdBillion = `$${((openInterestBtc * markPrice) / 1_000_000_000).toFixed(2)}B`;

    // 펀딩비 & OI 값 화면에 세팅
    ["fundingRate", "btcFundingRate", "fundingValue", "liveFundingRate", "cardFundingRate"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = fundingRatePct;
    });

    ["btcOpenInterest", "openInterest", "oiValue", "liveBtcOi", "cardBtcOi"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = oiUsdBillion;
    });

    // 🚦 DATA WAITING 박스를 찾아 실시간 경고등으로 자동 교체
    updateLeverageWarningBox(fundingRateDecimal);
}

// 경고등 상자 자동 감지 및 실시간 업데이트
function updateLeverageWarningBox(fundingRateDecimal) {
    let targetEl = document.getElementById("leverageSignal") || document.getElementById("leverageWarning");

    // ID로 못 찾을 경우 문구 기반으로 상자 자동 탐색
    if (!targetEl) {
        const elements = document.querySelectorAll("div, p, span, h3");
        for (const el of elements) {
            if (el.textContent.includes("DATA WAITING") || el.textContent.includes("Risk Score")) {
                targetEl = el.closest("div");
                break;
            }
        }
    }

    if (targetEl) {
        let statusText = "";
        let color = "#ffb74d";

        if (fundingRateDecimal >= 0.0003) {
            statusText = "🔴 <b>과열</b> (롱 포지션 과도 / 펀딩비 상승)";
            color = "#ff4d4d";
        } else if (fundingRateDecimal <= -0.0001) {
            statusText = "🟢 <b>숏 우세</b> (숏 스퀴즈 가능성 유효)";
            color = "#00e676";
        } else {
            statusText = "🟡 <b>중립</b> (적정 레버리지 수준 유지 중)";
            color = "#ffb74d";
        }

        targetEl.innerHTML = `
            <div style="font-size: 1.1rem; font-weight: bold; color: ${color}; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                ${statusText}
            </div>
        `;
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

    const rawUrl = "https://query2.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m";
    const proxyList = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rawUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`
    ];

    for (const proxyUrl of proxyList) {
        try {
            const res = await fetch(proxyUrl);
            if (!res.ok) continue;
            const json = await res.json();
            const meta = json.chart.result[0].meta;
            const price = meta.postMarketPrice || meta.preMarketPrice || meta.regularMarketPrice;
            if (price && price > 0) return parseFloat(price);
        } catch (e) {}
    }
    return null;
}

// 4. 고정 시나리오 테이블
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

// 5. 목표가 자동 기억 & 실시간 계산 (localStorage)
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

    const predMstrEl = document.getElementById("predictedMstrPrice");
    const predNetBpsEl = document.getElementById("predictedNetBps");

    if (predMstrEl) predMstrEl.textContent = `$${predictedMstr.toFixed(2)}`;
    if (predNetBpsEl) predNetBpsEl.textContent = `예상 Net BPS: $${netBpsUsd.toFixed(2)}`;
}

function loadSavedTargetValues() {
    const savedBtc = localStorage.getItem("savedTargetBtc");
    const savedMnav = localStorage.getItem("savedTargetMnav");
    if (savedBtc && document.getElementById("targetBtcPrice")) document.getElementById("targetBtcPrice").value = savedBtc;
    if (savedMnav && document.getElementById("targetMnav")) document.getElementById("targetMnav").value = savedMnav;
}

// 6. 메인 갱신 로직
async function updateDashboard() {
    try {
        const dataRes = await fetch("./data.json?cache=" + Date.now());
        const data = await dataRes.json();

        const [btcPrice, fetchedMstrPrice] = await Promise.all([fetchLiveBtcPrice(), fetchLiveMstrPrice()]);
        fetchFuturesData();

        if (btcPrice) document.getElementById("btcPrice").value = btcPrice.toFixed(2);
        let mstrPrice = fetchedMstrPrice || (parseFloat(document.getElementById("mstrPrice").value) || 0);
        if (fetchedMstrPrice) document.getElementById("mstrPrice").value = fetchedMstrPrice.toFixed(2);

        const rawVal1 = parseFloat(data.adso || 298.039);
        const rawVal2 = parseFloat(data.fdso || 424.479);
        const adso = Math.min(rawVal1, rawVal2);
        const fdso = Math.max(rawVal1, rawVal2);
        const fdsoShares = fdso * 1_000_000;

        const currentBtcPrice = parseFloat(document.getElementById("btcPrice").value) || 0;
        const btcHoldings = parseFloat(data.btcHoldings || 845050);
        const usdAssets = parseFloat(data.usdAssetsUsdB || 6.690) * 1_000_000_000;
        const debt = parseFloat(data.debtUsdB || 6.754) * 1_000_000_000;
        const preferred = parseFloat(data.preferredUsdB || 14.966) * 1_000_000_000;

        document.getElementById("btcHoldings").value = btcHoldings;
        document.getElementById("assumedShares").value = adso.toFixed(3);
        document.getElementById("fullyDilutedShares").value = fdso.toFixed(3);

        if (currentBtcPrice <= 0) return;

        const btcValueUsd = btcHoldings * currentBtcPrice;
        const grossBpsUsd = btcValueUsd / fdsoShares;
        const grossBpsSats = (btcHoldings / fdsoShares) * 100_000_000;
        const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
        const netBpsUsd = netReserveUsd / fdsoShares;
        const netBtcHoldings = netReserveUsd / currentBtcPrice;
        const netBpsSats = (netBtcHoldings / fdsoShares) * 100_000_000;

        document.getElementById("grossBpsSats").textContent = Math.round(grossBpsSats).toLocaleString();
        document.getElementById("netBpsSats").textContent = Math.round(netBpsSats).toLocaleString();
        document.getElementById("netBpsUsd").textContent = `$${netBpsUsd.toFixed(2)}`;
        document.getElementById("btcTotalValue").textContent = `$${(btcValueUsd / 1_000_000_000).toFixed(2)}B`;
        document.getElementById("seniorClaims").textContent = `$${((debt + preferred) / 1_000_000_000).toFixed(2)}B`;
        document.getElementById("reserveValue").textContent = `$${(usdAssets / 1_000_000_000).toFixed(2)}B`;
        document.getElementById("netBtc").textContent = `${Math.round(netBtcHoldings).toLocaleString()} ₿`;
        document.getElementById("grossBpsUsd").textContent = `$${grossBpsUsd.toFixed(2)}`;
        document.getElementById("fdsoDisplay").textContent = `${fdso.toFixed(3)}M`;

        if (mstrPrice > 0 && netBpsUsd > 0) {
            const mnav = mstrPrice / netBpsUsd;
            const premiumPct = (mnav - 1) * 100;
            document.getElementById("mnavMultiple").textContent = `${mnav.toFixed(2)}×`;
            document.getElementById("premium").textContent = `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`;
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
