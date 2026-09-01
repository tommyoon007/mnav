// =========================================================================
// MSTR mNAV & BTC FUTURES PRO DASHBOARD - DEFINITIVE ENGINE
// =========================================================================

document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    fetchFuturesData();
    updateDashboard();
    changeChartTimeframe('1M'); 
    
    // 5분마다 실시간 펀딩비 및 OI 업데이트
    setInterval(fetchFuturesData, 300000); 
});

const parseNum = (str) => {
    if (str === null || str === undefined) return 0;
    const cleanStr = str.toString().replace(/,/g, '').trim();
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
};

const formatNum = (num) => Number(num).toLocaleString('en-US', { maximumFractionDigits: 2 });

function setupEventListeners() {
    const inputs = ['btcPrice', 'mstrPrice', 'btcHoldings', 'assumedShares', 'fullyDilutedShares', 'targetBtcPrice', 'targetMnav'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            // 입력 중 커서가 튀거나 포커스가 풀리지 않도록 실시간 계산만 수행
            el.addEventListener('input', () => {
                updateDashboard();
            });
        }
    });
}

function updateDashboard() {
    const btcPrice = parseNum(document.getElementById('btcPrice').value);
    const mstrPrice = parseNum(document.getElementById('mstrPrice').value);
    const btcHoldings = parseNum(document.getElementById('btcHoldings').value);
    
    const adso = parseNum(document.getElementById('assumedShares').value) * 1_000_000;
    const fdso = parseNum(document.getElementById('fullyDilutedShares').value) * 1_000_000;

    const grossBtcPerShare = adso > 0 ? (btcHoldings / adso) : 0;
    const netBtcPerShare = fdso > 0 ? (btcHoldings / fdso) : 0;

    const grossSats = grossBtcPerShare * 100_000_000;
    const netSats = netBtcPerShare * 100_000_000;

    const netBpsUsd = netBtcPerShare * btcPrice;
    const mnav = netBpsUsd > 0 ? (mstrPrice / netBpsUsd) : 0;
    const premium = (mnav - 1) * 100;

    // 결과값만 안전하게 갱신 (사용자 입력 칸은 절대 건드리지 않음)
    document.getElementById('grossBpsSats').innerText = formatNum(grossSats.toFixed(0));
    document.getElementById('netBpsSats').innerText = formatNum(netSats.toFixed(0));
    document.getElementById('netBpsUsd').innerText = "$" + formatNum(netBpsUsd.toFixed(2));
    document.getElementById('mnavMultiple').innerText = mnav.toFixed(2) + "×";
    
    const premiumEl = document.getElementById('premium');
    premiumEl.innerText = `프리미엄: ${premium > 0 ? "+" : ""}${premium.toFixed(2)}%`;
    premiumEl.style.color = premium > 0 ? "#32d74b" : "#ff453a";

    const signalBox = document.getElementById('signal');
    if (mnav > 2.5) {
        signalBox.innerHTML = "🔴 극단적 고평가 (프리미엄 과열)";
        signalBox.style.color = "#ff453a";
    } else if (mnav > 1.5) {
        signalBox.innerHTML = "🟡 고평가 진입 (프리미엄 확대)";
        signalBox.style.color = "#ffd60a";
    } else if (mnav > 1.0) {
        signalBox.innerHTML = "🟢 적정 가치 (건전한 프리미엄)";
        signalBox.style.color = "#3fb950";
    } else {
        signalBox.innerHTML = "🔵 저평가 (디스카운트 상태)";
        signalBox.style.color = "#58a6ff";
    }

    updateTargetSimulator(netBtcPerShare);
    updateScenarioTable(netBtcPerShare);
}

function updateTargetSimulator(netBtcPerShare) {
    const targetBtc = parseNum(document.getElementById('targetBtcPrice').value);
    const targetMnav = parseNum(document.getElementById('targetMnav').value);
    
    const expectedNetBps = netBtcPerShare * targetBtc;
    const expectedMstr = expectedNetBps * targetMnav;

    document.getElementById('predictedMstrPrice').innerText = "$" + formatNum(expectedMstr.toFixed(2));
    document.getElementById('predictedNetBps').innerText = "예상 Net BPS: $" + formatNum(expectedNetBps.toFixed(2));
}

function updateScenarioTable(netBtcPerShare) {
    const btcPrices = [30000, 50000, 80000, 100000, 150000, 200000, 250000, 300000, 400000, 500000];
    const multiples = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
    let html = "";
    
    btcPrices.forEach(price => {
        const netBps = netBtcPerShare * price;
        html += `<tr><td style="font-weight:bold; color:#ff9f0a;">$${formatNum(price)}</td>`;
        multiples.forEach(mult => {
            const mstrPrice = netBps * mult;
            html += `<td>$${formatNum(mstrPrice.toFixed(0))}</td>`;
        });
        html += `</tr>`;
    });
    
    document.getElementById('scenarioTable').innerHTML = html;
}

