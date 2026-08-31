// =========================================================
// MSTR DASHBOARD - BULLETPROOF AUTO UPDATE SCRIPT
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

// 1. 5초 타임아웃 기능이 있는 안전한 Fetch (API 멈춤 현상 완벽 방지)
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 5000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        return null;
    }
}

// 2. 태그 종류(input / div / span) 불문하고 숫자 추출
function getElementNum(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const val = (el.value !== undefined && el.value !== "") ? el.value : el.textContent;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
}

// 3. 태그 종류 불문 안전하게 데이터 쓰기
function setSafeContent(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "INPUT") {
        // 사용자가 손으로 입력 중일 때는 자동 업데이트가 방해하지 않음
        if (document.activeElement !== el) {
            el.value = text;
        }
    } else {
        el.textContent = text;
    }
}

// 4. 실시간 BTC 가격 (3개 출처 교차 수집 - 5초 타임아웃)
async function fetchLiveBtcPrice() {
    // 1차: Coinbase
    try {
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD");
        if (res && res.ok) {
            const data = await res.json();
            const p = parseFloat(data?.data?.amount);
            if (p > 0) return p;
        }
    } catch (e) {}

    // 2차: Binance
    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        if (res && res.ok) {
            const data = await res.json();
            const p = parseFloat(data?.price);
            if (p > 0) return p;
        }
    } catch (e) {}

    // 3차: CoinGecko
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

