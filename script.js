// MSTR mNAV 2.0
// Strategy의 2026-07-23 이후 정의를 반영.
// mNAV = MSTR Price / Net BTC Per Share ($)
// Net BTC = BTC Holdings - OTM Debt/BTC Price - Preferred/BTC Price + USD Reserve/BTC Price
// Fully Diluted Shares에는 ITM 전환사채/우선주 전환분 등이 포함되며,
// OTM 부채/우선주는 Net BTC에서 차감하는 구조다.

const DEFAULTS = {
    btcPrice: 78909,
    mstrPrice: 0,
    btcHoldings: 840000,
    assumedShares: 445,
    fullyDilutedShares: 532,
    otmDebt: 0,
    preferred: 0, // 입력값은 OTM 우선주만
    usdReserve: 0
};

const ids = [
    'btcPrice','mstrPrice','btcHoldings','assumedShares',
    'fullyDilutedShares','otmDebt','preferred','usdReserve',
    'targetBtcPrice','targetMnav'
];

function val(id) {
    return parseFloat(document.getElementById(id).value);
}

function money(n) {
    if (!Number.isFinite(n)) return '-';
    return '$' + n.toLocaleString('en-US', {maximumFractionDigits: 2});
}

function moneyB(n) {
    if (!Number.isFinite(n)) return '-';
    return '$' + n.toLocaleString('en-US', {maximumFractionDigits: 3}) + 'B';
}

function btcFmt(n) {
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('en-US', {maximumFractionDigits: 2}) + ' BTC';
}

function satsFmt(n) {
    if (!Number.isFinite(n)) return '-';
    return Math.round(n).toLocaleString('en-US') + ' sats';
}

function getData() {
    const btcPrice = val('btcPrice');
    const mstrPrice = val('mstrPrice');
    const btcHoldings = val('btcHoldings');
    const assumedShares = val('assumedShares');
    const fullyDilutedShares = val('fullyDilutedShares');
    const otmDebt = val('otmDebt') * 1e9;
    const otmPreferred = val('preferred') * 1e9;
    const usdReserve = val('usdReserve') * 1e9;

    if ([btcPrice, btcHoldings, assumedShares, fullyDilutedShares].some(x => !Number.isFinite(x) || x <= 0)) {
        throw new Error('BTC 가격, BTC 보유량, 주식수는 0보다 커야 합니다.');
    }
    if ([otmDebt, otmPreferred, usdReserve].some(x => !Number.isFinite(x) || x < 0)) {
    throw new Error('OTM 부채·OTM 우선주·USD Reserve는 0 이상이어야 합니다.'); 
    }

    const btcTotalValue = btcPrice * btcHoldings;

    // Strategy 정의: OTM debt/preferred는 BTC로 환산하여 차감,
    // USD Reserve는 BTC로 환산하여 가산.
    const netBtc = btcHoldings
    - (otmDebt / btcPrice)
    - (otmPreferred / btcPrice)
    + (usdReserve / btcPrice);

    const grossBpsSats = (btcHoldings * 1e8) / (assumedShares * 1e6);
    const netBpsSats = (netBtc * 1e8) / (fullyDilutedShares * 1e6);
    const grossBpsUsd = btcTotalValue / (assumedShares * 1e6);
    const netBpsUsd = (netBtc * btcPrice) / (fullyDilutedShares * 1e6);

    const mnav = Number.isFinite(mstrPrice) && mstrPrice > 0
        ? mstrPrice / netBpsUsd
        : NaN;
    const premium = Number.isFinite(mnav) ? (mnav - 1) * 100 : NaN;

    return {
        btcPrice, mstrPrice, btcHoldings, assumedShares, fullyDilutedShares,
        otmDebt, otmPreferred, usdReserve, btcTotalValue, netBtc,
        grossBpsSats, netBpsSats, grossBpsUsd, netBpsUsd, mnav, premium
    };
}

function calculate(showAlert = true) {
    try {
        const d = getData();

        document.getElementById('grossBpsSats').textContent = satsFmt(d.grossBpsSats);
        document.getElementById('netBpsSats').textContent = satsFmt(d.netBpsSats);
        document.getElementById('netBpsUsd').textContent = money(d.netBpsUsd);
        document.getElementById('mnavMultiple').textContent =
          Number.isFinite(d.mnav) ? d.mnav.toFixed(2) + '×' : '-';
        document.getElementById('premium').textContent =
            Number.isFinite(d.premium)
                ? `${d.premium >= 0 ? '+' : ''}${d.premium.toFixed(1)}% ${d.premium >= 0 ? '프리미엄' : '디스카운트'}`
                : 'MSTR 주가 입력 필요';

        document.getElementById('btcTotalValue').textContent = moneyB(d.btcTotalValue / 1e9);
        document.getElementById('seniorClaims').textContent = moneyB((d.otmDebt + d.otmPreferred) / 1e9);
        document.getElementById('reserveValue').textContent = moneyB(d.usdReserve / 1e9);
        document.getElementById('netBtc').textContent = btcFmt(d.netBtc);

        updateSignal(d.mnav);
        buildScenarioTable();

        saveInputs();
        return d;
    } catch (e) {
        if (showAlert) alert(e.message);
        return null;
    }
}

