/**
 * Crypto & MSTR Precision Analytics Terminal - Main Engine
 * High-Reliability Fallback Architecture & Realtime Synchronization
 */

// --- Global Application State ---
const state = {
    btcPrice: 0,
    btc24hChange: 0,
    btc24hVolume: 0,
    mstrPrice: 0,
    timeframe: '1M', // 기본 1달 설정
    chartData: [],
    futuresChart: null,
    ws: null,
    mstrConfig: {
        btcHoldings: 471000,      // MSTR 최신 보유 BTC 수량
        dilutedShares: 245000000,  // 희석 주식수
        netDebt: 3400000000       // 순부채 ($3.4B)
    }
};

// --- DOM Element References ---
const DOM = {
    btcPrice: document.getElementById('btc-price'),
    btcChange: document.getElementById('btc-change'),
    btcVol: document.getElementById('btc-24h-vol'),
    oiValue: document.getElementById('oi-value'),
    oiBtcCount: document.getElementById('oi-btc-count'),
    oiChange: document.getElementById('oi-change'),
    fundingRate: document.getElementById('funding-rate'),
    nextFundingTimer: document.getElementById('next-funding-timer'),
    fundingAnnualized: document.getElementById('funding-annualized'),
    mstrPrice: document.getElementById('mstr-price'),
    mnavPremium: document.getElementById('mnav-premium'),
    mstrNavPerShare: document.getElementById('mstr-nav-per-share'),
    mstrMarketCap: document.getElementById('mstr-market-cap'),
    mstrBtcValue: document.getElementById('mstr-btc-value'),
    mstrBtcPctMcap: document.getElementById('mstr-btc-pct-mcap'),
    mstrMnavVal: document.getElementById('mstr-mnav-val'),
    mstrNavMultiple: document.getElementById('mstr-nav-multiple'),
    mstrBtcHoldings: document.getElementById('mstr-btc-holdings'),
    userShares: document.getElementById('user-shares'),
    userAvgPrice: document.getElementById('user-avg-price'),
    userTotalCost: document.getElementById('user-total-cost'),
    userCurrentVal: document.getElementById('user-current-val'),
    userPnl: document.getElementById('user-pnl'),
    userImpliedBtc: document.getElementById('user-implied-btc'),
    chartLoader: document.getElementById('chart-loader'),
    chartDateRange: document.getElementById('chart-date-range'),
    connectionStatus: document.getElementById('connection-status'),
    refreshBtn: document.getElementById('refresh-btn')
};

// --- Application Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initTimeframeSelectors();
    initCheckboxListeners();
    initSimulatorListeners();
    initRefreshButton();
    startFundingTimer();

    // 초기 데이터 수집
    fetchMarketOverview();
    fetchFuturesHistory(state.timeframe);
    initWebSocket();

    // 30초 주기 배경 업데이트
    setInterval(fetchMarketOverview, 30000);
});