async function fetchFuturesData() {
    try {
        const frResponse = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
        const frData = await frResponse.json();
        const fundingRate = parseFloat(frData.lastFundingRate) * 100;

        const oiResponse = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
        const oiData = await oiResponse.json();
        const oi = parseFloat(oiData.openInterest);

        document.getElementById('fundingRate').innerText = fundingRate.toFixed(4) + "%";
        document.getElementById('btcOi').innerText = formatNum(oi.toFixed(2)) + " BTC";
        
        updateRiskStage(fundingRate);
        
        const statusEl = document.getElementById('dataStatus');
        statusEl.innerText = `✅ 실시간 파생 데이터 연동 완료 (${new Date().toLocaleTimeString()})`;
        statusEl.style.color = "#3fb950";

    } catch (error) {
        document.getElementById('dataStatus').innerText = "⚠️ 바이낸스 API 연결 실패. 기본 상태를 유지합니다.";
        document.getElementById('dataStatus').style.color = "#ff453a";
    }
}

function updateRiskStage(fr) {
    const riskStage = document.getElementById('futuresRiskStage');
    const riskText = document.getElementById('futuresRiskText');
    
    if (fr >= 0.1) {
        riskStage.innerText = "🔴 5단계 (극단적 과열)";
        riskStage.style.color = "#ff453a";
        riskText.innerText = "롱 포지션 과포화 상태. 롱스퀴즈(급락) 위험 최고조.";
    } else if (fr >= 0.05) {
        riskStage.innerText = "🟠 4단계 (경계)";
        riskStage.style.color = "#ff9f0a";
        riskText.innerText = "레버리지 비율 높음. 변동성 확대 주의 구간.";
    } else if (fr >= 0.01) {
        riskStage.innerText = "🟡 3단계 (상승장/약간 과열)";
        riskStage.style.color = "#ffd60a";
        riskText.innerText = "투심 강세. 레버리지 활용이 증가하는 단계.";
    } else if (fr >= 0) {
        riskStage.innerText = "🟢 2단계 (건전/중립)";
        riskStage.style.color = "#32d74b";
        riskText.innerText = "적정 레버리지. 현물 주도 상승이 가능한 건전한 시장.";
    } else {
        riskStage.innerText = "🔵 1단계 (공포/저평가)";
        riskStage.style.color = "#58a6ff";
        riskText.innerText = "숏 포지션 우위. 숏스퀴즈(급등) 발생 가능성.";
    }
}

let chartInstance = null;

window.changeChartTimeframe = async function(timeframe) {
    document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('tf-' + timeframe).classList.add('active');

    const ctx = document.getElementById('futuresChart').getContext('2d');
    
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    let limit = 90; 
    if (timeframe === '1D') limit = 3;        
    else if (timeframe === '1M') limit = 90;  
    else if (timeframe === '3M') limit = 270; 
    else if (timeframe === '6M') limit = 540; 
    else if (timeframe === '1Y') limit = 1000;

    try {
        // [업그레이드] BTC 8시간봉 가격 데이터와 펀딩비 데이터를 병렬로 동시 호출하여 듀얼 차트 구성
        const [frRes, klinesRes] = await Promise.all([
            fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${limit}`),
            fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=8h&limit=${limit}`)
        ]);

        const frData = await frRes.json();
        const klinesData = await klinesRes.json();

        const labels = frData.map(d => {
            const date = new Date(d.fundingTime);
            return timeframe === '1D' ? date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : date.toLocaleDateString();
        });
        
        const fundingRates = frData.map(d => parseFloat(d.fundingRate) * 100);
        const btcPrices = klinesData.map(k => parseFloat(k[4])); // 8시간봉 종가(Close)

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'BTC 가격 ($)',
                        data: btcPrices,
                        borderColor: '#58a6ff',
                        backgroundColor: 'rgba(88, 166, 255, 0.05)',
                        borderWidth: 2,
                        yAxisID: 'y', // 왼쪽 축
                        tension: 0.3,
                        pointRadius: 0,
                        fill: true
                    },
                    {
                        label: '펀딩비 (%)',
                        data: fundingRates,
                        borderColor: '#ff9f0a',
                        backgroundColor: 'rgba(255, 159, 10, 0.15)',
                        borderWidth: 1.5,
                        yAxisID: 'y1', // 오른쪽 축 (독립 분리)
                        tension: 0.3,
                        pointRadius: timeframe === '1Y' ? 0 : 2,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        display: true,
                        labels: { color: '#8b949e', font: { size: 11 } }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += context.dataset.yAxisID === 'y' ? '$' + formatNum(context.parsed.y) : context.parsed.y.toFixed(4) + '%';
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: { 
                        display: false 
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        grid: { color: '#21262d' },
                        ticks: { color: '#58a6ff', font: { size: 10 } }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: { drawOnChartArea: false }, // 격자선 겹침 방지
                        ticks: { color: '#ff9f0a', font: { size: 10 } }
                    }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    } catch (error) {
        console.error("차트 데이터 연동 실패:", error);
    }
};