// 5. 바이낸스 선물 (펀딩비 / 경고등)
async function fetchFuturesData() {
    let fundingRateDecimal = 0.0001;
    try {
        const res = await fetchWithTimeout("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
        if (res && res.ok) {
            const data = await res.json();
            fundingRateDecimal = parseFloat(data.lastFundingRate) || 0.0001;
            const fundingPct = (fundingRateDecimal * 100).toFixed(4) + "%";
            ["fundingRate", "btcFundingRate", "fundingValue", "liveFundingRate", "cardFundingRate"].forEach(id => {
                setSafeContent(id, fundingPct);
            });
        }
    } catch (e) {}

    let statusText = "🟡 중립 (적정 수준)";
    let color = "#ffb74d";

    if (fundingRateDecimal >= 0.0003) {
        statusText = "🔴 과열 (롱 과도)";
        color = "#ff4d4d";
    } else if (fundingRateDecimal <= -0.0001) {
        statusText = "🟢 숏 우세";
        color = "#00e676";
    }

    const warningEl = document.getElementById("leverageSignal") || document.getElementById("leverageWarning") || document.getElementById("riskStatusText");
    if (warningEl) {
        warningEl.textContent = statusText;
        warningEl.style.color = color;
    }
}

// 6. MSTR 실시간 주가
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

// 7. 고정 시나리오 테이블
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

// 8. 목표가 계산기
async function targetPrice() {
    const targetBtc = getElementNum("targetBtcPrice");
    const targetMnav = getElementNum("targetMnav");

    if (targetBtc > 0) localStorage.setItem("savedTargetBtc", targetBtc);
    if (targetMnav > 0) localStorage.setItem("savedTargetMnav", targetMnav);

    if (!targetBtc || !targetMnav) return;

    let fdso = getElementNum("fullyDilutedShares") || 424.479;
    let btcHoldings = getElementNum("btcHoldings") || 845050;

    let usdAssets = 6.690 * 1_000_000_000;
    let debt = 6.754 * 1_000_000_000;
    let preferred = 14.966 * 1_000_000_000;

    try {
        const dataRes = await fetchWithTimeout("./data.json?cache=" + Date.now(), { timeout: 2000 });
        if (dataRes && dataRes.ok) {
            const data = await dataRes.json();
            usdAssets = (parseFloat(data.usdAssetsUsdB) || 6.690) * 1_000_000_000;
            debt = (parseFloat(data.debtUsdB) || 6.754) * 1_000_000_000;
            preferred = (parseFloat(data.preferredUsdB) || 14.966) * 1_000_000_000;
        }
    } catch (e) {}

    const fdsoShares = fdso * 1_000_000;
    const netBpsUsd = (btcHoldings * targetBtc + usdAssets - debt - preferred) / fdsoShares;
    const predictedMstr = netBpsUsd * targetMnav;

    setSafeContent("predictedMstrPrice", `$${predictedMstr.toFixed(2)}`);
    setSafeContent("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
}

// 9. 메인 루프 (중간 오류가 발생해도 무조건 다음 타임아웃 실행)
async function updateDashboard() {
    try {
        let btcHoldings = 845050, adso = 298.039, fdso = 424.479;
        let usdAssetsUsdB = 6.690, debtUsdB = 6.754, preferredUsdB = 14.966;

        try {
            const dataRes = await fetchWithTimeout("./data.json?cache=" + Date.now(), { timeout: 2000 });
            if (dataRes && dataRes.ok) {
                const data = await dataRes.json();
                btcHoldings = parseFloat(data.btcHoldings) || 845050;
                adso = parseFloat(data.adso) || 298.039;
                fdso = parseFloat(data.fdso) || 424.479;
                usdAssetsUsdB = parseFloat(data.usdAssetsUsdB) || 6.690;
                debtUsdB = parseFloat(data.debtUsdB) || 6.754;
                preferredUsdB = parseFloat(data.preferredUsdB) || 14.966;
            }
        } catch (e) {}

        const [btcPrice, fetchedMstrPrice] = await Promise.all([
            fetchLiveBtcPrice(),
            fetchLiveMstrPrice()
        ]);

        fetchFuturesData();

        if (btcPrice && btcPrice > 0) setSafeContent("btcPrice", btcPrice.toFixed(2));
        if (fetchedMstrPrice && fetchedMstrPrice > 0) setSafeContent("mstrPrice", fetchedMstrPrice.toFixed(2));

        const currentBtcPrice = getElementNum("btcPrice");
        const mstrPrice = getElementNum("mstrPrice");

        setSafeContent("btcHoldings", btcHoldings);
        setSafeContent("assumedShares", adso.toFixed(3));
        setSafeContent("fullyDilutedShares", fdso.toFixed(3));

        if (currentBtcPrice > 0) {
            const fdsoShares = fdso * 1_000_000;
            const usdAssets = usdAssetsUsdB * 1_000_000_000;
            const debt = debtUsdB * 1_000_000_000;
            const preferred = preferredUsdB * 1_000_000_000;

            const btcValueUsd = btcHoldings * currentBtcPrice;
            const grossBpsUsd = btcValueUsd / fdsoShares;
            const grossBpsSats = (btcHoldings / fdsoShares) * 100_000_000;
            const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
            const netBpsUsd = netReserveUsd / fdsoShares;
            const netBtcHoldings = netReserveUsd / currentBtcPrice;
            const netBpsSats = (netBtcHoldings / fdsoShares) * 100_000_000;

            setSafeContent("grossBpsSats", Math.round(grossBpsSats).toLocaleString());
            setSafeContent("netBpsSats", Math.round(netBpsSats).toLocaleString());
            setSafeContent("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);
            setSafeContent("btcTotalValue", `$${(btcValueUsd / 1_000_000_000).toFixed(2)}B`);
            setSafeContent("seniorClaims", `$${((debt + preferred) / 1_000_000_000).toFixed(2)}B`);
            setSafeContent("reserveValue", `$${(usdAssets / 1_000_000_000).toFixed(2)}B`);
            setSafeContent("netBtc", `${Math.round(netBtcHoldings).toLocaleString()} ₿`);
            setSafeContent("grossBpsUsd", `$${grossBpsUsd.toFixed(2)}`);
            setSafeContent("fdsoDisplay", `${fdso.toFixed(3)}M`);

            if (mstrPrice > 0 && netBpsUsd > 0) {
                const mnav = mstrPrice / netBpsUsd;
                const premiumPct = (mnav - 1) * 100;
                setSafeContent("mnavMultiple", `${mnav.toFixed(2)}×`);
                setSafeContent("premium", `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`);
            }

            updateScenarioTable(netBpsUsd, currentBtcPrice);
            targetPrice();
        }

        // 마지막 업데이트 시각 표시 (동작 확인용)
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        setSafeContent("lastUpdated", `업데이트: ${timeStr}`);

    } catch (e) {
        console.error("Update loop skipped:", e);
    }
}

// 이벤트 리스너 등록
document.addEventListener("DOMContentLoaded", () => {
    const savedBtc = localStorage.getItem("savedTargetBtc");
    const savedMnav = localStorage.getItem("savedTargetMnav");
    if (savedBtc) setSafeContent("targetBtcPrice", savedBtc);
    if (savedMnav) setSafeContent("targetMnav", savedMnav);

    updateDashboard();

    document.getElementById("targetBtcPrice")?.addEventListener("input", targetPrice);
    document.getElementById("targetMnav")?.addEventListener("input", targetPrice);
    document.getElementById("mstrPrice")?.addEventListener("input", updateDashboard);
    document.getElementById("btcPrice")?.addEventListener("input", updateDashboard);

    // 10초마다 자동 갱신
    setInterval(updateDashboard, 10000);

    // 핸드폰 화면을 다시 켜거나 탭으로 돌아왔을 때 즉시 갱신
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) updateDashboard();
    });
});