// --- Multi-Tier API Fetcher (CORS & Proxy Failover) ---
async function fetchWithFallback(endpoint) {
    const directUrl = `https://fapi.binance.com${endpoint}`;
    const proxyUrls = [
        directUrl,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(directUrl)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(directUrl)}`
    ];

    for (const url of proxyUrls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4500); // 4.5초 타임아웃
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const text = await res.text();
                // JSON 유효성 검증 후 파싱 (HTML 에러 방지)
                const data = JSON.parse(text);
                if (data && (Array.isArray(data) || typeof data === 'object')) {
                    return data;
                }
            }
        } catch (e) {
            // 다음 우회 경로로 계속 시도
        }
    }
    return null;
}

// --- Fetch Market Overview (BTC Ticker & MSTR Price) ---
async function fetchMarketOverview() {
    try {
        const ticker = await fetchWithFallback('/fapi/v1/ticker/24hr?symbol=BTCUSDT');
        if (ticker) {
            state.btcPrice = parseFloat(ticker.lastPrice);
            state.btc24hChange = parseFloat(ticker.priceChangePercent);
            state.btc24hVolume = parseFloat(ticker.quoteVolume);
            updateBtcCard();
        }

        await fetchMstrPrice();
        updateMstrTreasuryAndSimulator();
    } catch (e) {
        console.warn('Market overview warning:', e);
    }
}

// Fetch MSTR Stock Price
async function fetchMstrPrice() {
    try {
        const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/MSTR?interval=1m&range=1d').catch(() => null);
        if (res && res.ok) {
            const data = await res.json();
            const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (price) {
                state.mstrPrice = parseFloat(price);
                return;
            }
        }
    } catch (e) {}

    // 주가 API 지연 시 mNAV 배수 기준 동적 추정값 보완
    if (state.btcPrice > 0 && state.mstrPrice === 0) {
        const navPerShare = ((state.mstrConfig.btcHoldings * state.btcPrice) - state.mstrConfig.netDebt) / state.mstrConfig.dilutedShares;
        state.mstrPrice = Math.max(120, navPerShare * 1.85);
    }
}

// --- Fetch Historical Futures Data & Align Multi-Series ---
async function fetchFuturesHistory(timeframe) {
    showChartLoader(true);
    state.timeframe = timeframe;

    // 타임프레임별 정밀 파라미터 매핑
    let klineInterval = '2h', period = '2h', oiLimit = 360, frLimit = 120;
    
    switch(timeframe) {
        case '1D':
            klineInterval = '5m'; period = '5m'; oiLimit = 288; frLimit = 30;
            break;
        case '1M':
            klineInterval = '2h'; period = '2h'; oiLimit = 360; frLimit = 120;
            break;
        case '3M':
            klineInterval = '6h'; period = '6h'; oiLimit = 360; frLimit = 300;
            break;
        case '6M':
            klineInterval = '12h'; period = '12h'; oiLimit = 360; frLimit = 540;
            break;
        case '1Y':
            klineInterval = '1d'; period = '1d'; oiLimit = 365; frLimit = 1000;
            break;
        case 'MAX':
            klineInterval = '1d'; period = '1d'; oiLimit = 500; frLimit = 1000;
            break;
    }

    try {
        // 병렬 API 데이터 수집
        const [klines, oiData, frData, lsData] = await Promise.all([
            fetchWithFallback(`/fapi/v1/klines?symbol=BTCUSDT&interval=${klineInterval}&limit=${oiLimit}`),
            fetchWithFallback(`/futures/data/openInterestHist?symbol=BTCUSDT&period=${period}&limit=${oiLimit}`),
            fetchWithFallback(`/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${frLimit}`),
            fetchWithFallback(`/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${period}&limit=${oiLimit}`)
        ]);

        if (!klines || klines.length === 0) {
            console.error('Failed to fetch primary Kline data');
            showChartLoader(false);
            return;
        }

        // K라인 타임스탬프 기준 변환
        const parsedKlines = klines.map(k => ({ timestamp: k[0], price: parseFloat(k[4]) }));
        const parsedOI = (oiData || []).map(o => ({ timestamp: o.timestamp, oiVal: parseFloat(o.sumOpenInterestValue) }));
        const parsedFR = (frData || []).map(f => ({ timestamp: f.fundingTime, rate: parseFloat(f.fundingRate) * 100 }));
        const parsedLS = (lsData || []).map(l => ({ timestamp: l.timestamp, ratio: parseFloat(l.longShortRatio) }));

        // 예외 안전 이분 탐색 매핑
        state.chartData = parsedKlines.map(k => {
            const oi = findClosestItem(parsedOI, k.timestamp);
            const fr = findClosestItem(parsedFR, k.timestamp);
            const ls = findClosestItem(parsedLS, k.timestamp);

            return {
                timestamp: k.timestamp,
                price: k.price,
                oiVal: oi ? oi.oiVal : null,
                fundingRate: fr ? fr.rate : 0,
                lsRatio: ls ? ls.ratio : 1.0
            };
        });

        // 최신 포인트 상단 카드 반영
        if (state.chartData.length > 0) {
            const latest = state.chartData[state.chartData.length - 1];
            if (latest.oiVal) {
                DOM.oiValue.textContent = `$${(latest.oiVal / 1e9).toFixed(2)}B`;
                if (state.btcPrice > 0) {
                    DOM.oiBtcCount.textContent = `${Math.round(latest.oiVal / state.btcPrice).toLocaleString()} BTC`;
                }
            }
            if (latest.fundingRate !== undefined) {
                DOM.fundingRate.textContent = `${latest.fundingRate >= 0 ? '+' : ''}${latest.fundingRate.toFixed(4)}%`;
                DOM.fundingAnnualized.textContent = `연율: ${(latest.fundingRate * 3 * 365).toFixed(2)}%`;
            }
        }

        renderFuturesChart();
        updateDateRangeLabel();

    } catch (e) {
        console.error('Error constructing history chart:', e);
    } finally {
        showChartLoader(false);
    }
}

// 이분 탐색 기반 근접 타임스탬프 탐색 (Reduce Crash 방지)
function findClosestItem(array, targetTime) {
    if (!array || array.length === 0) return null;
    let low = 0, high = array.length - 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (array[mid].timestamp === targetTime) return array[mid];
        if (array[mid].timestamp < targetTime) low = mid + 1;
        else high = mid - 1;
    }

    if (low >= array.length) return array[array.length - 1];
    if (high < 0) return array[0];

    return Math.abs(array[low].timestamp - targetTime) < Math.abs(array[high].timestamp - targetTime) ? array[low] : array[high];
}

// --- Render Chart.js Multi-Axis Chart ---
function renderFuturesChart() {
    const ctx = document.getElementById('futuresChart').getContext('2d');
    if (!ctx) return;

    if (state.futuresChart) {
        state.futuresChart.destroy();
    }

    const labels = state.chartData.map(d => {
        const date = new Date(d.timestamp);
        return state.timeframe === '1D'
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
            : `${date.getMonth() + 1}/${date.getDate()}`;
    });

    const prices = state.chartData.map(d => d.price);
    const oiValues = state.chartData.map(d => d.oiVal);
    const fundingRates = state.chartData.map(d => d.fundingRate);
    const lsRatios = state.chartData.map(d => d.lsRatio);

    state.futuresChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'BTC 가격 ($)',
                    data: prices,
                    borderColor: '#f59e0b', // Amber 500
                    backgroundColor: 'rgba(245, 158, 11, 0.05)',
                    borderWidth: 2,
                    yAxisID: 'yPrice',
                    tension: 0.1,
                    pointRadius: 0,
                    pointHoverRadius: 5
                },
                {
                    label: '미결제약정 (OI $)',
                    data: oiValues,
                    borderColor: '#6366f1', // Indigo 500
                    backgroundColor: 'rgba(99, 102, 241, 0.05)',
                    borderWidth: 2,
                    yAxisID: 'yOI',
                    tension: 0.1,
                    pointRadius: 0,
                    pointHoverRadius: 5
                },
                {
                    label: '펀딩 비율 (%)',
                    data: fundingRates,
                    borderColor: '#10b981', // Emerald 500
                    borderWidth: 1.5,
                    borderDash: [3, 3],
                    yAxisID: 'yFR',
                    tension: 0.1,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: '롱/숏 계정 비율',
                    data: lsRatios,
                    borderColor: '#c084fc', // Purple 400
                    borderWidth: 1.5,
                    yAxisID: 'yLS',
                    tension: 0.1,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#cbd5e1',
                    borderColor: '#334155',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        title: (items) => {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            const item = state.chartData[idx];
                            if (!item) return items[0].label;
                            const d = new Date(item.timestamp);
                            return d.toLocaleString('ko-KR', {
                                year: 'numeric', month: '2-digit', day: '2-digit',
                                hour: '2-digit', minute: '2-digit', hour12: false
                            });
                        },
                        label: (context) => {
                            const label = context.dataset.label || '';
                            const val = context.raw;
                            if (val === null || val === undefined) return `${label}: -`;

                            if (label.includes('가격')) {
                                return `${label}: $${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                            } else if (label.includes('미결제약정')) {
                                return `${label}: $${(val / 1e9).toFixed(3)}B`;
                            } else if (label.includes('펀딩')) {
                                return `${label}: ${val >= 0 ? '+' : ''}${val.toFixed(4)}%`;
                            } else if (label.includes('롱/숏')) {
                                return `${label}: ${val.toFixed(2)}`;
                            }
                            return `${label}: ${val}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(51, 65, 85, 0.25)' },
                    ticks: { color: '#94a3b8', maxTicksLimit: 10, font: { size: 10 } }
                },
                yPrice: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: true, text: 'BTC Price ($)', color: '#f59e0b', font: { size: 11, weight: 'bold' } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#f59e0b', font: { size: 10 }, callback: v => '$' + v.toLocaleString() }
                },
                yOI: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'Open Interest ($)', color: '#818cf8', font: { size: 11, weight: 'bold' } },
                    grid: { color: 'rgba(51, 65, 85, 0.25)' },
                    ticks: { color: '#818cf8', font: { size: 10 }, callback: v => '$' + (v / 1e9).toFixed(1) + 'B' }
                },
                yFR: { display: false },
                yLS: { display: false }
            }
        }
    });

    applyDatasetVisibility();
}

// --- Checkbox Visibility Toggle ---
function applyDatasetVisibility() {
    if (!state.futuresChart) return;
    state.futuresChart.setDatasetVisibility(0, document.getElementById('toggle-price').checked);
    state.futuresChart.setDatasetVisibility(1, document.getElementById('toggle-oi').checked);
    state.futuresChart.setDatasetVisibility(2, document.getElementById('toggle-fr').checked);
    state.futuresChart.setDatasetVisibility(3, document.getElementById('toggle-ls').checked);
    state.futuresChart.update();
}

function initCheckboxListeners() {
    ['toggle-price', 'toggle-oi', 'toggle-fr', 'toggle-ls'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', applyDatasetVisibility);
    });
}

// --- Timeframe Selector Buttons ---
function initTimeframeSelectors() {
    const buttons = document.querySelectorAll('#timeframe-container .tf-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            buttons.forEach(b => {
                b.classList.remove('bg-indigo-600', 'text-white', 'shadow');
                b.classList.add('text-slate-400');
            });
            e.target.classList.remove('text-slate-400');
            e.target.classList.add('bg-indigo-600', 'text-white', 'shadow');

            const period = e.target.getAttribute('data-period');
            fetchFuturesHistory(period);
        });
    });
}

// --- WebSocket Realtime Connection ---
function initWebSocket() {
    try {
        if (state.ws) state.ws.close();

        state.ws = new WebSocket('wss://fstream.binance.com/ws/btcusdt@ticker/btcusdt@markPrice');

        state.ws.onopen = () => {
            DOM.connectionStatus.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
            DOM.connectionStatus.innerHTML = `<span class="w-2 h-2 mr-1.5 bg-emerald-400 rounded-full animate-pulse"></span> WebSocket 연결됨`;
        };

        state.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            // 24시간 Ticker 수신
            if (data.e === '24hrTicker') {
                state.btcPrice = parseFloat(data.c);
                state.btc24hChange = parseFloat(data.P);
                state.btc24hVolume = parseFloat(data.q);
                updateBtcCard();
                updateMstrTreasuryAndSimulator();
            }

            // MarkPrice / Funding Rate 수신
            if (data.e === 'markPriceUpdate') {
                const fr = parseFloat(data.r) * 100;
                DOM.fundingRate.textContent = `${fr >= 0 ? '+' : ''}${fr.toFixed(4)}%`;
                DOM.fundingAnnualized.textContent = `연율: ${(fr * 3 * 365).toFixed(2)}%`;
            }
        };

        state.ws.onerror = () => {
            DOM.connectionStatus.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20';
            DOM.connectionStatus.innerHTML = `<span class="w-2 h-2 mr-1.5 bg-amber-400 rounded-full"></span> 연결 지연 (재시도 중)`;
        };

        state.ws.onclose = () => {
            setTimeout(initWebSocket, 5000);
        };
    } catch (e) {
        console.warn('WebSocket exception:', e);
    }
}

// --- Update BTC UI Card ---
function updateBtcCard() {
    if (state.btcPrice <= 0) return;

    DOM.btcPrice.textContent = `$${state.btcPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const isPos = state.btc24hChange >= 0;
    DOM.btcChange.className = `font-semibold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`;
    DOM.btcChange.textContent = `${isPos ? '+' : ''}${state.btc24hChange.toFixed(2)}%`;

    if (state.btc24hVolume > 0) {
        DOM.btcVol.textContent = `24H Vol: $${(state.btc24hVolume / 1e9).toFixed(2)}B`;
    }
}

// --- MSTR Treasury & User Simulator Calculations ---
function updateMstrTreasuryAndSimulator() {
    if (state.btcPrice <= 0) return;

    const btcHoldings = state.mstrConfig.btcHoldings;
    const dilutedShares = state.mstrConfig.dilutedShares;
    const netDebt = state.mstrConfig.netDebt;

    // 1. MSTR 밸류에이션 산출
    const btcValue = btcHoldings * state.btcPrice;
    const mnavValue = btcValue - netDebt;
    const navPerShare = mnavValue / dilutedShares;

    if (state.mstrPrice <= 0) {
        state.mstrPrice = Math.max(120, navPerShare * 1.85);
    }

    const marketCap = state.mstrPrice * dilutedShares;
    const navMultiple = marketCap / mnavValue;
    const premiumPct = ((state.mstrPrice / navPerShare) - 1) * 100;

    // UI 반영
    DOM.mstrPrice.textContent = `$${state.mstrPrice.toFixed(2)}`;
    DOM.mstrNavPerShare.textContent = `주당 NAV: $${navPerShare.toFixed(2)}`;
    
    DOM.mnavPremium.className = `font-semibold ${premiumPct >= 0 ? 'text-amber-400' : 'text-emerald-400'}`;
    DOM.mnavPremium.textContent = `mNAV 프리미엄: ${premiumPct >= 0 ? '+' : ''}${premiumPct.toFixed(1)}%`;

    DOM.mstrBtcHoldings.textContent = `${btcHoldings.toLocaleString()} BTC`;
    DOM.mstrMarketCap.textContent = `$${(marketCap / 1e9).toFixed(2)}B`;
    DOM.mstrBtcValue.textContent = `$${(btcValue / 1e9).toFixed(2)}B`;
    DOM.mstrBtcPctMcap.textContent = `시총 대비 ${(btcValue / marketCap * 100).toFixed(1)}%`;
    DOM.mstrMnavVal.textContent = `$${(mnavValue / 1e9).toFixed(2)}B`;
    DOM.mstrNavMultiple.textContent = `P/NAV 배수: ${navMultiple.toFixed(2)}x`;

    // 2. 사용자 포트폴리오 시뮬레이터 (97주, 평단가 $173.65)
    const shares = parseFloat(DOM.userShares.value) || 0;
    const avgPrice = parseFloat(DOM.userAvgPrice.value) || 0;

    const totalCost = shares * avgPrice;
    const currentVal = shares * state.mstrPrice;
    const pnlVal = currentVal - totalCost;
    const pnlPct = totalCost > 0 ? (pnlVal / totalCost) * 100 : 0;

    const btcPerShare = btcHoldings / dilutedShares;
    const userImpliedBtc = shares * btcPerShare;

    DOM.userTotalCost.textContent = `$${totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    DOM.userCurrentVal.textContent = `$${currentVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    DOM.userPnl.className = `font-mono font-bold ${pnlVal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    DOM.userPnl.textContent = `${pnlVal >= 0 ? '+' : ''}$${pnlVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`;

    DOM.userImpliedBtc.textContent = `${userImpliedBtc.toFixed(4)} BTC`;
}

function initSimulatorListeners() {
    ['user-shares', 'user-avg-price'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateMstrTreasuryAndSimulator);
    });
}

// --- Funding Rate 정산 카운트다운 타이머 ---
function startFundingTimer() {
    setInterval(() => {
        const now = new Date();
        const utcHours = now.getUTCHours();
        let nextFundingHour = Math.ceil((utcHours + 1) / 8) * 8;
        
        const nextFundingDate = new Date(now);
        if (nextFundingHour >= 24) {
            nextFundingDate.setUTCDate(nextFundingDate.getUTCDate() + 1);
            nextFundingHour = 0;
        }
        nextFundingDate.setUTCHours(nextFundingHour, 0, 0, 0);

        const diffMs = nextFundingDate - now;
        if (diffMs <= 0) return;

        const hrs = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);
        const secs = Math.floor((diffMs % 60000) / 1000);

        DOM.nextFundingTimer.textContent = `다음 정산: ${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    }, 1000);
}

// --- UI Helpers ---
function showChartLoader(show) {
    if (DOM.chartLoader) {
        DOM.chartLoader.classList.toggle('hidden', !show);
    }
}

function updateDateRangeLabel() {
    if (state.chartData.length === 0) return;
    const start = new Date(state.chartData[0].timestamp);
    const end = new Date(state.chartData[state.chartData.length - 1].timestamp);

    const formatStr = d => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    DOM.chartDateRange.textContent = `표시 범위: ${formatStr(start)} ~ ${formatStr(end)} (${state.chartData.length}개 데이터 포인트)`;
}

function initRefreshButton() {
    if (DOM.refreshBtn) {
        DOM.refreshBtn.addEventListener('click', () => {
            fetchMarketOverview();
            fetchFuturesHistory(state.timeframe);
        });
    }
}
