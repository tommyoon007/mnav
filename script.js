// =========================================================
// MSTR mNAV & BTC FUTURES DASHBOARD - HYBRID REAL-TIME SCRIPT
// Portfolio Sync: 97 Shares @ $173.65
// =========================================================

const FINNHUB_KEY = "daaruppr01qn50rjdv2gdaaruppr01qn50rjdv30";

// Strategy/SEC 기준 올바른 재무 데이터
const DEFAULT_DATA = {
    btcHoldings: 845050,
    adso: 298.039,
    fdso: 424.479,
    usdAssetsUsdB: 6.690,
    debtUsdB: 6.754,
    preferredUsdB: 14.966,
    fallbackBtcPrice: 95000,
    fallbackMstrPrice: 130
};

let currentData = { ...DEFAULT_DATA };

// --- 유틸리티 함수 ---
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

async function fetchWithTimeout(url, timeoutMs = 3000, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        return null;
    }
}

// --- REST API 백업 데이터 수집 ---

// 1. 실시간 BTC 가격 백업 (Coinbase -> Binance)
async function fetchLiveBtcPrice() {
    try {
        const res = await fetchWithTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD", 3000);
        if (res && res.ok) {
            const data = await res.json();
            const p = parseFloat(data?.data?.amount);
            if (p > 0) return p;
        }
    } catch (e) {}

    try {
        const res = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", 3000);
        if (res && res.ok) {
            const data = await res.json();
            const p = parseFloat(data?.price);
            if (p > 0) return p;
        }
    } catch (e) {}

    return null;
}

