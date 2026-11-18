// ── 시세를 가져오는 경로 ─────────────────────────────────────────────
// 이 파일에는 어떤 API 키도 넣지 않습니다. (공개 페이지 소스는 누구나 볼 수 있습니다)
//   1) 저장소의 live.json : 워크플로가 서버에서 갱신해 두는 최신 시세 (같은 출처라 CORS 없음)
//   2) 공개 시세 API      : 브라우저에서 직접 호출 (BTC=Coinbase/Binance, MSTR=Yahoo Finance)
// (선택) 자기 Finnhub 키를 쓰고 싶을 때만, 이 브라우저에만 저장해서 쓰면 됩니다:
//   ① 주소창에  https://tommyoon007.github.io/mnav/?finnhub=발급받은_키  로 한 번 열면 저장되고 키는 주소창에서 지워집니다.
//   ② 콘솔에서  localStorage.setItem("mstr_app_finnhubKey", "발급받은_키")
const FINNHUB_KEY_STORAGE = "mstr_app_finnhubKey";

// 사용자가 브라우저에만 저장해 둔 Finnhub 키 (없으면 null). 코드/저장소에는 남지 않습니다.
function getUserFinnhubKey() {
    try {
        const key = localStorage.getItem(FINNHUB_KEY_STORAGE);
        return key && key.trim() ? key.trim() : null;
    } catch (e) {
        return null;
    }
}

// 저장소 live.json (워크플로가 서버에서 갱신) — 같은 출처라 프록시 없이 읽힙니다.
// live.json 이 비어 있으면 history.json 의 마지막 기록(하루 단위)을 쓴다.
async function fetchRepoLivePrices() {
    try {
        const res = await fetchWithTimeout("live.json?_=" + Date.now(), 3000, { cache: "no-store" });
        if (res && res.ok) {
            const data = await res.json();
            const btcPrice = Number(data?.btcPrice);
            const mstrPrice = Number(data?.mstrPrice);
            if ((Number.isFinite(btcPrice) && btcPrice > 0) || (Number.isFinite(mstrPrice) && mstrPrice > 0)) {
                return {
                    btcPrice: Number.isFinite(btcPrice) && btcPrice > 0 ? btcPrice : null,
                    mstrPrice: Number.isFinite(mstrPrice) && mstrPrice > 0 ? mstrPrice : null,
                    updatedAt: data?.updatedAt || null
                };
            }
        }
    } catch (e) {}

    // 마지막 수단: history.json 의 가장 최근 기록
    try {
        const res = await fetchWithTimeout("history.json?_=" + Date.now(), 4000, { cache: "no-store" });
        if (!res || !res.ok) return null;
        const rows = await res.json();
        const last = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
        if (!last) return null;
        const btcPrice = Number(last.btc);
        const mstrPrice = Number(last.mstr);
        if (!(btcPrice > 0) && !(mstrPrice > 0)) return null;
        return {
            btcPrice: btcPrice > 0 ? btcPrice : null,
            mstrPrice: mstrPrice > 0 ? mstrPrice : null,
            updatedAt: last.timestamp || null
        };
    } catch (e) {
        return null;
    }
}

// MicroStrategy (Strategy.com) 기준 주요 재무 데이터 Default
const DEFAULT_DATA = {
    btcHoldings: 845050,      // 보유 BTC 수량
    adso: 298.039,           // Basic Shares (M)
    fdso: 424.479,           // Fully Diluted Shares (M)
    usdAssetsUsdB: 4.900,    // 현금 및 USD 자산 ($B) — Strategy.com USD Reserve 4,749 + USD Cash 151
    debtUsdB: 6.714,         // 총 부채 ($B) — Strategy.com Debt 6,714
    preferredUsdB: 12.709    // 우선주/Convertible Preferred ($B) — Strategy.com Pref 12,709
};

let currentData = { ...DEFAULT_DATA };
let futuresChartInstance = null;
let currentTf = '1M'; 
let updateTimer = null;
let autoSyncEnabled = true;

const USER_STORAGE_KEYS = ["btcHoldings", "assumedShares", "fullyDilutedShares", "targetBtcPrice", "targetMnav", "btcPrice", "mstrPrice"];

// LocalStorage 저장/불러오기
function saveInputsToStorage() {
    USER_STORAGE_KEYS.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value.trim() !== "") {
            localStorage.setItem("mstr_app_" + id, el.value.trim());
        }
    });
}

function loadInputsFromStorage() {
    USER_STORAGE_KEYS.forEach(id => {
        const saved = localStorage.getItem("mstr_app_" + id);
        const el = document.getElementById(id);
        if (saved !== null && saved.trim() !== "" && el) {
            el.value = saved;
        }
    });
}

