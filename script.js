// =========================================================
// MSTR REAL-TIME DATA FETCH & MNAV CALCULATOR (Stable Version)
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

// 2. 실시간 MSTR 주가 수집 (Finnhub API 우선 -> 4단계 다중 프록시 우회)
async function fetchLiveMstrPrice() {
    // 💡 Finnhub 무료 API 키가 있다면 아래 큰따옴표 안에 넣으세요 (예: "c12345678...")
    // 발급받아 넣으시면 MSTR 주가가 100% 끊김 없이 자동 업데이트됩니다.
    const FINNHUB_KEY = "daarqqhr01qn50rjdhtgdaarqqhr01qn50rjdhu0"; 

    if (FINNHUB_KEY) {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`);
            const data = await res.json();
            if (data && data.c && data.c > 0) {
                return parseFloat(data.c); // c: 현재가
            }
        } catch (e) {
            console.warn("Finnhub API 호출 실패, 우회 프록시로 전환합니다.", e);
        }
    }

    // API 키가 없거나 실패 시 다중 우회 프록시 시도
    const rawUrl = "https://query2.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m";
    const proxyList = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rawUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`,
        `https://thingproxy.freeboard.io/fetch/${rawUrl}`
    ];

    for (const proxyUrl of proxyList) {
        try {
            const res = await fetch(proxyUrl);
            if (!res.ok) continue;
            const json = await res.json();
            const meta = json.chart.result[0].meta;
            const price = meta.postMarketPrice || meta.preMarketPrice || meta.regularMarketPrice;
            if (price && price > 0) return parseFloat(price);
        } catch (e) {
            console.warn(`프록시 실패 (${proxyUrl})`);
        }
    }
    return null;
}

// 3. 지표 실시간 계산 메인 로직
async function updateDashboard() {
    const statusEl = document.getElementById("dataStatus");
    if (statusEl) statusEl.textContent = "실시간 시세 업데이트 중...";

    try {
        // A. data.json 기본 자본 데이터 가져오기
        const dataRes = await fetch("./data.json?cache=" + Date.now());
        const data = await dataRes.json();

        // B. 실시간 시세 병렬 수집
        const [btcPrice, fetchedMstrPrice] = await Promise.all([
            fetchLiveBtcPrice(),
            fetchLiveMstrPrice()
        ]);

        if (btcPrice) {
            document.getElementById("btcPrice").value = btcPrice.toFixed(2);
        }

        // MSTR 주가 자동 수집 성공 시 입력창 업데이트, 실패 시 수동 입력값 유지
        let mstrPrice = fetchedMstrPrice;
        if (mstrPrice) {
            document.getElementById("mstrPrice").value = mstrPrice.toFixed(2);
        } else {
            mstrPrice = parseFloat(document.getElementById("mstrPrice").value) || 0;
        }

        // C. 주식수 위치 교정 (ADSO: 작은 값 ~298M, FDSO: 큰 값 ~424M)
        const rawVal1 = parseFloat(data.adso || 298.039);
        const rawVal2 = parseFloat(data.fdso || 424.479);
        
        const adso = Math.min(rawVal1, rawVal2);
        const fdso = Math.max(rawVal1, rawVal2);
        const fdsoShares = fdso * 1_000_000;

        // 자본 항목 파싱
        const currentBtcPrice = parseFloat(document.getElementById("btcPrice").value) || 0;
        const btcHoldings = parseFloat(data.btcHoldings || 845050);
        const usdAssets = parseFloat(data.usdAssetsUsdB || 6.690) * 1_000_000_000;
        const debt = parseFloat(data.debtUsdB || 6.754) * 1_000_000_000;
        const preferred = parseFloat(data.preferredUsdB || 14.966) * 1_000_000_000;

        // D. HTML 입력창 세팅
        document.getElementById("btcHoldings").value = btcHoldings;
        document.getElementById("assumedShares").value = adso.toFixed(3);
        document.getElementById("fullyDilutedShares").value = fdso.toFixed(3);

        if (currentBtcPrice <= 0) return;

        // E. 핵심 지표 계산
        const btcValueUsd = btcHoldings * currentBtcPrice;
        const grossBpsUsd = btcValueUsd / fdsoShares;
        const grossBpsSats = (btcHoldings / fdsoShares) * 100_000_000;

        const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
        const netBpsUsd = netReserveUsd / fdsoShares;
        const netBtcHoldings = netReserveUsd / currentBtcPrice;
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
        document.getElementById("fdsoDisplay").textContent = `${fdso.toFixed(3)}M`;

        // G. mNAV 계산
        if (mstrPrice > 0 && netBpsUsd > 0) {
            const mnav = mstrPrice / netBpsUsd;
            const premiumPct = (mnav - 1) * 100;

            document.getElementById("mnavMultiple").textContent = `${mnav.toFixed(2)}×`;
            document.getElementById("premium").textContent = `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`;

            const signalEl = document.getElementById("signal");
            if (signalEl) {
                if (mnav < 1.0) signalEl.textContent = "🟢 저평가 구간 (mNAV < 1.0)";
                else if (mnav < 1.5) signalEl.textContent = "🟡 적정 매수 구간 (mNAV 1.0 ~ 1.5)";
                else if (mnav < 2.2) signalEl.textContent = "🟠 주의 구간 (mNAV 1.5 ~ 2.2)";
                else signalEl.textContent = "🔴 과열 구간 (mNAV 2.2+)";
            }
        } else {
            document.getElementById("mnavMultiple").textContent = "-";
            document.getElementById("premium").textContent = "MSTR 주가를 입력해 주세요";
        }

        if (statusEl) {
            const now = new Date();
            statusEl.textContent = `연동 완료 (${data.source || 'Strategy'} 기준) - ${now.toLocaleTimeString()}`;
        }

        updateScenarioTable(netBpsUsd, currentBtcPrice);

    } catch (error) {
        console.error("대시보드 업데이트 오류:", error);
        if (statusEl) statusEl.textContent = "데이터 불러오기 실패";
    }
}

// 4. 시나리오 테이블 작성
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

// 5. 목표가 계산 함수
async function targetPrice() {
    const targetBtc = parseFloat(document.getElementById("targetBtcPrice").value);
    const targetMnav = parseFloat(document.getElementById("targetMnav").value);
    const fdso = parseFloat(document.getElementById("fullyDilutedShares").value || 424.479) * 1_000_000;
    const btcHoldings = parseFloat(document.getElementById("btcHoldings").value || 845050);

    if (!targetBtc || !targetMnav) return;

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

// 6. 이벤트 리스너 등록
document.addEventListener("DOMContentLoaded", () => {
    updateDashboard();
    
    // 수동 입력 시 즉시 반응
    document.getElementById("mstrPrice")?.addEventListener("input", updateDashboard);
    document.getElementById("btcPrice")?.addEventListener("input", updateDashboard);

    setInterval(updateDashboard, 10000);
});
