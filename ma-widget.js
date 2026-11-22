/* ============================================================
   이동평균선 카드 (index.html 안에 붙는 인라인 위젯)
   - ma.json : 워크플로가 매일 갱신하는 확정 봉 종가 합(prevSum) + 확정 SMA
   - 현재가   : BTC는 브라우저에서 5초마다 직접 조회(Coinbase → Binance → CoinGecko
                → live.json → ma.json 마지막 종가), MSTR은 대시보드 입력칸(#mstrPrice)
                → live.json → ma.json 마지막 종가 순서로 사용
   - script.js 는 건드리지 않는다. 전역 이름이 겹치지 않도록 IIFE 안에서만 동작하고,
     DOM id/class 는 ma- 접두사만 쓴다.
   ============================================================ */
(function () {
    "use strict";

    var card = document.getElementById("maCard");
    if (!card) return;

    var DAILY_PERIODS = [20, 50, 120, 200, 300, 365];
    var WEEKLY_PERIODS = [50, 100, 120, 200, 300, 365];
    var BTC_POLL_MS = 5000;        // BTC 실시간 시세 주기
    var LIVE_POLL_MS = 60000;      // live.json(MSTR 백업 · BTC 폴백) 확인 주기
    var MA_RELOAD_MS = 600000;     // ma.json 다시 읽는 주기 (10분)
    var STALE_HOURS = 48;

    var state = {
        ma: null,
        maError: null,
        btcPrice: null,
        btcSource: null,
        btcAt: null,
        btcFailures: 0,
        btcBusy: false,
        live: null,
        liveError: null
    };

    function el(id) {
        return document.getElementById(id);
    }

    function fetchTimeout(url, ms) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, ms);
        return fetch(url, { signal: controller.signal, cache: "no-store" })
            .finally(function () { clearTimeout(timer); });
    }

    // ── 표시 형식 ────────────────────────────────────────────
    function fmtPrice(value) {
        if (!Number.isFinite(value)) return "—";
        var digits = Math.abs(value) >= 1000 ? 0 : 2;
        return "$" + value.toLocaleString("en-US", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
    }

    function fmtGap(value) {
        if (!Number.isFinite(value)) return "—";
        return (value > 0 ? "+" : "") + value.toFixed(2) + "%";
    }

    function gapClass(value) {
        if (!Number.isFinite(value)) return "ma-flat";
        if (value > 0.0001) return "ma-up";
        if (value < -0.0001) return "ma-down";
        return "ma-flat";
    }

    function fmtKst(isoString, withDate) {
        if (!isoString) return "—";
        var date = new Date(isoString);
        if (isNaN(date.getTime())) return "—";
        var parts = new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).formatToParts(date).reduce(function (acc, part) {
            acc[part.type] = part.value;
            return acc;
        }, {});
        var clock = parts.hour + ":" + parts.minute + (withDate ? "" : ":" + parts.second);
        return withDate ? parts.month + "-" + parts.day + " " + clock : clock;
    }

    function hoursSince(isoString) {
        if (!isoString) return null;
        var time = new Date(isoString).getTime();
        if (!Number.isFinite(time)) return null;
        return (Date.now() - time) / 3600000;
    }

    function fmtAge(hours) {
        if (hours === null) return "";
        if (hours < 1) return "방금 전";
        if (hours < 48) return Math.round(hours) + "시간 전";
        return Math.round(hours / 24) + "일 전";
    }

    // 입력칸에 들어 있는 숫자만 읽는다 ("—" · "불러오는 중" 같은 표시는 null).
    function inputNumber(id) {
        var node = el(id);
        if (!node) return null;
        var value = parseFloat(String(node.value).replace(/[^0-9.\-]/g, ""));
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    function autoSyncOn() {
        var toggle = el("autoSyncToggle");
        return !toggle || toggle.checked;
    }

    // ── ma.json ────────────────────────────────────────────
    async function loadMa() {
        try {
            var res = await fetchTimeout("ma.json?_=" + Date.now(), 12000);
            if (!res.ok) throw new Error("HTTP " + res.status);
            var data = await res.json();
            if (!data || !data.symbols) throw new Error("형식 오류");
            state.ma = data;
            state.maError = null;
        } catch (error) {
            state.maError = error;
        }
        render();
    }

    // ── live.json (MSTR 현재가 · BTC 폴백) ───────────────────
    async function loadLive() {
        try {
            var res = await fetchTimeout("live.json?_=" + Date.now(), 6000);
            if (!res.ok) throw new Error("HTTP " + res.status);
            var data = await res.json();
            state.live = data || null;
            state.liveError = null;
        } catch (error) {
            state.liveError = error;
        }
        render();
    }

    // ── BTC 실시간 시세 ─────────────────────────────────────
    async function fromCoinbase() {
        var res = await fetchTimeout("https://api.coinbase.com/v2/prices/spot?currency=USD", 3500);
        if (!res.ok) throw new Error("coinbase " + res.status);
        var data = await res.json();
        var value = parseFloat(data && data.data && data.data.amount);
        if (!(value > 0)) throw new Error("coinbase 값 없음");
        return { price: value, source: "Coinbase" };
    }

    async function fromBinance() {
        var res = await fetchTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", 3500);
        if (!res.ok) throw new Error("binance " + res.status);
        var data = await res.json();
        var value = parseFloat(data && data.price);
        if (!(value > 0)) throw new Error("binance 값 없음");
        return { price: value, source: "Binance" };
    }

    async function fromGecko() {
        var res = await fetchTimeout("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", 3500);
        if (!res.ok) throw new Error("coingecko " + res.status);
        var data = await res.json();
        var value = parseFloat(data && data.bitcoin && data.bitcoin.usd);
        if (!(value > 0)) throw new Error("coingecko 값 없음");
        return { price: value, source: "CoinGecko" };
    }

    async function pollBtc() {
        // 수동 모드에서는 사용자가 넣은 입력값을 그대로 쓰고 외부 호출은 하지 않는다.
        if (!autoSyncOn()) { render(); return; }
        if (state.btcBusy) return;
        state.btcBusy = true;

        try {
            var sources = [fromCoinbase, fromBinance, fromGecko];
            for (var i = 0; i < sources.length; i++) {
                try {
                    var result = await sources[i]();
                    state.btcPrice = result.price;
                    state.btcSource = result.source;
                    state.btcAt = new Date().toISOString();
                    state.btcFailures = 0;
                    return;
                } catch (error) { /* 다음 소스로 */ }
            }

            state.btcFailures += 1;
            // 3회 연속 실패하면 live.json 값으로 대체한다.
            if (state.btcFailures >= 3 && state.live && Number.isFinite(Number(state.live.btcPrice)) && Number(state.live.btcPrice) > 0) {
                state.btcPrice = Number(state.live.btcPrice);
                state.btcSource = "live.json";
                state.btcAt = state.live.updatedAt || null;
            }
        } finally {
            state.btcBusy = false;
            render();
        }
    }

    // ── 현재가 결정 ──────────────────────────────────────────
    function quoteFor(symbolKey, prefix) {
        var data = (state.ma && state.ma.symbols && state.ma.symbols[symbolKey]) || {};
        var auto = autoSyncOn();

        if (prefix === "btc") {
            if (!auto) {
                var manual = inputNumber("btcPrice");
                if (manual) return { price: manual, source: "입력", kind: "manual" };
            }
            if (Number.isFinite(state.btcPrice) && state.btcPrice > 0) {
                return {
                    price: state.btcPrice,
                    source: state.btcSource || "실시간",
                    kind: state.btcSource === "live.json" ? "fallback" : "live"
                };
            }
            var fromInput = inputNumber("btcPrice");
            if (fromInput) return { price: fromInput, source: "실시간", kind: "live" };
            if (state.live && Number(state.live.btcPrice) > 0) {
                return { price: Number(state.live.btcPrice), source: "live.json", kind: "fallback" };
            }
            if (Number.isFinite(data.lastPrice)) {
                return { price: data.lastPrice, source: "종가", kind: "closed" };
            }
            return { price: null, source: "—", kind: "none" };
        }

        // MSTR: 대시보드 입력칸(script.js가 실시간으로 채움) → live.json → 마지막 종가
        var typed = inputNumber("mstrPrice");
        if (typed) {
            return { price: typed, source: auto ? "실시간" : "입력", kind: auto ? "live" : "manual" };
        }
        if (state.live && Number(state.live.mstrPrice) > 0) {
            return { price: Number(state.live.mstrPrice), source: "live.json", kind: "fallback" };
        }
        if (Number.isFinite(data.lastPrice)) {
            return { price: data.lastPrice, source: "종가", kind: "closed" };
        }
        return { price: null, source: "—", kind: "none" };
    }

    // ── 렌더링 ─────────────────────────────────────────────
    function rowsHtml(symbolKey, kind, price) {
        var data = state.ma && state.ma.symbols ? state.ma.symbols[symbolKey] : null;
        if (!data) return '<tr><td colspan="3" class="ma-loading">ma.json 에 데이터가 없습니다.</td></tr>';

        var block = data[kind] || {};
        var periods = kind === "daily" ? DAILY_PERIODS : WEEKLY_PERIODS;
        var unit = kind === "daily" ? "일" : "주";

        return periods.map(function (period) {
            var cell = block[String(period)];
            if (!cell || !cell.available) {
                return '<tr class="ma-row"><td class="ma-l">' + period + unit + '</td>' +
                    '<td class="ma-flat">데이터 부족</td><td class="ma-r ma-flat">—</td></tr>';
            }
            var prevSum = Number(cell.prevSum);
            var closedSma = Number(cell.closedSma);
            var sma = Number.isFinite(price) ? (prevSum + price) / period : closedSma;
            var gap = Number.isFinite(price) && sma > 0 ? ((price - sma) / sma) * 100 : null;
            return '<tr class="ma-row"><td class="ma-l">' + period + unit + '</td>' +
                '<td class="ma-price">' + fmtPrice(sma) + '</td>' +
                '<td class="ma-r ' + gapClass(gap) + '">' + fmtGap(gap) + '</td></tr>';
        }).join("");
    }

    function renderSymbol(symbolKey, prefix) {
        var body = el(prefix === "btc" ? "maBtcBody" : "maMstrBody");
        var priceEl = el(prefix === "btc" ? "maBtcPrice" : "maMstrPrice");
        var tagEl = el(prefix === "btc" ? "maBtcSource" : "maMstrSource");
        var subEl = el(prefix === "btc" ? "maBtcSub" : "maMstrSub");

        var data = state.ma && state.ma.symbols ? state.ma.symbols[symbolKey] : null;
        if (!data) {
            if (body) body.innerHTML = '<tr><td colspan="3" class="ma-loading">ma.json 을 불러오지 못했습니다.</td></tr>';
            if (priceEl) priceEl.textContent = "—";
            return;
        }

        var quote = quoteFor(symbolKey, prefix);

        if (priceEl) priceEl.textContent = Number.isFinite(quote.price) ? fmtPrice(quote.price) : "—";

        if (tagEl) {
            tagEl.textContent = quote.source;
            tagEl.className = "ma-tag" + (quote.kind === "live" || quote.kind === "manual" ? " on"
                : quote.kind === "fallback" ? " off" : "");
        }

        if (subEl) {
            if (prefix === "btc") {
                if (quote.kind === "live") {
                    subEl.textContent = quote.source + " 실시간 · " + fmtKst(state.btcAt) + " KST · " + (BTC_POLL_MS / 1000) + "초마다 갱신";
                } else if (quote.kind === "manual") {
                    subEl.textContent = "대시보드 입력값 기준 (자동 동기화 OFF)";
                } else if (quote.kind === "fallback") {
                    subEl.textContent = "실시간 연결 끊김 · live.json " + fmtKst(state.live && state.live.updatedAt, true) + " KST 값";
                } else {
                    subEl.textContent = "실시간 연결 전 · " + (data.lastDailyDate || "—") + " 종가 기준";
                }
            } else {
                if (quote.kind === "live") {
                    subEl.textContent = "대시보드 실시간 시세 · 자동 동기화 중";
                } else if (quote.kind === "manual") {
                    subEl.textContent = "대시보드 입력값 기준 (자동 동기화 OFF)";
                } else if (quote.kind === "fallback") {
                    var live = state.live || {};
                    subEl.textContent = "live.json " + fmtKst(live.updatedAt, true) + " KST 갱신" +
                        (live.mstrSession ? " · " + live.mstrSession : "");
                } else {
                    subEl.textContent = (data.lastDailyDate || "—") + " 종가 기준";
                }
            }
        }

        if (body) {
            body.innerHTML =
                '<tr class="ma-group"><td colspan="3">일봉 SMA<span>실시간가 반영</span></td></tr>' +
                rowsHtml(symbolKey, "daily", quote.price) +
                '<tr class="ma-group"><td colspan="3">주봉 SMA<span>주 마감 종가 기준</span></td></tr>' +
                rowsHtml(symbolKey, "weekly", quote.price);
        }
    }

    // ── 🟠 MVRV Z-Score 카드 ────────────────────────────────
    // ma.json 의 mvrvZ(확정치·기울기)에 위 이동평균선 카드가 쓰는 5초짜리 BTC 현재가를 얹어 추정한다.
    var MVRV_ZONES = [
        { max: 0, label: "역사적 바닥", cls: "mv-zone-floor", color: "#3fb950" },
        { max: 1, label: "저평가", cls: "mv-zone-low", color: "#58a6ff" },
        { max: 3, label: "중립", cls: "mv-zone-mid", color: "#8b949e" },
        { max: Infinity, label: "과열", cls: "mv-zone-hot", color: "#ff4d4d" }
    ];
    var MVRV_DEFAULT_SLOPE = 3.0e-5;

    function mvrvZone(value) {
        if (!Number.isFinite(value)) return null;
        for (var i = 0; i < MVRV_ZONES.length; i++) {
            if (value < MVRV_ZONES[i].max) return MVRV_ZONES[i];
        }
        return MVRV_ZONES[MVRV_ZONES.length - 1];
    }

    function fmtZ(value) {
        if (!Number.isFinite(value)) return "—";
        return (value > 0 ? "+" : "") + value.toFixed(3);
    }

    function fmtSignedPrice(delta) {
        if (!Number.isFinite(delta)) return "—";
        return (delta >= 0 ? "+" : "-") + fmtPrice(Math.abs(delta));
    }

    function renderMvrv() {
        if (!el("mvrvCard")) return;

        var zValueEl = el("mvrvZValue");
        var zSubEl = el("mvrvZSub");
        var dateBadge = el("mvrvDateBadge");
        var zoneBadge = el("mvrvZoneBadge");
        var confirmedEl = el("mvrvConfirmed");
        var confirmedSubEl = el("mvrvConfirmedSub");
        var realizedEl = el("mvrvRealized");
        var realizedSubEl = el("mvrvRealizedSub");
        var lowsEl = el("mvrvLows");

        var mvrv = state.ma && state.ma.mvrvZ;
        var zScore = mvrv ? Number(mvrv.zScore) : NaN;
        var btcClose = mvrv ? Number(mvrv.btcClose) : NaN;

        if (!mvrv || !Number.isFinite(zScore) || !Number.isFinite(btcClose)) {
            var message = state.maError
                ? "ma.json 을 불러오지 못했습니다."
                : state.ma ? "ma.json 에 mvrvZ 데이터가 없습니다." : "실시간 BTC 가격을 기다리는 중입니다.";
            if (dateBadge) {
                dateBadge.textContent = state.maError ? "ma.json 불러오기 실패" : (state.ma ? "mvrvZ 없음" : "ma.json 확인 중…");
                dateBadge.style.color = state.maError ? "#ff4d4d" : "";
            }
            if (zoneBadge) { zoneBadge.textContent = "—"; zoneBadge.className = "badge"; zoneBadge.style.color = ""; }
            if (zValueEl) zValueEl.textContent = "—";
            if (zSubEl) zSubEl.textContent = message;
            if (confirmedEl) confirmedEl.textContent = "—";
            if (confirmedSubEl) confirmedSubEl.textContent = "—";
            if (realizedEl) realizedEl.textContent = "—";
            if (realizedSubEl) realizedSubEl.textContent = "BTC가 이 가격이면 Z-Score 0";
            if (lowsEl) lowsEl.innerHTML = '<span class="mv-dot">—</span>';
            return;
        }

        var slope = Number(mvrv.slope);
        var usableSlope = Number.isFinite(slope) && slope > 0;
        var realizedPrice = Number(mvrv.realizedPrice);
        var date = mvrv.date || "—";

        // 확정치 (카드 하단 고정값)
        if (dateBadge) {
            dateBadge.textContent = "확정 " + date + " · live 5초 추정" + (mvrv.carriedOver ? " ⚠️" : "");
            dateBadge.style.color = mvrv.carriedOver ? "#ff9f0a" : "";
            dateBadge.title = "mvrvZ 기준일 · 기울기 " + (mvrv.slopeBasis || (usableSlope ? "회귀" : "—"));
        }
        if (confirmedEl) confirmedEl.textContent = fmtZ(zScore);
        if (confirmedSubEl) {
            confirmedSubEl.textContent = "@ " + fmtPrice(btcClose) + " · " + date + " 종가 기준";
        }

        // 실시간 추정치
        var quote = quoteFor("BTC-USD", "btc");
        var livePrice = Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
        var liveUsable = livePrice !== null && (quote.kind === "live" || quote.kind === "manual");
        var effectiveSlope = usableSlope ? slope : MVRV_DEFAULT_SLOPE;
        var zEst = zScore;
        if (liveUsable) {
            zEst = zScore + effectiveSlope * (livePrice - btcClose);
        }

        var zone = mvrvZone(zEst);
        if (zValueEl) {
            zValueEl.textContent = fmtZ(zEst);
            zValueEl.style.color = !zone ? "#ff9f0a"
                : zEst < 0 ? "#3fb950"
                : zEst < 1 ? "#58a6ff"
                : zEst < 3 ? "#e6edf3" : "#ff4d4d";
        }
        if (zoneBadge) {
            zoneBadge.textContent = zone ? zone.label : "—";
            zoneBadge.className = "badge" + (zone ? " " + zone.cls : "");
            zoneBadge.style.color = zone ? zone.color : "";
            zoneBadge.title = "< 0 역사적 바닥 · 0~1 저평가 · 1~3 중립 · 3 이상 과열";
        }
        if (zSubEl) {
            if (liveUsable) {
                zSubEl.textContent = quote.source + " " + fmtPrice(livePrice) +
                    " (확정가 " + fmtPrice(btcClose) + " 대비 " + fmtSignedPrice(livePrice - btcClose) + ")" +
                    " · 기울기 " + (usableSlope ? effectiveSlope.toExponential(2) : "기본값") + "/$ · 5초마다 갱신";
            } else if (livePrice !== null) {
                zSubEl.textContent = "실시간 가격 연결 끊김 · live.json " + fmtPrice(livePrice) + " 은 추정에 쓰지 않았습니다";
            } else {
                zSubEl.textContent = "실시간 가격 연결 전 · 확정치 " + date + " 기준으로 표시";
            }
        }

        // 추정 평균 매수단가 (Z = 0 이 되는 BTC 가격)
        if (realizedEl) realizedEl.textContent = Number.isFinite(realizedPrice) ? fmtPrice(realizedPrice) : "—";
        if (realizedSubEl) {
            if (Number.isFinite(realizedPrice) && livePrice !== null && realizedPrice > 0) {
                var above = ((livePrice - realizedPrice) / realizedPrice) * 100;
                realizedSubEl.textContent = "현재가가 이보다 " + (above >= 0 ? "+" : "-") + Math.abs(above).toFixed(1) + "% " +
                    (above >= 0 ? "위" : "아래") + " · Z=0 기준";
            } else {
                realizedSubEl.textContent = "BTC가 이 가격이면 Z-Score 0";
            }
        }

        // 역대 바닥 비교
        if (lowsEl) {
            var lows = Array.isArray(mvrv.historyLows) && mvrv.historyLows.length ? mvrv.historyLows : [
                { label: "2015", z: -0.57 }, { label: "2018", z: -0.47 }, { label: "2022", z: -0.34 }
            ];
            lowsEl.textContent = "";
            lows.forEach(function (low) {
                var lowZ = Number(low.z);
                var dot = document.createElement("span");
                var near = Number.isFinite(lowZ) && Math.abs(zEst - lowZ) < 0.25;
                dot.className = "mv-dot" + (near ? " mv-zone-floor" : "");
                dot.textContent = (low.label || "—") + " " + (Number.isFinite(lowZ) ? lowZ.toFixed(2) : "—");
                dot.title = (low.label || "—") + " 저점 Z-Score";
                lowsEl.appendChild(dot);
            });
        }
    }

    function renderBadge() {
        var badge = el("maUpdatedBadge");
        if (!badge) return;
        if (!state.ma) {
            badge.textContent = state.maError ? "ma.json 불러오기 실패" : "ma.json 확인 중…";
            badge.style.color = state.maError ? "#ff4d4d" : "";
            return;
        }
        var age = hoursSince(state.ma.updatedAt);
        var stale = age !== null && age > STALE_HOURS;
        badge.textContent = "ma.json " + fmtKst(state.ma.updatedAt, true) + " 갱신" +
            (age !== null ? " · " + fmtAge(age) : "") + (stale ? " ⚠️" : "");
        badge.style.color = stale ? "#ff9f0a" : "";
        var btc = state.ma.symbols["BTC-USD"] || {};
        var mstr = state.ma.symbols["MSTR"] || {};
        badge.title = "확정 일봉: BTC " + (btc.lastDailyDate || "—") + " / MSTR " + (mstr.lastDailyDate || "—");
    }

    function render() {
        if (!state.ma) {
            renderBadge();
            var btcBody = el("maBtcBody");
            var mstrBody = el("maMstrBody");
            var message = state.maError ? "ma.json 을 불러오지 못했습니다." : "불러오는 중…";
            if (btcBody) btcBody.innerHTML = '<tr><td colspan="3" class="ma-loading">' + message + '</td></tr>';
            if (mstrBody) mstrBody.innerHTML = '<tr><td colspan="3" class="ma-loading">' + message + '</td></tr>';
            renderMvrv();
            return;
        }
        renderBadge();
        renderSymbol("BTC-USD", "btc");
        renderSymbol("MSTR", "mstr");
        renderMvrv();
    }

    // ── 주기 실행 ──────────────────────────────────────────
    function startTimers() {
        setInterval(function () {
            if (document.hidden) return;
            pollBtc();
        }, BTC_POLL_MS);

        setInterval(function () {
            if (document.hidden) return;
            loadLive();
        }, LIVE_POLL_MS);

        setInterval(function () {
            if (document.hidden) return;
            loadMa();
        }, MA_RELOAD_MS);

        document.addEventListener("visibilitychange", function () {
            if (document.hidden) return;
            pollBtc();
            loadLive();
        });

        // 입력칸을 직접 고치거나(수동 모드) 자동 동기화를 다시 켜면 바로 반영한다.
        ["btcPrice", "mstrPrice", "autoSyncToggle"].forEach(function (id) {
            var node = el(id);
            if (!node) return;
            node.addEventListener(node.type === "checkbox" ? "change" : "input", function () {
                render();
            });
        });
    }

    async function init() {
        await loadMa();
        await Promise.all([pollBtc(), loadLive()]);
        render();
        startTimers();
    }

    init();
})();