// ── 기초지표(data.json) 자동 반영 ───────────────────────────────────────────
// 워크플로가 Strategy의 주간 8-K 기준으로 data.json 을 갱신하면 앱은 시작할 때 그 값을 읽어
// 현금·부채·우선주 3개를 currentData 에 채운다. 이 3개만 data.json 을 따른다.
// BTC 보유량(btcHoldings)·ADSO(assumedShares)·FDSO(fullyDilutedShares)는 사용자가 직접 확인해
// 입력한 값이므로 data.json 의 updatedAt·동기화 여부와 관계없이 절대 건드리지 않는다
// (localStorage mstr_app_* 값과 입력칸 값이 그대로 유지된다).
const FUNDAMENTALS_FIELDS = [
    { key: "usdAssetsUsdB" },
    { key: "debtUsdB" },
    { key: "preferredUsdB" }
];

function toFiniteNumber(value) {
    const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
    return Number.isFinite(num) ? num : null;
}

async function applyFundamentalsFromDataJson() {
    const res = await fetchWithTimeout("data.json?_=" + Date.now(), 5000, { cache: "no-store" });
    if (!res || !res.ok) return false;
    let snapshot = null;
    try { snapshot = await res.json(); } catch (e) { return false; }
    return applyFundamentals(snapshot);
}

function applyFundamentals(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return false;

    const incoming = {};
    for (const field of FUNDAMENTALS_FIELDS) {
        const value = toFiniteNumber(snapshot[field.key]);
        if (value === null) return false;   // 현금·부채·우선주 3개 값이 다 있을 때만 반영한다
        incoming[field.key] = value;
    }

    // 사용자가 입력한 BTC 보유량·ADSO·FDSO 는 여기서 다루지 않는다(입력칸·localStorage 그대로 유지).
    let changed = false;
    for (const field of FUNDAMENTALS_FIELDS) {
        if (currentData[field.key] !== incoming[field.key]) {
            currentData[field.key] = incoming[field.key];
            changed = true;
        }
    }

    if (changed) recalculateOnly();
    return changed;
}

// Helper Functions
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
    const val = el.value !== undefined ? el.value : el.textContent; 
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, "")); 
    return isNaN(num) ? 0 : num; 
}

async function fetchWithTimeout(url, timeoutMs = 4000, options = {}) {
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

// 실시간 BTC 시세 (Coinbase -> Binance 순 fallback)
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
    try { 
        const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", 3000);
        if (res && res.ok) { 
            const data = await res.json(); 
            const p = parseFloat(data?.bitcoin?.usd); 
            if (p > 0) return p; 
        }
    } catch (e) {}
    return null;
}

// 주소창에 ?finnhub=발급받은키 를 붙여 열면 이 브라우저에만 키를 저장한다.
// 저장한 뒤에는 주소창에서 키를 지워서(history.replaceState) 뒤로가기·공유로 키가 새지 않게 한다.
function applyFinnhubKeyFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const rawKey = params.get("finnhub");
        if (rawKey === null) return;

        const key = rawKey.trim();
        if (key) localStorage.setItem(FINNHUB_KEY_STORAGE, key);

        params.delete("finnhub");
        const query = params.toString();
        const cleanUrl =
            window.location.pathname +
            (query ? "?" + query : "") +
            window.location.hash;
        window.history.replaceState(null, "", cleanUrl);
    } catch (e) {}
}

// 지금이 미국 동부 기준 주간거래(Overnight, Blue Ocean ATS) 시간대인지 확인한다.
// 주간거래는 일~목요일 밤 20:00 ~ 04:00 (ET) 에만 열린다.
function isUsOvernightSession(date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
            hour: "2-digit",
            hour12: false
        }).formatToParts(date);
        const pick = type => (parts.find(p => p.type === type) || {}).value;
        const weekday = pick("weekday");
        const hour = Number(pick("hour")) % 24;

        // 20:00 이후 시작 — 일·월·화·수·목요일 밤
        if (hour >= 20) return ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(weekday);
        // 04:00 이전 종료 — 월~금 새벽
        if (hour < 4) return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
        return false;
    } catch (e) {
        return false;
    }
}

// 미국 정규장(평일 09:30~16:00 America/New_York) 판정 — 서머타임은 Intl 이 자동 반영.
function isUsRegularSession(date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).formatToParts(date);
        const pick = type => (parts.find(p => p.type === type) || {}).value;
        const weekday = pick("weekday");
        if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday)) return false;
        const minutes = (Number(pick("hour")) % 24) * 60 + Number(pick("minute"));
        return minutes >= 570 && minutes < 960;
    } catch (e) {
        return false;
    }
}