function updateSignal(mnav) {
    const el = document.getElementById('signal');
    if (!Number.isFinite(mnav)) {
        el.textContent = 'MSTR 주가를 입력하면 현재 mNAV가 계산됩니다.';
        el.className = 'signal neutral';
        return;
    }

    if (mnav >= 3) {
        el.textContent = '🔴 3× 이상 — 매우 높은 프리미엄';
        el.className = 'signal danger';
    } else if (mnav >= 2) {
        el.textContent = '🟠 2–3× — 높은 프리미엄';
        el.className = 'signal warning';
    } else if (mnav >= 1.5) {
        el.textContent = '🟡 1.5–2× — 중간 프리미엄';
        el.className = 'signal warning';
    } else if (mnav >= 1) {
        el.textContent = '🟢 1–1.5× — 비교적 낮은 프리미엄';
        el.className = 'signal success';
    } else {
        el.textContent = '🔵 1× 미만 — Net BTC 가치보다 낮은 가격';
        el.className = 'signal success';
    }
}

function predictMstrPrice() {
    try {
        const d = getData();
        const targetBtcPrice = val('targetBtcPrice');
        const targetMnav = val('targetMnav');

        if (!Number.isFinite(targetBtcPrice) || targetBtcPrice <= 0 ||
            !Number.isFinite(targetMnav) || targetMnav <= 0) {
            throw new Error('목표 BTC 가격과 목표 mNAV를 입력해주세요.');
        }

        const targetNetBtc =
    d.btcHoldings
    - (d.otmDebt / targetBtcPrice)
    - (d.otmPreferred / targetBtcPrice)
    + (d.usdReserve / targetBtcPrice);

        const targetNetBpsUsd =
            (targetNetBtc * targetBtcPrice) / (d.fullyDilutedShares * 1e6);

        const predicted = targetNetBpsUsd * targetMnav;

        document.getElementById('predictedMstrPrice').textContent = money(predicted);
        document.getElementById('predictedNetBps').textContent =
            `목표 BTC ${money(targetBtcPrice)} → Net BPS $${targetNetBpsUsd.toFixed(2)} × ${targetMnav.toFixed(2)}×`;

        saveInputs();
    } catch (e) {
        alert(e.message);
    }
}

function scenario(targetBtc) {
    document.getElementById('targetBtcPrice').value = targetBtc;
    if (!val('targetMnav') || val('targetMnav') <= 0) {
        document.getElementById('targetMnav').value = 1.5;
    }
    predictMstrPrice();
    window.scrollTo({top: document.querySelector('.quick-calc-section').offsetTop, behavior:'smooth'});
}

function buildScenarioTable() {
    let d;
    try { d = getData(); } catch (_) { return; }

    const multiples = [1, 1.25, 1.5, 2, 2.5, 3];
    const prices = [70000, 80000, 90000, 100000, 120000, 150000];
    const tbody = document.getElementById('scenarioTable');

    tbody.innerHTML = prices.map(p => {
        const targetNetBtc =
            d.btcHoldings
            - (d.otmDebt / p)
            - (d.otmPreferred / p)
            + (d.usdReserve / p);
        const netBpsUsd =
            (targetNetBtc * p) / (d.fullyDilutedShares * 1e6);

        return `<tr>
            <td><strong>$${(p/1000).toFixed(0)}K</strong></td>
            ${multiples.map(m => `<td>${money(netBpsUsd * m)}</td>`).join('')}
        </tr>`;
    }).join('');
}

function resetDefaults() {
    Object.entries(DEFAULTS).forEach(([id, value]) => {
        document.getElementById(id).value = value;
    });
    document.getElementById('targetBtcPrice').value = 100000;
    document.getElementById('targetMnav').value = 1.5;
    calculate(false);
    saveInputs();
}

function saveInputs() {
    const data = {};
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) data[id] = el.value;
    });
    localStorage.setItem('mstrCalculatorInputsV2', JSON.stringify(data));
}

function loadInputs() {
    const saved = localStorage.getItem('mstrCalculatorInputsV2');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            ids.forEach(id => {
                if (data[id] !== undefined) document.getElementById(id).value = data[id];
            });
            return;
        } catch (_) {}
    }
    Object.entries(DEFAULTS).forEach(([id, value]) => {
        document.getElementById(id).value = value;
    });
    document.getElementById('targetBtcPrice').value = 100000;
    document.getElementById('targetMnav').value = 1.5;
}

document.addEventListener('DOMContentLoaded', () => {
    loadInputs();
    calculate(false);
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', saveInputs);
        el.addEventListener('blur', () => {
            if (['targetBtcPrice','targetMnav'].includes(id)) predictMstrPrice();
            else calculate(false);
        });
        el.addEventListener('keypress', e => {
            if (e.key === 'Enter') {
                if (['targetBtcPrice','targetMnav'].includes(id)) predictMstrPrice();
                else calculate();
            }
        });
    });
});
