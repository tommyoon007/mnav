// =========================================================
// MSTR REAL-TIME DATA FETCH & MNAV CALCULATOR (CORS Fixed)
// =========================================================

// 1. 실시간 BTC 가격 수집 (Coinbase -> Binance Fallback)
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
        } catch (err) {
            console.error("BTC 시세 수집 실패:", err);
            return null;
        }
    }
}

// 2. 실시간 MSTR 주가 수집 (CORS 우회 프록시 + 프리/애프터마켓 대응)
async function fetchLiveMstrPrice() {
    const rawUrl = "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m";
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`;

    try {
        const res = await fetch(proxyUrl);
        const json = await res.json();
        const meta = json.chart.result[0].meta;
        
        // 시간대별 가장 최신 시세(장후/장전/정규장) 적용
        const currentPrice = meta.postMarketPrice || meta.preMarketPrice || meta.regularMarketPrice;
        return parseFloat(currentPrice);
    } catch (e) {
        console.warn("MSTR 주가 수집 실패 (기본 입력값 유지):", e);
        return null;
    }
}

// 3. mNAV 및 지표 계산 메인 로직
async function updateDashboard() {
    const statusEl = document.getElementById("dataStatus");
    if (statusEl) statusEl.textContent = "실시간 시세 업데이트 중...";

    try {
        // A. data.json 기본 자본 데이터 가져오기
        const dataRes = await fetch("./data.json?cache=" + Date.now());
        const data = await dataRes.json();

        // B. 실시간 시세 병렬 수집
        const [btcPrice, mstrPrice] = await Promise.all([
            fetchLiveBtcPrice(),
            fetchLiveMstrPrice()
        ]);

        if (!btcPrice) {
            if (statusEl) statusEl.textContent = "시세 수집 오류 발생";
            return;
        }

        // C. 자본 수치 파싱
        const btcHoldings = parseFloat(data.btcHoldings || 845050);
        const adso = parseFloat(data.adso || 424.479);
        const fdso = parseFloat(data.fdso || 424.479);
        const fdsoShares = fdso * 1_000_000;
        const usdAssets = parseFloat(data.usdAssetsUsdB || 6.690) * 1_000_000_000;
        const debt = parseFloat(data.debtUsdB || 6.754) * 1_000_000_000;
        const preferred = parseFloat(data.preferredUsdB || 14.966) * 1_000_000_000;

        // D. HTML 입력창 값 채우기
        document.getElementById("btcPrice").value = btcPrice.toFixed(2);
        if (mstrPrice) document.getElementById("mstrPrice").value = mstrPrice.toFixed(2);
        document.getElementById("btcHoldings").value = btcHoldings;
        document.getElementById("assumedShares").value = adso;
        document.getElementById("fullyDilutedShares").value = fdso;

        // E. 핵심 지표 계산
        const btcValueUsd = btcHoldings * btcPrice;
        const grossBpsUsd = btcValueUsd / fdsoShares;
        const grossBpsSats = (btcHoldings / fdsoShares) * 100_000_000;

        const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
        const netBpsUsd = netReserveUsd / fdsoShares;
        const netBtcHoldings = netReserveUsd / btcPrice;
        const netBpsSats = (netBtcHoldings / fdsoShares) * 100_000_000;

        // F. 화면 수치 반영
        document.getElementById("grossBpsSats").textContent = Math.round(grossBpsSats).toLocaleString();
        document.getElementById("netBpsSats").textContent = Math.round(netBpsSats).toLocaleString();
        document.getElementById("netBpsUsd").textContent = `$${netBpsUsd.toFixed(2)}`;
        
        document.getElementById("btcTotalValue").textContent = `$${(btcValueUsd / 1_000_000_000).toFixed(2)}B`;
        document.getElementById("seniorClaims").textContent = `$${((debt + preferred) / 1_000_000_000).toFixed(2)}B`;
        document.getElementById("reserveValue").textContent = `$${(usdAssets / 1_000_000_000).toFixed(2)}B`;
        document.getElementById("netBtc").textContent = `${Math.round(netBtcHoldings).toLocaleString()} ₿`;
        document.getElementById("grossBpsUsd").textContent = `$${grossBpsUsd.toFixed(2)}`;
        document.getElementById("fdsoDisplay").textContent = `${fdso}M`;

        // G. mNAV 및 프리미엄 산출
        const activeMstrPrice = mstrPrice || parseFloat(document.getElementById("mstrPrice").value);
        if (activeMstrPrice && netBpsUsd > 0) {
            const mnav = activeMstrPrice / netBpsUsd;
            const premiumPct = (mnav - 1) * 100;

            document.getElementById("mnavMultiple").textContent = `${mnav.toFixed(2)}×`;
            document.getElementById("premium").textContent = `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`;

            // 신호 문구
            const signalEl = document.getElementById("signal");
            if (signalEl) {
                if (mnav < 1.0) signalEl.textContent = "🟢 저평가 구간 (mNAV < 1.0)";
                else if (mnav < 1.5) signalEl.textContent = "🟡 적정 매수 구간 (mNAV 1.0 ~ 1.5)";
                else if (mnav < 2.2) signalEl.textContent = "🟠 주의 구간 (mNAV 1.5 ~ 2.2)";
                else signalEl.textContent = "🔴 과열 구간 (mNAV 2.2+)";
            }
        }

        if (statusEl) {
            const now = new Date();
            statusEl.textContent = `실시간 연동 완료 (${data.source || 'Strategy'} 데이터 기준) - ${now.toLocaleTimeString()}`;
        }

        // 시나리오 테이블 자동 업데이트
        updateScenarioTable(netBpsUsd, btcPrice);

    } catch (error) {
        console.error("대시보드 업데이트 오류:", error);
        if (statusEl) statusEl.textContent = "데이터 불러오기 실패";
    }
}

// 4. 빠른 시나리오 테이블 작성
function updateScenarioTable(netBpsUsd, currentBtc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !netBpsUsd) return;

    const btcMultipliers = [0.8, 0.9, 1.0, 1.1, 1.2, 1.5];
    const mnavMultipliers = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

    let html = "";
    btcMultipliers.forEach(m => {
        const targetBtc = currentBtc * m;
        const targetNetBps = netBpsUsd * m;
        html += `<tr><td>$${Math.round(targetBtc / 1000)}k</td>`;
        
        mnavMultipliers.forEach(nav => {
            const predMstr = targetNetBps * nav;
            html += `<td>$${predMstr.toFixed(0)}</td>`;
        });
        html += `</tr>`;
    });

    tbody.innerHTML = html;
}

// 5. 목표가 계산 버튼 함수 (data.json 동적 연동)
async function targetPrice() {
    const targetBtc = parseFloat(document.getElementById("targetBtcPrice").value);
    const targetMnav = parseFloat(document.getElementById("targetMnav").value);
    const fdso = parseFloat(document.getElementById("fullyDilutedShares").value || 424.479) * 1_000_000;
    const btcHoldings = parseFloat(document.getElementById("btcHoldings").value || 845050);

    if (!targetBtc || !targetMnav) return;

    // data.json에서 최신 자본 정보 불러오기
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

    const btcValueUsd = btcHoldings * targetBtc;
    const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
    const netBpsUsd = netReserveUsd / fdso;
    const predictedMstr = netBpsUsd * targetMnav;

    document.getElementById("predictedMstrPrice").textContent = `$${predictedMstr.toFixed(2)}`;
    document.getElementById("predictedNetBps").textContent = `예상 Net BPS: $${netBpsUsd.toFixed(2)}`;
}

// 6. 페이지 진입 시 실행 및 10초 주기 실시간 갱신
document.addEventListener("DOMContentLoaded", () => {
    updateDashboard();
    setInterval(updateDashboard, 10000);
});