// Yahoo Finance 가 돌려준 meta 에서 지금 보여줄 값을 고른다.
// 정규장 / 프리장 / 애프터장 / 주간거래 값 중 '가장 최근 시각'의 값을 쓴다.
// (장중인데 어제 애프터장 값이 남아 있어 그 값이 잡히는 경우를 막는다)
function pickLatestYahooQuote(meta) {
    if (!meta || typeof meta !== "object") return null;

    const candidates = [
        { price: Number(meta.regularMarketPrice), time: Number(meta.regularMarketTime) || 0 },
        { price: Number(meta.postMarketPrice), time: Number(meta.postMarketTime) || 0 },
        { price: Number(meta.preMarketPrice), time: Number(meta.preMarketTime) || 0 }
    ];

    // 주간거래 시간대에는 차트 API meta 의 fulldayPrice 가 주간거래(Blue Ocean) 최근
    // 체결가를 담는다. (별도 페이지 파싱 없이 이미 받아 온 응답에서 바로 얻는다)
    // 정규장·프리마켓·애프터마켓이 더 최신이면 아래 시각 비교에서 그 값이 우선한다.
    if (isUsOvernightSession()) {
        const overnightPrice = Number(meta.fulldayPrice);
        const latestKnownTime = candidates.reduce((max, c) => Math.max(max, c.time), 0);
        if (Number.isFinite(overnightPrice) && overnightPrice > 0) {
            candidates.push({ price: overnightPrice, time: latestKnownTime + 1 });
        }
    }

    let picked = null;
    for (const c of candidates) {
        if (!Number.isFinite(c.price) || c.price <= 0) continue;
        if (!picked || c.time > picked.time) picked = c;
    }

    // 이전 종가 chartPreviousClose / previousClose 는 쓰지 않는다.
    return picked ? { price: picked.price, time: picked.time } : null;
}

function parseYahooChartMeta(data) {
    let body = data;

    // allorigins 의 /get 은 본문을 contents 문자열로 감싸서 준다.
    if (body && typeof body === "object" && typeof body.contents === "string") {
        try { body = JSON.parse(body.contents); } catch (e) { return null; }
    } else if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (e) { return null; }
    }

    const meta = body && body.chart && body.chart.result && body.chart.result[0] && body.chart.result[0].meta;
    return meta && typeof meta === "object" ? meta : null;
}

// 무료 CORS 프록시는 수시로 막히므로, query1/query2 를 여러 프록시로 동시에 호출한다.
const YAHOO_CHART_PATH = "/v8/finance/chart/MSTR?interval=1m&range=1d&includePrePost=true";
const YAHOO_PROXY_TIMEOUT_MS = 4000;
const YAHOO_PROXY_ROUNDS = 2;

function buildYahooProxyUrls(round) {
    const stamp = `${Date.now()}${round}`;
    const q1Url = `https://query1.finance.yahoo.com${YAHOO_CHART_PATH}&_=${stamp}`;
    const q2Url = `https://query2.finance.yahoo.com${YAHOO_CHART_PATH}&_=${stamp}`;
    const q1 = encodeURIComponent(q1Url);
    const q2 = encodeURIComponent(q2Url);

    return [
        `https://proxy.cors.dev/${q1Url}`,      // 키 없이 600회/분
        `https://cors.tools/proxy?url=${q2}`,   // 키 없이 GET
        `https://api.allorigins.win/raw?url=${q1}`,
        `https://api.allorigins.win/get?url=${q2}`,
        `https://api.cors.lol/?url=${q1}`
    ];
}

async function fetchYahooPrice(proxyUrl) {
    try {
        const res = await fetchWithTimeout(proxyUrl, YAHOO_PROXY_TIMEOUT_MS, { cache: "no-store" });
        if (!res || !res.ok) return null;

        let data;
        try { data = await res.json(); } catch (e) { return null; }

        return pickLatestYahooQuote(parseYahooChartMeta(data));
    } catch (e) {
        return null;
    }
}

// 여러 프록시를 동시에 던지고, 응답 중 '가장 최근 시각'의 값을 쓴다. 한 번 더 시도한다.
// (프록시가 오래된 값을 캐시해 돌려주면 그 값이 먼저 도착해도 밀려나게 하기 위함)
// 모두 실패하면 1분 동안은 프록시 호출을 쉬어(과도한 요청으로 막히지 않게) live.json 값을 유지한다.
let yahooRetryAfter = 0;
let yahooLastPrice = { price: null, at: 0 };

async function fetchLiveMstrFromYahoo() {
    // 방금 받은 값이 있으면 프록시를 다시 부르지 않고 그대로 쓴다 (요청량 절반).
    if (yahooLastPrice.price && Date.now() - yahooLastPrice.at < 20000) return yahooLastPrice.price;
    if (Date.now() < yahooRetryAfter) return null;

    for (let round = 0; round < YAHOO_PROXY_ROUNDS; round++) {
        const urls = buildYahooProxyUrls(round);

        const quote = await new Promise(resolve => {
            const quotes = [];
            let remaining = urls.length;
            let settled = false;
            let graceTimer = null;

            const freshest = () => quotes.reduce((best, q) => (!best || q.time > best.time ? q : best), null);
            const finish = () => {
                if (settled) return;
                settled = true;
                if (graceTimer) clearTimeout(graceTimer);
                resolve(freshest());
            };

            urls.forEach(url => {
                fetchYahooPrice(url).then(q => {
                    if (settled || !q) return;
                    quotes.push(q);
                    // 첫 성공 후 1.2초만 더 기다려 더 새 값을 고른다.
                    if (!graceTimer) graceTimer = setTimeout(finish, 1200);
                }).catch(() => {}).finally(() => {
                    remaining -= 1;
                    if (remaining === 0) finish();
                });
            });
        });

        if (quote) {
            yahooLastPrice = { price: quote.price, at: Date.now() };
            return quote.price;
        }
    }

    yahooRetryAfter = Date.now() + 60000;

    // 이번에 실패해도 3분 안에 받아 둔 값이 있으면 그 값을 계속 쓴다
    // (live.json 스냅샷이 더 오래된 경우가 많아서, 화면이 옛 값으로 되돌아가지 않게).
    if (yahooLastPrice.price && Date.now() - yahooLastPrice.at < 180000) return yahooLastPrice.price;

    return null;
}

