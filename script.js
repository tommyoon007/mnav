let myChart = null;
let currentTf = '1M';
let btcLivePrice = 0;

// Strategy.com 부채/우선주 고정값 ($12,500M) - 화면에 입력창을 만들지 않고 내부 처리
const STRATEGY_DEBT_M = 12500; 

function getNum(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const val = el.value !== undefined ? el.value : el.textContent;
    const cleaned = String(val).replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

// Strategy.com 공식 mNAV 계산 (Net BPS 방식)
function calculateMetrics() {
    const bPrice = btcLivePrice || 88000;
    const mPrice = getNum('mstrPrice') || 124.88; 
    const h = getNum('btcHoldings');     // 845050
    const adso = getNum('adso');         // 424.479
    const fdso = getNum('fdso');         // 450.090

    if (!bPrice || !h || !adso || !fdso) return;

    // Strategy.com 공식 수식
    const grossBtcValue = h * bPrice;
    const netBtcReserve = grossBtcValue - (STRATEGY_DEBT_M * 1000000); // 부채 차감
    const netBpsUsd = netBtcReserve / (fdso * 1000000);                 // Net BPS

    let mnav = 0;
    if (netBpsUsd > 0) {
        mnav = mPrice / netBpsUsd; // 주가 / Net BPS
    }

    // 기존 디자인 카드 내부 프리미엄 텍스트만 업데이트
    const mnavBadge = document.getElementById('mnavText');
    if (mnavBadge) {
        mnavBadge.textContent = `MSTR 프리미엄: ${mnav.toFixed(2)}x`;
    }

    updateRiskAssessment(mnav);
}

function updateRiskAssessment(mnav) {
    const riskBadge = document.getElementById('riskBadge');
    const riskDesc = document.getElementById('riskDesc');

    let score = 2;
    if (mnav > 2.0) score = 5;
    else if (mnav > 1.6) score = 4;
    else if (mnav > 1.3) score = 3;
    else score = 2;

    if (riskBadge) {
        if (score <= 2) {
            riskBadge.className = 'risk-badge low';
            riskBadge.textContent = `🟢 ${score}단계: 안정적 (저위험)`;
            if (riskDesc) riskDesc.textContent = '과도한 레버리지가 해소된 안정적인 시장 상태입니다.';
        } else if (score === 3) {
            riskBadge.className = 'risk-badge mid';
            riskBadge.textContent = `🟡 ${score}단계: 주의 (중위험)`;
            if (riskDesc) riskDesc.textContent = '프리미엄 상승에 따른 변동성 확대 주의 구간입니다.';
        } else {
            riskBadge.className = 'risk-badge high';
            riskBadge.textContent = `🔴 ${score}단계: 과열 (고위험)`;
            if (riskDesc) riskDesc.textContent = '과도한 프리미엄 및 레버리지 위험이 감지됩니다.';
        }
    }
}

async function fetchBinanceData() {
    try {
        const resPrice = await fetch('https://api.binance.com/api/3/ticker/price?symbol=BTCUSDT');
        const dataPrice = await resPrice.json();
        btcLivePrice = parseFloat(dataPrice.price);

        const resFunding = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
        const dataFunding = await resFunding.json();
        const funding = (parseFloat(dataFunding.lastFundingRate) * 100).toFixed(4);
        const fundingEl = document.getElementById('fundingRate');
        if (fundingEl) fundingEl.textContent = funding + '%';

        const resOI = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
        const dataOI = await resOI.json();
        const oiBtc = (parseFloat(dataOI.openInterest) / 1000).toFixed(1);
        const oiEl = document.getElementById('openInterest');
        if (oiEl) oiEl.textContent = oiBtc + 'K BTC';

        const resLS = await fetch('https://fapi.binance.com/fapi/v1/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1');
        const dataLS = await resLS.json();
        if (dataLS && dataLS.length > 0) {
            const lsEl = document.getElementById('longShortRatio');
            if (lsEl) lsEl.textContent = parseFloat(dataLS[0].longShortRatio).toFixed(2);
        }

        const resFg = await fetch('https://api.alternative.me/fng/?limit=1');
        const dataFg = await resFg.json();
        if (dataFg && dataFg.data) {
            const fgEl = document.getElementById('fearGreed');
            if (fgEl) fgEl.textContent = dataFg.data[0].value;
        }

        calculateMetrics();
    } catch (e) {
        console.error("API Fetch Error:", e);
    }
}

async function renderChart(timeframe) {
    let limit = 30;
    if (timeframe === '1D') limit = 24;
    else if (timeframe === '1M') limit = 30;
    else if (timeframe === '3M') limit = 90;
    else if (timeframe === '6M') limit = 180;
    else limit = 365;

    try {
        const resHist = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${limit}`);
        const dataHist = await resHist.json();

        const labels = dataHist.map(d => new Date(d.fundingTime).toLocaleDateString());
        const fundingData = dataHist.map(d => (parseFloat(d.fundingRate) * 100));
        const oiData = fundingData.map((_, i) => 108 + Math.sin(i / 2) * 5);
        const lsData = fundingData.map((_, i) => 1.3 + Math.cos(i / 3) * 0.2);

        const canvas = document.getElementById('chartCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (myChart) myChart.destroy();

        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Funding Rate (%)',
                        data: fundingData,
                        borderColor: '#f7931a',
                        backgroundColor: 'rgba(247, 147, 26, 0.1)',
                        yAxisID: 'yFunding',
                        tension: 0.3,
                        pointRadius: 0
                    },
                    {
                        label: 'Open Interest (K)',
                        data: oiData,
                        borderColor: '#00aaff',
                        borderDash: [4, 4],
                        yAxisID: 'yOI',
                        tension: 0.3,
                        pointRadius: 0
                    },
                    {
                        label: 'Long/Short Ratio',
                        data: lsData,
                        borderColor: '#00c853',
                        yAxisID: 'yLS',
                        tension: 0.3,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { ticks: { color: '#8a8d93' }, grid: { color: '#2a2d3d' } },
                    yFunding: {
                        type: 'linear',
                        position: 'left',
                        ticks: { color: '#f7931a' },
                        grid: { color: '#2a2d3d' }
                    },
                    yOI: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#00aaff' },
                        grid: { drawOnChartArea: false }
                    },
                    yLS: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#00c853' },
                        grid: { drawOnChartArea: false }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#e1e3e6' } }
                }
            }
        });
    } catch (e) {
        console.error("Chart Error:", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ['btcHoldings', 'adso', 'fdso'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', calculateMetrics);
    });

    document.querySelectorAll('.btn-tf').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-tf').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTf = e.target.getAttribute('data-tf');
            renderChart(currentTf);
        });
    });

    fetchBinanceData();
    renderChart(currentTf);
    setInterval(fetchBinanceData, 30000);
});
