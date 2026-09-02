let myChart = null;
let currentTf = '1M';
let btcLivePrice = 0;

// 숫자 변환 보조 함수
function getNum(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const val = el.value !== undefined ? el.value : el.textContent;
    const cleaned = String(val).replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

// 1. Strategy.com 공식 mNAV 계산 함수
function calculateMetrics() {
    const bPrice = btcLivePrice || getNum('btcPriceText');
    const mPrice = getNum('mstrPrice');
    const h = getNum('btcHoldings');         // 예: 845050
    const adso = getNum('adso');             // 예: 424.479
    const fdso = getNum('fdso');             // 예: 450.090
    const debt = getNum('debtPreferred');    // 예: 12500 ($M)

    if (!bPrice || !mPrice || !h || !adso || !fdso) return;

    // Strategy.com 공식 수식:
    // Gross BTC Value = 보유 BTC * BTC 가격
    const grossBtcValue = h * bPrice;

    // Gross BPS ($) = Gross BTC Value / ADSO (유통주식수)
    const grossBpsUsd = grossBtcValue / (adso * 1000000);

    // Net BTC Reserve = Gross BTC Value - 부채/우선주($)
    const netBtcReserve = grossBtcValue - (debt * 1000000);

    // Net BPS ($) = Net BTC Reserve / FDSO (완전희석주식수)
    const netBpsUsd = netBtcReserve / (fdso * 1000000);

    // Strategy.com 공식 mNAV = 주가 / Net BPS
    let mnav = 0;
    if (netBpsUsd > 0) {
        mnav = mPrice / netBpsUsd;
    }

    // UI 업데이트
    document.getElementById('mnavValue').textContent = mnav.toFixed(2) + 'x';
    document.getElementById('grossBpsValue').textContent = '$' + grossBpsUsd.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    updateRiskAssessment(mnav);
}

// 2. 위험도 스펙트럼 업데이트
function updateRiskAssessment(mnav) {
    const riskBadge = document.getElementById('riskBadge');
    const riskDesc = document.getElementById('riskDesc');
    const riskSpectrumText = document.getElementById('riskSpectrumText');

    let score = 2;
    if (mnav > 2.0) score = 5;
    else if (mnav > 1.6) score = 4;
    else if (mnav > 1.3) score = 3;
    else score = 2;

    if (riskBadge) {
        if (score <= 2) {
            riskBadge.className = 'risk-badge low';
            riskBadge.textContent = `🟢 ${score}단계: 안정적 (저위험)`;
            riskDesc.textContent = '과도한 레버리지가 해소된 안정적인 시장 상태입니다.';
        } else if (score === 3) {
            riskBadge.className = 'risk-badge mid';
            riskBadge.textContent = `🟡 ${score}단계: 주의 (중위험)`;
            riskDesc.textContent = '프리미엄 상승에 따른 변동성 확대 주의 구간입니다.';
        } else {
            riskBadge.className = 'risk-badge high';
            riskBadge.textContent = `🔴 ${score}단계: 과열 (고위험)`;
            riskDesc.textContent = '과도한 프리미엄 및 레버리지 위험이 감지됩니다.';
        }
    }

    if (riskSpectrumText) {
        riskSpectrumText.textContent = `MSTR 프리미엄: ${mnav.toFixed(2)}x`;
    }
}

// 3. 바이낸스 실시간 지표 수집
async function fetchBinanceData() {
    try {
        // BTC 가격
        const resPrice = await fetch('https://api.binance.com/api/3/ticker/price?symbol=BTCUSDT');
        const dataPrice = await resPrice.json();
        btcLivePrice = parseFloat(dataPrice.price);
        document.getElementById('btcPriceText').textContent = '$' + btcLivePrice.toLocaleString(undefined, {maximumFractionDigits: 1});

        // 펀딩비
        const resFunding = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
        const dataFunding = await resFunding.json();
        const funding = (parseFloat(dataFunding.lastFundingRate) * 100).toFixed(4);
        document.getElementById('fundingRate').textContent = funding + '%';

        // 미체결 약정
        const resOI = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
        const dataOI = await resOI.json();
        const oiBtc = (parseFloat(dataOI.openInterest) / 1000).toFixed(1);
        document.getElementById('openInterest').textContent = oiBtc + 'K BTC';

        // 롱/숏 비율
        const resLS = await fetch('https://fapi.binance.com/fapi/v1/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1');
        const dataLS = await resLS.json();
        if (dataLS && dataLS.length > 0) {
            document.getElementById('longShortRatio').textContent = parseFloat(dataLS[0].longShortRatio).toFixed(2);
        }

        // 공포탐욕 지수
        const resFg = await fetch('https://api.alternative.me/fng/?limit=1');
        const dataFg = await resFg.json();
        if (dataFg && dataFg.data) {
            document.getElementById('fearGreed').textContent = dataFg.data[0].value;
        }

        // 수치 다시 계산
        calculateMetrics();
    } catch (e) {
        console.error("API Fetch Error:", e);
    }
}

// 4. 차트 생성 및 업데이트 (Multi-Y 축)
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

        // 가상 데이터 매핑 (일관된 스케일)
        const oiData = fundingData.map((_, i) => 100 + Math.sin(i / 2) * 10);
        const lsData = fundingData.map((_, i) => 1.2 + Math.cos(i / 3) * 0.3);

        const ctx = document.getElementById('chartCanvas').getContext('2d');

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
                        grid: { drawOnChartArea: false } // 축 겹침 및 가로선 방지
                    },
                    yLS: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#00c853' },
                        grid: { drawOnChartArea: false } // 축 겹침 및 가로선 방지
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

// 이벤트 리스너 등록
document.addEventListener('DOMContentLoaded', () => {
    // 입력값 변경 시 자동 계산
    ['mstrPrice', 'btcHoldings', 'adso', 'fdso', 'debtPreferred'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', calculateMetrics);
    });

    // 타임프레임 버튼 이벤트
    document.querySelectorAll('.btn-tf').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-tf').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentTf = e.target.getAttribute('data-tf');
            renderChart(currentTf);
        });
    });

    // 최초 실행 및 자동 갱신 (30초)
    fetchBinanceData();
    renderChart(currentTf);
    setInterval(fetchBinanceData, 30000);
});
