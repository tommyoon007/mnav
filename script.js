// =========================================================
// MSTR mNAV DASHBOARD - TAILORED SCRIPT FOR ORIGINAL HTML
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

// data.json 로드 실패 시 백업용 기본 데이터
const DEFAULT_DATA = {
    btcHoldings: 845050,
    adso: 298.039,
    fdso: 424.479,
    usdAssetsUsdB: 6.690,
    debtUsdB: 6.754,
    preferredUsdB: 14.966
};

// 요소에 안전하게 텍스트 대입
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// input 요소에 안전하게 값 대입 (사용자 입력 중 방해 안함)
function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) {
        if (document.activeElement !== el) {
            el.value = val;
        }
    }
}

// 태그 종류 상관없이 숫자로 변환해 추출
function getNum(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const val = el.value !== undefined && el.value !== "" ? el.value : el.textContent;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
}

// API 호출 시 무한 대기 방지용 (4초 타임아웃)
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 4000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        return null;
    }
}

// 1. 실시간 BTC 가격 수집 (코인베이스 -> 바이낸스)
async function fetchLiveBtcPrice() {
    try {
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD");
        if (res && res.ok) {
            const json = await res.json();
            const price = parseFloat(json?.data?.amount);
            if (price > 0) return price;
        }
    } catch (e) {}

    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        if (res && res.ok) {
            const json = await res.json();
            const price = parseFloat(json?.price);
            if (price > 0) return price;
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
            const json = await res.json();
            if (json && json.c && json.c > 0) return parseFloat(json.c);
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

// 4. MSTR 목표가 예측 계산 (HTML button onclick 전역 연결)
window.targetPrice = async function() {
    const targetBtc = getNum("targetBtcPrice");
    const targetMnav = getNum("targetMnav");

    if (targetBtc > 0) localStorage.setItem("savedTargetBtc", targetBtc);
    if (targetMnav > 0) localStorage.setItem("savedTargetMnav", targetMnav);

    if (!targetBtc || !targetMnav) return;

    let fdso = getNum("fullyDilutedShares") || DEFAULT_DATA.fdso;
    let btcHoldings = getNum("btcHoldings") || DEFAULT_DATA.btcHoldings;

    let usdAssetsUsdB = DEFAULT_DATA.usdAssetsUsdB;
    let debtUsdB = DEFAULT_DATA.debtUsdB;
    let preferredUsdB = DEFAULT_DATA.preferredUsdB;

    try {
        const res = await fetchWithTimeout("./data.json?cache=" + Date.now(), { timeout: 2000 });
        if (res && res.ok) {
            const data = await res.json();
            usdAssetsUsdB = parseFloat(data.usdAssetsUsdB) || usdAssetsUsdB;
            debtUsdB = parseFloat(data.debtUsdB) || debtUsdB;
            preferredUsdB = parseFloat(data.preferredUsdB) || preferredUsdB;
        }
    } catch (e) {}

    const fdsoShares = fdso * 1_000_000;
    const usdAssets = usdAssetsUsdB * 1_000_000_000;
    const debt = debtUsdB * 1_000_000_000;
    const preferred = preferredUsdB * 1_000_000_000;

    const netBpsUsd = (btcHoldings * targetBtc + usdAssets - debt - preferred) / fdsoShares;
    const predictedMstr = netBpsUsd * targetMnav;

    setText("predictedMstrPrice", `$${predictedMstr.toFixed(2)}`);
    setText("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
};

// 5. 메인 대시보드 업데이트 로직
async function updateDashboard() {
    try {
        let data = { ...DEFAULT_DATA };

        // data.json 로드
        try {
            const res = await fetchWithTimeout("./data.json?cache=" + Date.now(), { timeout: 2000 });
            if (res && res.ok) {
                const json = await res.json();
                data.btcHoldings = parseFloat(json.btcHoldings) || data.btcHoldings;
                data.adso = parseFloat(json.adso) || data.adso;
                data.fdso = parseFloat(json.fdso) || data.fdso;
                data.usdAssetsUsdB = parseFloat(json.usdAssetsUsdB) || data.usdAssetsUsdB;
                data.debtUsdB = parseFloat(json.debtUsdB) || data.debtUsdB;
                data.preferredUsdB = parseFloat(json.preferredUsdB) || data.preferredUsdB;
            }
        } catch (e) {}

        // 실시간 시세 로드
        const [fetchedBtc, fetchedMstr] = await Promise.all([
            fetchLiveBtcPrice(),
            fetchLiveMstrPrice()
        ]);

        if (fetchedBtc && fetchedBtc > 0) setVal("btcPrice", fetchedBtc.toFixed(2));
        if (fetchedMstr && fetchedMstr > 0) setVal("mstrPrice", fetchedMstr.toFixed(2));

        setVal("btcHoldings", data.btcHoldings);
        setVal("assumedShares", data.adso.toFixed(3));
        setVal("fullyDilutedShares", data.fdso.toFixed(3));

        const btcPrice = getNum("btcPrice");
        const mstrPrice = getNum("mstrPrice");

        if (btcPrice <= 0) return;

        const fdsoShares = data.fdso * 1_000_000;
        const usdAssets = data.usdAssetsUsdB * 1_000_000_000;
        const debt = data.debtUsdB * 1_000_000_000;
        const preferred = data.preferredUsdB * 1_000_000_000;

        // 핵심 계산
        const btcValueUsd = data.btcHoldings * btcPrice;
        const grossBpsUsd = btcValueUsd / fdsoShares;
        const grossBpsSats = (data.btcHoldings / fdsoShares) * 100_000_000;

        const netReserveUsd = btcValueUsd + usdAssets - debt - preferred;
        const netBpsUsd = netReserveUsd / fdsoShares;
        const netBtcHoldings = netReserveUsd / btcPrice;
        const netBpsSats = (netBtcHoldings / fdsoShares) * 100_000_000;

        // HTML 태그와 일치하게 결과 표시
        setText("grossBpsSats", Math.round(grossBpsSats).toLocaleString());
        setText("netBpsSats", Math.round(netBpsSats).toLocaleString());
        setText("netBpsUsd", `$${netBpsUsd.toFixed(2)}`);
        setText("btcTotalValue", `$${(btcValueUsd / 1_000_000_000).toFixed(2)}B`);
        setText("seniorClaims", `$${((debt + preferred) / 1_000_000_000).toFixed(2)}B`);
        setText("reserveValue", `$${(usdAssets / 1_000_000_000).toFixed(2)}B`);
        setText("netBtc", `${Math.round(netBtcHoldings).toLocaleString()} ₿`);
        setText("grossBpsUsd", `$${grossBpsUsd.toFixed(2)}`);
        setText("fdsoDisplay", `${data.fdso.toFixed(3)}M`);

        if (mstrPrice > 0 && netBpsUsd > 0) {
            const mnav = mstrPrice / netBpsUsd;
            const premiumPct = (mnav - 1) * 100;

            setText("mnavMultiple", `${mnav.toFixed(2)}×`);
            setText("premium", `프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`);

            // 투자 시그널 처리
            let signalText = "🟡 중립 (적정 주가 구간)";
            if (mnav < 1.0) signalText = "🟢 극심한 저평가 (NAV 대비 할인)";
            else if (mnav > 2.5) signalText = "🔴 과열 주의 (높은 프리미엄)";
            setText("signal", signalText);
        }

        // 상태 표시 영역 갱신
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        setText("dataStatus", `최신 데이터 연결됨 (${timeStr})`);

        updateScenarioTable(netBpsUsd, btcPrice);
        window.targetPrice();

    } catch (e) {
        setText("dataStatus", "데이터 동기화 재시도 중...");
    }
}

// 이벤트 및 자동 실행 설정
document.addEventListener("DOMContentLoaded", () => {
    const savedBtc = localStorage.getItem("savedTargetBtc");
    const savedMnav = localStorage.getItem("savedTargetMnav");
    if (savedBtc) setVal("targetBtcPrice", savedBtc);
    if (savedMnav) setVal("targetMnav", savedMnav);

    updateDashboard();

    // 입력값 변경 시 자동 계산
    document.getElementById("targetBtcPrice")?.addEventListener("input", window.targetPrice);
    document.getElementById("targetMnav")?.addEventListener("input", window.targetPrice);
    document.getElementById("mstrPrice")?.addEventListener("input", updateDashboard);
    document.getElementById("btcPrice")?.addEventListener("input", updateDashboard);

    // 10초 주기 오토 업데이트
    setInterval(updateDashboard, 10000);

    // 모바일 탭 복귀 시 즉시 다시 불러오기
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) updateDashboard();
    });
});