// 2. 실시간 MSTR 주가 백업 (Yahoo Finance Proxy -> Finnhub)
async function fetchLiveMstrPrice() {
    try {
        const targetUrl = "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&range=1d";
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetchWithTimeout(proxyUrl, 3000);
        if (res && res.ok) {
            const data = await res.json();
            const meta = data?.chart?.result?.[0]?.meta;
            
            // 프리마켓 -> 애프터마켓 -> 정규장 순으로 존재하는 가격을 우선 적용
            const price = meta?.preMarketPrice || meta?.postMarketPrice || meta?.regularMarketPrice;
            
            if (price && price > 0) return parseFloat(price);
        }
    } catch (e) {}

    if (FINNHUB_KEY) {
        try {
            const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=MSTR&token=${FINNHUB_KEY}`, 3000);
            if (res && res.ok) {
                const data = await res.json();
                const price = (data?.c > 0) ? data.c : data?.pc;
                if (price && price > 0) return parseFloat(price);
            }
        } catch (e) {}
    }
    return null;
}

// 3. BTC 선물 지표 (미체결약정 OI & 펀딩비) 수집
async function fetchFuturesData() {
    let fundingRate = null;
    let openInterest = null;

    try {
        const [resFR, resOI] = await Promise.all([
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", 3000),
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", 3000)
        ]);

        if (resFR && resFR.ok) {
            const data = await resFR.json();
            if (data.lastFundingRate !== undefined) {
                fundingRate = (parseFloat(data.lastFundingRate) * 100).toFixed(4) + "%";
            }
        }
        if (resOI && resOI.ok) {
            const data = await resOI.json();
            if (data.openInterest !== undefined) {
                const oiBtc = parseFloat(data.openInterest);
                openInterest = (oiBtc / 1000).toFixed(1) + "k ₿";
            }
        }
    } catch (e) {}

    if (!fundingRate || !openInterest) {
        try {
            const res = await fetchWithTimeout("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT", 3000);
            if (res && res.ok) {
                const json = await res.json();
                const item = json?.result?.list?.[0];
                if (item) {
                    if (!fundingRate && item.fundingRate) fundingRate = (parseFloat(item.fundingRate) * 100).toFixed(4) + "%";
                    if (!openInterest && item.openInterest) openInterest = (parseFloat(item.openInterest) / 1000).toFixed(1) + "k ₿";
                }
            }
        } catch (e) {}
    }
    return { fundingRate, openInterest };
}

// --- WebSocket 실시간 데이터 스트림 ---

function initBtcWebSocket() {
    const btcWs = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");
    
    btcWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data && data.p) {
            setVal("btcPrice", parseFloat(data.p).toFixed(2));
            calculateDashboard(currentData);
        }
    };
    
    btcWs.onerror = () => console.warn("BTC WebSocket 오류, REST API로 대체됩니다.");
}

function initMstrWebSocket() {
    if (!FINNHUB_KEY) return;
    const mstrWs = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
    
    mstrWs.onopen = () => mstrWs.send(JSON.stringify({ type: 'subscribe', symbol: 'MSTR' }));
    
    mstrWs.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.type === 'trade' && response.data && response.data[0]) {
            const liveMstr = parseFloat(response.data[0].p);
            if (liveMstr > 0) {
                setVal("mstrPrice", liveMstr.toFixed(2));
                calculateDashboard(currentData);
            }
        }
    };
    
    mstrWs.onerror = () => console.warn("MSTR WebSocket 오류, REST API로 대체됩니다.");
}

// --- UI 업데이트 및 계산 ---

function updateCardValue(possibleIds, labelText, valueText) {
    if (!valueText) return;
    for (const id of possibleIds) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = valueText;
            return;
        }
    }
    const cards = document.querySelectorAll('.card, .result-card, div');
    cards.forEach(card => {
        if (card.textContent.includes(labelText)) {
            const target = card.querySelector('.result-value, .value, strong, div:last-child');
            if (target) target.textContent = valueText;
        }
    });
}

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

window.targetPrice = function() {
    const targetBtc = getNum("targetBtcPrice");
    const targetMnav = getNum("targetMnav");

    if (targetBtc > 0) localStorage.setItem("savedTargetBtc", targetBtc);
    if (targetMnav > 0) localStorage.setItem("savedTargetMnav", targetMnav);
    if (!targetBtc || !targetMnav) return;

    const fdso = getNum("fullyDilutedShares") || currentData.fdso;
    const btcHoldings = getNum("btcHoldings") || currentData.btcHoldings;
    const fdsoShares = fdso * 1_000_000;
    const usdAssets = currentData.usdAssetsUsdB * 1_000_000_000;
    const debt = currentData.debtUsdB * 1_000_000_000;
    const preferred = currentData.preferredUsdB * 1_000_000_000;

    const netBpsUsd = (btcHoldings * targetBtc + usdAssets - debt - preferred) / fdsoShares;
    const predictedMstr = netBpsUsd * targetMnav;

    setText("predictedMstrPrice", `$${predictedMstr.toFixed(2)}`);
    setText("predictedNetBps", `예상 Net BPS: $${netBpsUsd.toFixed(2)}`);
};

function calculateDashboard(data = currentData) {
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

// 7. 메인 데이터 업데이트 로직 (REST/JSON 백업용)
async function updateDashboard() {
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
        }
    } catch (e) {}

    if (currentData.adso > currentData.fdso) {
        const temp = currentData.adso;
        currentData.adso = currentData.fdso;
        currentData.fdso = temp;
    }

    setVal("btcHoldings", currentData.btcHoldings);
    setVal("assumedShares", currentData.adso.toFixed(3));
    setVal("fullyDilutedShares", currentData.fdso.toFixed(3));

    try {
        const [fetchedBtc, fetchedMstr, futures] = await Promise.all([
            fetchLiveBtcPrice(),
            fetchLiveMstrPrice(),
            fetchFuturesData()
        ]);

        // WebSocket 값이 아직 없을 때만 REST API 값을 입력창에 반영
        const currentBtcInput = getNum("btcPrice");
        if (fetchedBtc && fetchedBtc > 0 && currentBtcInput <= 0) {
            setVal("btcPrice", fetchedBtc.toFixed(2));
        }

        const currentMstrInput = getNum("mstrPrice");
        if (fetchedMstr && fetchedMstr > 0 && currentMstrInput <= 0) {
            setVal("mstrPrice", fetchedMstr.toFixed(2));
        }

        if (futures.fundingRate) updateCardValue(["fundingRate", "fundingRateValue", "frValue"], "Funding Rate", futures.fundingRate);
        if (futures.openInterest) updateCardValue(["btcOi", "btcOiValue", "oiValue"], "BTC OI", futures.openInterest);

        const now = new Date();
        setText("dataStatus", `하이브리드 실시간 연동 중 (${now.toTimeString().split(' ')[0]})`);
    } catch (e) {
        setText("dataStatus", "실시간 시세 연동 대기 중");
    }

    calculateDashboard(currentData);
}

// --- 초기화 ---
document.addEventListener("DOMContentLoaded", async () => {
    const savedBtc = localStorage.getItem("savedTargetBtc");
    const savedMnav = localStorage.getItem("savedTargetMnav");
    if (savedBtc) setVal("targetBtcPrice", savedBtc);
    if (savedMnav) setVal("targetMnav", savedMnav);

    // 최초 1회 공시 데이터 및 REST 가격 로드
    await updateDashboard();

    // 양방향 WebSocket 스트림 개설 (핵심)
    initBtcWebSocket();
    initMstrWebSocket();

    // 수동 입력 창 이벤트 리스너 등록
    document.getElementById("targetBtcPrice")?.addEventListener("input", window.targetPrice);
    document.getElementById("targetMnav")?.addEventListener("input", window.targetPrice);
    document.getElementById("mstrPrice")?.addEventListener("input", () => calculateDashboard(currentData));
    document.getElementById("btcPrice")?.addEventListener("input", () => calculateDashboard(currentData));

    // 공시 데이터 및 펀딩비 10초 주기 백업 갱신
    setInterval(updateDashboard, 10000);

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) updateDashboard();
    });
});
