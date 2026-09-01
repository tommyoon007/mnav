document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    fetchFuturesData();
    updateDashboard();
    changeChartTimeframe('1M'); // 기본 차트 보기
    
    // 5분마다 실시간 펀딩비 및 OI 업데이트 (무한 루프 방지)
    setInterval(fetchFuturesData, 300000); 
});

const parseNum = (str) => parseFloat(str.toString().replace(/,/g, '')) || 0;
const formatNum = (num) => Number(num).toLocaleString('en-US', { maximumFractionDigits: 2 });

function setupEventListeners() {
    const inputs = ['btcPrice', 'mstrPrice', 'btcHoldings', 'assumedShares', 'fullyDilutedShares', 'targetBtcPrice', 'targetMnav'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => updateDashboard());
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
        statusEl.innerText = `✅ 실시간 데이터 연동 완료 (마지막 업데이트: ${new Date().toLocaleTimeString()})`;
        statusEl.style.color = "#3fb950";

    } catch (error) {
        document.getElementById('dataStatus').innerText = "⚠️ 바이낸스 API 연결 실패. 기본 데이터를 표시합니다.";
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
    
    // 메모리 누수 방지: 새 데이터를 부르기 전에 기존 차트 즉시 파기
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    // 기간별 바이낸스 API 호출 횟수 안전 한도 설정 (Max 1000)
    let limit = 90; 
    if (timeframe === '1D') limit = 3;        // 1일 (8시간 * 3)
    else if (timeframe === '1M') limit = 90;  // 1개월 (8시간 * 90)
    else if (timeframe === '3M') limit = 270; // 3개월
    else if (timeframe === '6M') limit = 540; // 6개월
    else if (timeframe === '1Y') limit = 1000;// 1년 (최대치 한도 제한 적용)

    try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${limit}`);
        const data = await response.json();

        const labels = data.map(d => {
            const date = new Date(d.fundingTime);
            return timeframe === '1D' ? date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : date.toLocaleDateString();
        });
        
        const fundingRates = data.map(d => parseFloat(d.fundingRate) * 100);

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Funding Rate (%)',
                    data: fundingRates,
                    borderColor: '#ff9f0a',
                    backgroundColor: 'rgba(255, 159, 10, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: timeframe === '1Y' ? 0 : 2, // 1Y일 때 점 크기 축소로 렌더링 최적화
                    pointHitRadius: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                return context.parsed.y.toFixed(4) + '%';
                            }
                        }
                    }
                },
                scales: {
                    x: { display: false },
                    y: {
                        grid: { color: '#30363d', drawBorder: false },
                        ticks: { color: '#8b949e', font: { size: 10 } }
                    }
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    } catch (error) {
        console.error("차트 데이터 불러오기 실패:", error);
    }
};