// 실시간 MSTR 주가
// 정규장(평일 09:30~16:00 ET)에는 1차: (선택) 사용자가 자기 브라우저에만 저장해 둔 Finnhub 키
//                             2차: Yahoo Finance (CORS 프록시 여러 개를 동시에 경유)
// 정규장 외(프리마켓·애프터마켓·주간거래·주말)에는 1차: Yahoo Finance, 2차: 저장된 Finnhub 키
// (Finnhub quote 는 정규장 체결가만 주므로 장외 시세를 놓친다)
// 모두 실패하면 null → 저장소 live.json 값이 그대로 표시됩니다.
async function fetchLiveMstrPrice() {
    const userKey = getUserFinnhubKey();

    const fromFinnhub = async () => {
        if (!userKey) return null;
        try {
            const finnhubUrl =
                `https://finnhub.io/api/v1/quote?symbol=MSTR&token=${encodeURIComponent(userKey)}&_=${Date.now()}`;

            const res = await fetchWithTimeout(finnhubUrl, 4000);

            if (res && res.ok) {
                const data = await res.json();
                const price = Number(data?.c);

                // 현재가 c만 사용
                // 이전 종가 pc는 사용하지 않음
                if (Number.isFinite(price) && price > 0) {
                    return price;
                }
            }
        } catch (e) {}
        return null;
    };

    // 정규장 중: 저장된 Finnhub 키 우선 → 실패 시 Yahoo
    if (isUsRegularSession()) {
        const finnhubPrice = await fromFinnhub();
        if (finnhubPrice) return finnhubPrice;

        const yahooPrice = await fetchLiveMstrFromYahoo();
        if (yahooPrice) return yahooPrice;
    } else {
        // 정규장 외: Yahoo(장외 시세) 우선 → 실패 시 저장된 Finnhub 키
        const yahooPrice = await fetchLiveMstrFromYahoo();
        if (yahooPrice) return yahooPrice;

        const finnhubPrice = await fromFinnhub();
        if (finnhubPrice) return finnhubPrice;
    }

    // 모든 경로 실패 시 null 반환 → 화면은 live.json 스냅샷 값을 유지
    return null;
}

// 공포탐욕 지수
async function fetchFearAndGreed() {
    try {
        const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1", 3000);
        if (res && res.ok) {
            const data = await res.json();
            return parseInt(data.data[0].value);
        }
    } catch (e) {}
    return null;
}

// 선물 실시간 데이터 (Binance + Bybit Fallback)
async function fetchFuturesData() {
    let fundingRate = null, openInterest = null, lsRatio = null, rawFr = 0, rawOi = 0, rawLs = 1.0;
    
    try {
        const [resFR, resOI, resLS] = await Promise.all([
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT", 3000),
            fetchWithTimeout("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT", 3000),
            fetchWithTimeout("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1", 3000)
        ]);

        if (resFR && resFR.ok) { 
            const dataFR = await resFR.json(); 
            if (dataFR.lastFundingRate !== undefined) { 
                rawFr = parseFloat(dataFR.lastFundingRate); 
                fundingRate = (rawFr * 100).toFixed(4) + "%"; 
            } 
        }
        if (resOI && resOI.ok) { 
            const dataOI = await resOI.json(); 
            if (dataOI.openInterest !== undefined) { 
                rawOi = parseFloat(dataOI.openInterest); 
                openInterest = (rawOi / 1000).toFixed(1) + "K BTC"; 
            } 
        }
        if (resLS && resLS.ok) { 
            const dataLS = await resLS.json(); 
            if (dataLS[0] && dataLS[0].longShortRatio !== undefined) { 
                rawLs = parseFloat(dataLS[0].longShortRatio); 
                lsRatio = rawLs.toFixed(2); 
            } 
        }
    } catch (e) {}

    // Bybit Fallback
    if (!fundingRate || !openInterest) {
        try {
            const resBybit = await fetchWithTimeout("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT", 3000);
            if (resBybit && resBybit.ok) {
                const dataBybit = await resBybit.json();
                const item = dataBybit?.result?.list?.[0];
                if (item) {
                    if (!fundingRate && item.fundingRate) {
                        rawFr = parseFloat(item.fundingRate);
                        fundingRate = (rawFr * 100).toFixed(4) + "%";
                    }
                    if (!openInterest && item.openInterest) {
                        rawOi = parseFloat(item.openInterest);
                        openInterest = (rawOi / 1000).toFixed(1) + "K BTC";
                    }
                }
            }
        } catch (e) {}
    }
    
    return { fundingRate, openInterest, lsRatio, rawFr, rawOi, rawLs };
}

// 선물 히스토리 수집
async function fetchFuturesHistory(tf = '1M') {
    let interval = '2h', period = '2h', limit = 360, frLimit = 90;
    
    if (tf === '1D') { interval = '5m'; period = '5m'; limit = 288; frLimit = 24; } 
    else if (tf === '1W') { interval = '1h'; period = '1h'; limit = 168; frLimit = 21; }
    else if (tf === '1M') { interval = '2h'; period = '2h'; limit = 360; frLimit = 90; } 
    else if (tf === '3M') { interval = '6h'; period = '6h'; limit = 360; frLimit = 270; } 
    else if (tf === '6M') { interval = '12h'; period = '12h'; limit = 360; frLimit = 540; } 
    else if (tf === '1Y') { interval = '1d'; period = '1d'; limit = 365; frLimit = 1000; } 
    else if (tf === 'MAX') { interval = '1d'; period = '1d'; limit = 1500; frLimit = 1000; }

    try {
        const klineUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
        const frUrl = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${frLimit}`;
        const oiUrl = `https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=${period}&limit=500`;
        const lsUrl = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${period}&limit=500`;

        const [resKline, resFR, resOI, resLS] = await Promise.all([
            fetchWithTimeout(klineUrl, 5000),
            fetchWithTimeout(frUrl, 5000),
            fetchWithTimeout(oiUrl, 5000),
            fetchWithTimeout(lsUrl, 5000)
        ]);

        if (!resKline || !resKline.ok) return null;
        const klines = await resKline.json(); 
        if (!Array.isArray(klines)) return null; 

        let frList = [], oiList = [], lsList = [];
        if (resFR && resFR.ok) { const parsed = await resFR.json(); if (Array.isArray(parsed)) frList = parsed; }
        if (resOI && resOI.ok) { const parsed = await resOI.json(); if (Array.isArray(parsed)) oiList = parsed; }
        if (resLS && resLS.ok) { const parsed = await resLS.json(); if (Array.isArray(parsed)) lsList = parsed; }

        const labels = [], frData = [], oiData = [], lsData = [];
        
        const findClosest = (list, timeKey, targetTs, maxDiff) => {
            if (!list || !list.length) return null;
            let closest = null, minDiff = Infinity;
            for (let i = list.length - 1; i >= 0; i--) {
                const itemTime = Number(list[i][timeKey]);
                const diff = Math.abs(itemTime - targetTs);
                if (diff < minDiff) { minDiff = diff; closest = list[i]; }
            }
            return minDiff <= maxDiff ? closest : null;
        };

        klines.forEach(k => {
            const ts = Number(k[0]); 
            const dateObj = new Date(ts);
            
            let dateStr = "";
            if (tf === '1D') {
                dateStr = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
            } else if (tf === '1Y' || tf === 'MAX') {
                dateStr = `${String(dateObj.getFullYear()).slice(2)}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getDate()).padStart(2, '0')}`;
            } else {
                dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()} ${dateObj.getHours().toString().padStart(2, '0')}:00`;
            }
            
            labels.push(dateStr);
            
            const cFr = findClosest(frList, 'fundingTime', ts, 24 * 60 * 60 * 1000);
            frData.push(cFr ? parseFloat(cFr.fundingRate) * 100 : null);
            
            const cOi = findClosest(oiList, 'timestamp', ts, 48 * 60 * 60 * 1000);
            oiData.push(cOi ? parseFloat(cOi.sumOpenInterest) / 1000 : null);
            
            const cLs = findClosest(lsList, 'timestamp', ts, 48 * 60 * 60 * 1000);
            lsData.push(cLs ? parseFloat(cLs.longShortRatio) : null);
        });
        
        return { labels, frData, oiData, lsData };
    } catch (e) { return null; }
}

// Chart.js 렌더링
function renderChart(chartData) {
    if (!chartData || !chartData.labels.length) return;
    const canvas = document.getElementById('futuresChart');
    if (!canvas) return;
    
    if (futuresChartInstance) { 
        futuresChartInstance.destroy(); 
        futuresChartInstance = null; 
    }

    const { labels, frData, oiData, lsData } = chartData;

    futuresChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { 
                    label: 'Funding Rate (%)', 
                    data: frData, 
                    borderColor: '#ff9f0a', 
                    backgroundColor: 'rgba(255, 159, 10, 0.1)', 
                    yAxisID: 'yFR', 
                    pointRadius: 0, 
                    borderWidth: 1.5, 
                    fill: true, 
                    tension: 0.2,
                    spanGaps: true
                },
                { 
                    label: 'Open Interest (K)', 
                    data: oiData, 
                    borderColor: '#58a6ff', 
                    backgroundColor: 'transparent', 
                    yAxisID: 'yOI', 
                    pointRadius: 0, 
                    borderWidth: 1.5, 
                    tension: 0.2,
                    spanGaps: true
                },
                { 
                    label: 'Long/Short Ratio', 
                    data: lsData, 
                    borderColor: '#3fb950', 
                    backgroundColor: 'transparent', 
                    yAxisID: 'yLS', 
                    pointRadius: 0, 
                    borderWidth: 1.5, 
                    tension: 0.2,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false,
            layout: { padding: { top: 10, bottom: 10, left: 5, right: 5 } },
            interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { labels: { color: '#8b949e', boxWidth: 12 } } 
            },
            scales: {
                x: { 
                    ticks: { color: '#8b949e', maxTicksLimit: 6 }, 
                    grid: { color: '#30363d' } 
                },
                yFR: { 
                    type: 'linear', 
                    display: true, 
                    position: 'left', 
                    grace: '15%',
                    ticks: { color: '#ff9f0a' }, 
                    grid: { color: '#30363d' } 
                },
                yOI: { 
                    type: 'linear', 
                    display: true, 
                    position: 'right', 
                    grace: '15%',
                    ticks: { color: '#58a6ff' }, 
                    grid: { drawOnChartArea: false } 
                },
                yLS: { 
                    type: 'linear', 
                    display: true, 
                    position: 'right', 
                    grace: '15%',
                    ticks: { color: '#3fb950' }, 
                    grid: { drawOnChartArea: false }
                }
            }
        }
    });
}

// 선물 위험도 진단
function determineFuturesRiskStage(fng, fr, premium, ls) {
    let score = 0;
    if (fng !== null) { 
        if (fng > 80) score += 3; else if (fng > 70) score += 2; else if (fng > 60) score += 1; else if (fng < 30) score -= 2; 
    }
    if (fr !== null) { 
        if (fr > 0.0005) score += 3; else if (fr > 0.0002) score += 2; else if (fr > 0.0001) score += 1; else if (fr < 0) score -= 1; 
    }
    if (premium !== null) { 
        if (premium > 2.5) score += 3; else if (premium > 2.0) score += 2; else if (premium > 1.5) score += 1; else if (premium < 1.0) score -= 2; 
    }
    if (ls !== null) { 
        if (ls > 2.5) score += 2; else if (ls > 1.5) score += 1; else if (ls < 0.8) score -= 1; 
    }
    
    if (score >= 8) return { stage: "🔥 5단계: 극단적 과열 (초고위험)", color: "#ff4d4d", text: "레버리지 포지션이 포화 상태이며 조정 임박 가능성이 매우 높습니다." };
    if (score >= 5) return { stage: "⚠️ 4단계: 과열 진입 (고위험)", color: "#ff9f0a", text: "시장 흥분도가 높으며 롱 스퀴즈(연쇄 청산) 위험이 증가하고 있습니다." };
    if (score >= 2) return { stage: "🟡 3단계: 상승세 (중위험)", color: "#f1e05a", text: "일반적인 강세장 수준으로 레버리지가 적절히 쌓이고 있습니다." };
    if (score >= -2) return { stage: "🟢 2단계: 안정적 (저위험)", color: "#3fb950", text: "과도한 레버리지가 해소된 안정적인 시장 상태입니다." };
    return { stage: "🧊 1단계: 극도의 공포 (침체)", color: "#58a6ff", text: "시장이 심하게 위축되었으며 숏 포지션이 지배적인 딥(Dip) 상태일 수 있습니다." };
}

// Strategy.com 기준 MNAV 산출 및 화면 업데이트
function calculateMNAV() {
    const bPrice = getNum("btcPrice"), mPrice = getNum("mstrPrice");
    const h = getNum("btcHoldings"), a = getNum("assumedShares"), fd = getNum("fullyDilutedShares");

    if (!bPrice || !mPrice || !h || !a || !fd) {
        setText("grossBpsSats", "-");
        setText("grossBtcValue", "-");
        setText("netBpsSats", "-");
        setText("netBpsUsd", "-");
        setText("mnavMultiple", "-");
        setText("premium", "입력 대기 중...");
        setText("signal", "수치를 입력해주세요.");
        return null;
    }

    // 1. Gross BTC per Share (Sats): 주당 비트코인 보유량 (Satoshis)
    // Formula: (Total BTC / Shares in Millions) * 100
    const grossBpsSats = (h / a) * 100;
    setText("grossBpsSats", grossBpsSats.toLocaleString(undefined, { maximumFractionDigits: 0 }));

    // 2. Gross BTC Value ($): 주당 비트코인 평가액
    // Formula: (Total BTC * BTC Price) / (Shares in Millions * 1,000,000)
    const grossBtcValueUsd = (h * bPrice) / (a * 1e6);
    const formattedGrossUsd = "$" + grossBtcValueUsd.toFixed(2);
    
    const grossBtcIds = ["grossBtcValue", "grossValue", "grossBpsUsd", "grossBtcUsd"];
    grossBtcIds.forEach(id => setText(id, formattedGrossUsd));

    // 3. Net Assets Calculation (Strategy.com 기준)
    // Strategy.com과 동일하게, Net BPS·mNAV는 주가와 관계없이 항상 FDSO(완전희석 주식수)로 나눈다.
    // (Gross BTC/Share·Gross BTC Value는 위 1·2번처럼 ADSO 기준 그대로 유지)
    const fdSharesForCalc = fd;
    const { usdAssetsUsdB, debtUsdB, preferredUsdB } = currentData;
    
    const btcValueUsdB = (h * bPrice) / 1e9;
    const netBtcAssetsUsdB = btcValueUsdB + usdAssetsUsdB - debtUsdB - preferredUsdB;
    
    let netBpsUsd = 0, currentPremium = 0, signal = "";
    
    if (netBtcAssetsUsdB > 0) {
        // Net BPS ($) = Net BTC Assets ($) / Diluted Shares
        netBpsUsd = (netBtcAssetsUsdB * 1e9) / (fdSharesForCalc * 1e6);
        currentPremium = mPrice / netBpsUsd;
        const netBpsSats = (netBpsUsd / bPrice) * 1e8;
        
        setText("netBpsSats", netBpsSats.toLocaleString(undefined, { maximumFractionDigits: 0 }));
        setText("netBpsUsd", "$" + netBpsUsd.toFixed(2));
        setText("mnavMultiple", currentPremium.toFixed(2) + "×");
        setText("premium", `현재 Premium: ${(currentPremium * 100).toFixed(1)}%`);
        
        if (currentPremium < 1.0) signal = "매수 기회: MNAV 1.0 미만 (역프리미엄)";
        else if (currentPremium < 1.3) signal = "평균적 밸류에이션 (보통)";
        else if (currentPremium < 2.0) signal = "프리미엄 확대 구간 (주의)";
        else signal = "고평가 가능성: MNAV 2.0 이상 (분할 매도 고려)";
    } else {
        setText("netBpsSats", "N/A");
        setText("netBpsUsd", "N/A");
        setText("mnavMultiple", "N/A");
        setText("premium", "Net Assets < 0");
        signal = "리스크 경고: 부채 초과 상태";
    }
    
    const sigEl = document.getElementById("signal");
    if (sigEl) {
        sigEl.textContent = signal;
        sigEl.style.color = currentPremium < 1.0 ? "#3fb950" : (currentPremium >= 2.0 ? "#ff4d4d" : "#58a6ff");
    }
    
    return { currentPremium, fdSharesForCalc };
}

// 목표가 시뮬레이터
function runSimulator(fdSharesForCalc) {
    const targetBtcPrice = getNum("targetBtcPrice"), targetMnav = getNum("targetMnav"), h = getNum("btcHoldings");
    if (!targetBtcPrice || !targetMnav || !h || !fdSharesForCalc) {
        setText("predictedMstrPrice", "$0.00");
        setText("predictedNetBps", "예상 Net BPS: $0.00");
        return;
    }

    const { usdAssetsUsdB, debtUsdB, preferredUsdB } = currentData;
    const targetBtcValueUsdB = (h * targetBtcPrice) / 1e9;
    const targetNetBtcAssetsUsdB = targetBtcValueUsdB + usdAssetsUsdB - debtUsdB - preferredUsdB;
    
    if (targetNetBtcAssetsUsdB > 0) {
        const targetNetBpsUsd = (targetNetBtcAssetsUsdB * 1e9) / (fdSharesForCalc * 1e6);
        const predictedMstr = targetNetBpsUsd * targetMnav;
        setText("predictedMstrPrice", "$" + predictedMstr.toFixed(2));
        setText("predictedNetBps", "예상 Net BPS: $" + targetNetBpsUsd.toFixed(2));
    } else {
        setText("predictedMstrPrice", "N/A");
        setText("predictedNetBps", "예상 Net BPS: N/A");
    }
}

// 시나리오 시뮬레이션 표 생성
function generateScenarioTable(fdSharesForCalc) {
    const tbody = document.getElementById("scenarioTable");
    if (!tbody || !fdSharesForCalc) return;
    
    const { usdAssetsUsdB, debtUsdB, preferredUsdB } = currentData;
    const h = getNum("btcHoldings");
    const btcPrices = [30000, 50000, 70000, 100000, 150000, 200000, 300000, 500000];
    const mnavMultiples = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
    
    let html = "";
    btcPrices.forEach(p => {
        const valB = (h * p) / 1e9;
        const netB = valB + usdAssetsUsdB - debtUsdB - preferredUsdB;
        const bps = (netB > 0) ? (netB * 1e9) / (fdSharesForCalc * 1e6) : 0;
        
        let row = `<tr><td style="font-weight:bold;color:#fff;">$${(p/1000).toFixed(0)}k</td>`;
        mnavMultiples.forEach(m => {
            if (bps > 0) {
                const est = bps * m;
                row += `<td style="color:${m >= 2.0 ? '#ff9f0a' : '#58a6ff'}">$${est.toFixed(0)}</td>`;
            } else { 
                row += `<td style="color:#666;">-</td>`; 
            }
        });
        row += `</tr>`;
        html += row;
    });
    tbody.innerHTML = html;
}

// 대시보드 전체 업데이트
async function updateDashboard(forceChartRefresh = false) {
    if (autoSyncEnabled) {
        // 0) 저장소 live.json 스냅샷을 먼저 넣어 화면이 비지 않게 한다.
        const repoLive = await fetchRepoLivePrices();
        if (repoLive?.btcPrice) setVal("btcPrice", repoLive.btcPrice.toFixed(2));
        if (repoLive?.mstrPrice) setVal("mstrPrice", repoLive.mstrPrice.toFixed(2));
        // 스냅샷이 있으면 먼저 한 번 계산해 화면을 바로 채운다 (실시간 시도는 그 다음).
        if (repoLive?.btcPrice || repoLive?.mstrPrice) recalculateOnly();

        // 1) 실시간 시세를 동시에 시도하고, 성공한 값만 덮어쓴다 (실패하면 위 스냅샷 값 유지).
        const [liveBtc, liveMstr] = await Promise.all([
            fetchLiveBtcPrice(),
            fetchLiveMstrPrice()
        ]);
        if (liveBtc) setVal("btcPrice", liveBtc.toFixed(2));
        if (liveMstr) setVal("mstrPrice", liveMstr.toFixed(2));
    }

    recalculateOnly();
    
    const calc = calculateMNAV();
    const currentPremium = calc ? calc.currentPremium : null;

    const fng = await fetchFearAndGreed();
    const futures = await fetchFuturesData();
    
    if (futures) {
        setText("fundingRate", futures.fundingRate || "-");
        setText("btcOi", futures.openInterest || "-");
        
        const risk = determineFuturesRiskStage(fng, futures.rawFr, currentPremium, futures.rawLs);
        setText("futuresRiskStage", risk.stage);
        const stageEl = document.getElementById("futuresRiskStage");
        if (stageEl) stageEl.style.color = risk.color;
        setText("futuresRiskText", risk.text);
        
        setText("badge-fng", fng !== null ? `공포탐욕: ${fng}` : `공포탐욕: 연동중`);
        setText("badge-premium", currentPremium ? `MSTR 프리미엄: ${currentPremium.toFixed(2)}x` : `MSTR 프리미엄: -`);
        setText("badge-ls", futures.lsRatio ? `L/S 비율: ${futures.lsRatio}` : `L/S 비율: -`);
    }

    if (!futuresChartInstance || forceChartRefresh) {
        const cData = await fetchFuturesHistory(currentTf);
        if (cData) renderChart(cData);
    }

    // 상단 갱신 시간 기록
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    setText("lastUpdated", `(최근 갱신: ${timeStr})`);
}

function recalculateOnly() {
    const calc = calculateMNAV();
    if (calc && calc.fdSharesForCalc) {
        runSimulator(calc.fdSharesForCalc);
        generateScenarioTable(calc.fdSharesForCalc);
    }
}

async function changeChartTimeframe(tf) {
    currentTf = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('tf-' + tf);
    if (activeBtn) activeBtn.classList.add('active');
    
    const cData = await fetchFuturesHistory(tf);
    if (cData) renderChart(cData);
}

function handleInput() {
    saveInputsToStorage();
    recalculateOnly();
}

function handlePriceInput() {
    if (autoSyncEnabled) {
        const toggle = document.getElementById("autoSyncToggle");
        if (toggle) toggle.checked = false;
        setText("autoSyncLabel", "자동 동기화 OFF");
        const label = document.getElementById("autoSyncLabel");
        if (label) label.style.color = "#8b949e";
        setText("dataStatus", "사용자 직접 입력 (수동 모드)");
        autoSyncEnabled = false;
    }
    handleInput();
}

function toggleAutoSync() {
    const toggle = document.getElementById("autoSyncToggle");
    const isChecked = toggle ? toggle.checked : false;
    autoSyncEnabled = isChecked;
    
    const label = document.getElementById("autoSyncLabel");
    if (isChecked) {
        setText("autoSyncLabel", "자동 동기화 ON");
        if (label) label.style.color = "#ff9f0a";
        setText("dataStatus", "실시간 데이터 연동 중...");
        updateDashboard(false); 
    } else {
        setText("autoSyncLabel", "자동 동기화 OFF");
        if (label) label.style.color = "#8b949e";
        setText("dataStatus", "사용자 직접 입력 (수동 모드)");
    }
}

// 이벤트 리스너 바인딩 및 초기화
document.querySelectorAll('input').forEach(input => {
    if (input.id === "btcPrice" || input.id === "mstrPrice") {
        input.addEventListener('input', handlePriceInput);
    } else if (input.id !== "autoSyncToggle") {
        input.addEventListener('input', handleInput);
    }
});

const syncToggle = document.getElementById("autoSyncToggle");
if (syncToggle) syncToggle.addEventListener('change', toggleAutoSync);

document.addEventListener("DOMContentLoaded", async () => {
    // 주소의 ?finnhub=키 는 시세 조회 전에 먼저 저장하고 주소창에서 지운다.
    applyFinnhubKeyFromUrl();
    loadInputsFromStorage();
    // 주간 8-K 가 반영된 data.json 을 먼저 적용하고 시세를 받아 계산한다.
    await applyFundamentalsFromDataJson();
    updateDashboard(true);
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() => updateDashboard(false), 15000);
});
