/* =========================================
   MSTR / BTC / mNAV / OI / Funding History
   + BTC Derivatives Risk Warning
========================================= */

(function () {

  const GRAPH_ID =
    "mnavHistorySection";

  const DATA_URL =
    "history.json?ts=" +
    Date.now();

  let historyData = [];


  /* ---------------------------------------
     기본 스타일
  --------------------------------------- */

  function injectStyle() {

    if (
      document.getElementById(
        "mnavHistoryStyle"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "mnavHistoryStyle";

    style.textContent = `

      #${GRAPH_ID} {
        margin-top: 22px;
      }

      .history-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 18px 24px;
        border-bottom:
          1px solid
          rgba(255,255,255,.08);
      }

      .history-btn {
        padding: 9px 14px;
        border-radius: 8px;
        border:
          1px solid
          rgba(255,255,255,.10);
        background: #151c28;
        color: #b9c2cf;
        cursor: pointer;
        font-weight: 700;
      }

      .history-btn.active {
        background: #f7931a;
        color: #080b10;
        border-color: #f7931a;
      }

      .history-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        padding:
          15px 24px 5px;
        font-size: 13px;
        color: #9ca8b8;
      }

      .history-legend span {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }

      .history-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        display: inline-block;
      }

      .history-chart-wrap {
        padding:
          18px 24px 24px;
        overflow-x: auto;
      }

      .history-chart {
        width: 100%;
        min-width: 720px;
        height: 420px;
        position: relative;
      }

      .history-chart svg {
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .history-axis {
        fill: #6f7b8c;
        font-size: 11px;
      }

      .history-grid {
        stroke:
          rgba(255,255,255,.07);
        stroke-width: 1;
      }

      .history-tooltip {
        position: fixed;
        display: none;
        pointer-events: none;
        z-index: 9999;
        min-width: 190px;
        padding: 11px 13px;
        border-radius: 9px;
        border:
          1px solid
          rgba(255,255,255,.12);
        background: #111722;
        box-shadow:
          0 12px 30px
          rgba(0,0,0,.4);
        color: #e8edf3;
        font-size: 12px;
        line-height: 1.6;
      }

      .history-subtitle {
        padding:
          18px 24px 0;
        font-size: 15px;
        font-weight: 800;
        color: #dce3eb;
      }

      .history-summary {
        display: grid;
        grid-template-columns:
          repeat(5, 1fr);
        gap: 10px;
        padding:
          0 24px 22px;
      }

      .history-summary-card {
        padding: 13px;
        background: #101620;
        border:
          1px solid
          rgba(255,255,255,.07);
        border-radius: 9px;
      }

      .history-summary-label {
        font-size: 11px;
        color: #7f8b9c;
      }

      .history-summary-value {
        margin-top: 4px;
        font-size: 16px;
        font-weight: 800;
      }


      /* -----------------------------------
         Risk Warning
      ----------------------------------- */

      .risk-warning {
        margin:
          0 24px 24px;
        padding: 18px;
        border-radius: 14px;
        background: #101620;
        border:
          1px solid
          rgba(255,255,255,.08);
      }

      .risk-title {
        font-size: 14px;
        font-weight: 800;
        color: #dce3eb;
        margin-bottom: 14px;
      }

      .risk-main {
        display: flex;
        align-items: center;
        gap: 13px;
      }

      .risk-icon {
        font-size: 32px;
        line-height: 1;
      }

      .risk-level {
        font-size: 22px;
        font-weight: 900;
        letter-spacing: .5px;
      }

      .risk-data {
        margin-top: 4px;
        color: #7f8b9c;
        font-size: 11px;
      }

      .risk-message {
        margin-top: 12px;
        padding-top: 12px;
        border-top:
          1px solid
          rgba(255,255,255,.06);
        color: #929eae;
        font-size: 12px;
        line-height: 1.65;
      }

      .risk-bar {
        display: flex;
        gap: 5px;
        margin-top: 15px;
      }

      .risk-bar-item {
        height: 5px;
        flex: 1;
        border-radius: 5px;
        background:
          rgba(255,255,255,.08);
      }

      .risk-bar-item.active {
        background: currentColor;
      }


      @media (max-width: 700px) {

        .history-summary {
          grid-template-columns:
            repeat(2, 1fr);
        }

      }


      @media (max-width: 600px) {

        .history-controls {
          padding:
            15px 18px;
        }

        .history-legend {
          padding-left: 18px;
          padding-right: 18px;
        }

        .history-chart-wrap {
          padding-left: 18px;
          padding-right: 18px;
        }

        .history-subtitle {
          padding-left: 18px;
          padding-right: 18px;
        }

        .history-summary {
          padding-left: 18px;
          padding-right: 18px;
        }

        .risk-warning {
          margin-left: 18px;
          margin-right: 18px;
        }

      }

    `;

    document.head.appendChild(
      style
    );
  }


  /* ---------------------------------------
     그래프 영역
  --------------------------------------- */

  function createSection() {

    if (
      document.getElementById(
        GRAPH_ID
      )
    ) {
      return;
    }

    const section =
      document.createElement(
        "section"
      );

    section.id =
      GRAPH_ID;

    section.innerHTML = `

      <h2>
        📉 MSTR / BTC / mNAV 역사
      </h2>

      <div class="history-controls">

        <button
          class="history-btn active"
          data-period="1y">
          1년
        </button>

        <button
          class="history-btn"
          data-period="3y">
          3년
        </button>

        <button
          class="history-btn"
          data-period="all">
          전체
        </button>

      </div>


      <div class="history-legend">

        <span>
          <i
            class="history-dot"
            style="background:#ff4d5a">
          </i>
          MSTR
        </span>

        <span>
          <i
            class="history-dot"
            style="background:#f3c64e">
          </i>
          mNAV
        </span>

        <span>
          <i
            class="history-dot"
            style="background:#4d9cff">
          </i>
          BTC
        </span>

      </div>


      <div class="history-chart-wrap">

        <div
          id="historyChart"
          class="history-chart">
        </div>

      </div>


      <div class="history-subtitle">
        📊 BTC 선물 레버리지 지표
      </div>


      <div class="history-legend">

        <span>
          <i
            class="history-dot"
            style="background:#b56cff">
          </i>
          BTC OI
        </span>

        <span>
          <i
            class="history-dot"
            style="background:#5ee6a8">
          </i>
          Funding Rate
        </span>

      </div>


      <div class="history-chart-wrap">

        <div
          id="derivativesChart"
          class="history-chart">
        </div>

      </div>


      <div
        id="riskWarning"
        class="risk-warning">
      </div>


      <div
        id="historySummary"
        class="history-summary">
      </div>

    `;


    const footer =
      document.querySelector(
        "footer"
      );

    if (footer) {

      footer.parentNode.insertBefore(
        section,
        footer
      );

    } else {

      document.body.appendChild(
        section
      );

    }


    section
      .querySelectorAll(
        ".history-btn"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          () => {

            section
              .querySelectorAll(
                ".history-btn"
              )
              .forEach(
                b =>
                  b.classList.remove(
                    "active"
                  )
              );

            button.classList.add(
              "active"
            );

            draw(
              button.dataset.period
            );

          }
        );

      });

  }


  /* ---------------------------------------
     데이터
  --------------------------------------- */

  async function loadHistory() {

    try {

      const response =
        await fetch(
          DATA_URL,
          {
            cache: "no-store"
          }
        );

      if (!response.ok) {

        throw new Error(
          "history.json " +
          response.status
        );

      }


      historyData =
        await response.json();


      if (
        !Array.isArray(
          historyData
        )
      ) {

        throw new Error(
          "Invalid history data"
        );

      }


      historyData =
        historyData
          .filter(
            item =>
              item &&
              item.date
          )
          .sort(
            (a, b) =>
              new Date(a.date) -
              new Date(b.date)
          );


      draw("1y");


    } catch (error) {

      console.error(
        "History error:",
        error
      );


      const chart =
        document.getElementById(
          "historyChart"
        );


      if (chart) {

        chart.innerHTML =
          `
          <div style="
            padding:40px;
            text-align:center;
            color:#788496;
          ">
            아직 누적된 역사 데이터가 없습니다.
          </div>
          `;

      }

    }

  }


  /* ---------------------------------------
     기간
  --------------------------------------- */

  function filterData(period) {

    if (!historyData.length) {
      return [];
    }


    if (period === "all") {
      return historyData;
    }


    const days =
      period === "1y"
        ? 365
        : 1095;


    const cutoff =
      new Date();


    cutoff.setDate(
      cutoff.getDate() -
      days
    );


    return historyData.filter(
      item =>
        new Date(
          item.date
        ) >= cutoff
    );

  }


  /* ---------------------------------------
     Scale
  --------------------------------------- */

  function scale(
    value,
    min,
    max,
    outMin,
    outMax
  ) {

    if (
      !Number.isFinite(value)
    ) {
      return null;
    }


    if (max === min) {

      return (
        outMin +
        outMax
      ) / 2;

    }


    return (
      outMin +
      (
        (value - min) /
        (max - min)
      ) *
      (
        outMax - outMin
      )
    );

  }


  /* ---------------------------------------
     Format
  --------------------------------------- */

  function fmt(value) {

    if (
      !Number.isFinite(
        Number(value)
      )
    ) {
      return "—";
    }


    return Number(value)
      .toLocaleString(
        "en-US",
        {
          maximumFractionDigits: 2
        }
      );

  }


  /* ---------------------------------------
     Path
  --------------------------------------- */

  function makePath(
    values,
    range,
    x,
    y
  ) {

    let path = "";
    let started = false;


    values.forEach(
      (value, index) => {

        if (
          !Number.isFinite(
            Number(value)
          )
        ) {

          started = false;
          return;

        }


        const px =
          x(index);


        const py =
          y(
            Number(value),
            range
          );


        if (
          !Number.isFinite(py)
        ) {
          return;
        }


        path +=
          (
            started
              ? ` L ${px} ${py}`
              : `M ${px} ${py}`
          );


        started = true;

      }
    );


    return path;

  }


  /* ---------------------------------------
     Tooltip 제거
  --------------------------------------- */

  function removeTooltips() {

    document
      .querySelectorAll(
        ".history-tooltip"
      )
      .forEach(
        tooltip =>
          tooltip.remove()
      );

  }


  /* ---------------------------------------
     공통 차트
  --------------------------------------- */

  function drawBaseChart(
    container,
    data,
    series
  ) {

    if (
      !container ||
      !data.length
    ) {
      return;
    }


    const width = 1000;
    const height = 420;


    const margin = {
      top: 20,
      right: 25,
      bottom: 45,
      left: 55
    };


    const chartWidth =
      width -
      margin.left -
      margin.right;


    const chartHeight =
      height -
      margin.top -
      margin.bottom;


    function x(index) {

      if (
        data.length === 1
      ) {

        return (
          margin.left +
          chartWidth / 2
        );

      }


      return (
        margin.left +
        (
          index /
          (data.length - 1)
        ) *
        chartWidth
      );

    }


    const ranges = {};


    series.forEach(
      s => {

        const values =
          data
            .map(
              item =>
                Number(
                  item[s.key]
                )
            )
            .filter(
              Number.isFinite
            );


        if (
          values.length
        ) {

          ranges[s.key] = [
            Math.min(
              ...values
            ),
            Math.max(
              ...values
            )
          ];

        }

      }
    );


    function y(
      value,
      range
    ) {

      return scale(
        value,
        range[0],
        range[1],
        margin.top +
          chartHeight,
        margin.top
      );

    }


    let svg =
      `<svg
        viewBox="
          0 0 ${width} ${height}
        "
        preserveAspectRatio="none">

        <rect
          x="0"
          y="0"
          width="${width}"
          height="${height}"
          fill="transparent">
        </rect>
      `;


    /* Grid */

    for (
      let i = 0;
      i <= 4;
      i++
    ) {

      const gy =
        margin.top +
        (
          i / 4
        ) *
        chartHeight;


      svg += `
        <line
          class="history-grid"
          x1="${margin.left}"
          y1="${gy}"
          x2="${width - margin.right}"
          y2="${gy}">
        </line>
      `;

    }


    /* 날짜 */

    const labelCount =
      Math.min(
        7,
        data.length
      );


    for (
      let i = 0;
      i < labelCount;
      i++
    ) {

      const index =
        Math.round(
          i *
          (
            (data.length - 1) /
            Math.max(
              1,
              labelCount - 1
            )
          )
        );


      const date =
        new Date(
          data[index].date
        );


      const label =
        date.toLocaleDateString(
          "ko-KR",
          {
            year: "numeric",
            month: "short"
          }
        );


      svg += `
        <text
          class="history-axis"
          x="${x(index)}"
          y="${height - 14}"
          text-anchor="middle">
          ${label}
        </text>
      `;

    }


    /* Lines */

    series.forEach(
      s => {

        if (
          !ranges[s.key]
        ) {
          return;
        }


        svg += `
          <path
            d="${makePath(
              data.map(
                item =>
                  Number(
                    item[s.key]
                  )
              ),
              ranges[s.key],
              x,
              y
            )}"
            fill="none"
            stroke="${s.color}"
            stroke-width="3"
            vector-effect=
              "non-scaling-stroke">
          </path>
        `;

      }
    );


    /* Points */

    series.forEach(
      s => {

        if (
          !ranges[s.key]
        ) {
          return;
        }


        data.forEach(
          (item, index) => {

            const value =
              Number(
                item[s.key]
              );


            if (
              !Number.isFinite(
                value
              )
            ) {
              return;
            }


            svg += `
              <circle
                cx="${x(index)}"
                cy="${y(
                  value,
                  ranges[s.key]
                )}"
                r="3"
                fill="${s.color}"
                data-index="${index}"
                data-series="${s.key}">
              </circle>
            `;

          }
        );

      }
    );


    svg += "</svg>";


    container.innerHTML =
      svg;


    /* Tooltip */

    const tooltip =
      document.createElement(
        "div"
      );


    tooltip.className =
      "history-tooltip";


    document.body.appendChild(
      tooltip
    );


    container
      .querySelectorAll(
        "circle"
      )
      .forEach(
        point => {

          point.addEventListener(
            "mouseenter",
            event => {

              const index =
                Number(
                  point.dataset.index
                );


              const item =
                data[index];


              tooltip.innerHTML =
                `
                <strong>
                  ${item.date}
                </strong>
                <br>
                ${series.map(
                  s => {

                    const value =
                      Number(
                        item[s.key]
                      );


                    if (
                      !Number.isFinite(
                        value
                      )
                    ) {
                      return "";
                    }


                    let display;


                    if (
                      s.key ===
                      "mnav"
                    ) {

                      display =
                        Number(
                          value
                        ).toFixed(
                          2
                        ) + "×";

                    } else if (
                      s.key ===
                      "fundingRate"
                    ) {

                      display =
                        Number(
                          value
                        ).toFixed(
                          4
                        ) + "%";

                    } else if (
                      s.key ===
                      "oiBtc"
                    ) {

                      display =
                        fmt(
                          value
                        ) +
                        " BTC";

                    } else {

                      display =
                        "$" +
                        fmt(value);

                    }


                    return `
                      <br>
                      ${s.label}:
                      ${display}
                    `;

                  }
                ).join("")}
                `;


              tooltip.style.display =
                "block";

            }
          );


          point.addEventListener(
            "mousemove",
            event => {

              tooltip.style.left =
                (
                  event.clientX +
                  14
                ) + "px";


              tooltip.style.top =
                (
                  event.clientY +
                  14
                ) + "px";

            }
          );


          point.addEventListener(
            "mouseleave",
            () => {

              tooltip.style.display =
                "none";

            }
          );

        }
      );

  }


  /* =======================================
     DERIVATIVES RISK
  ======================================= */

  function calculateRisk(
    data
  ) {

    const valid =
      data.filter(
        item => {

          const oi =
            Number(
              item.oiBtc
            );

          const funding =
            Number(
              item.fundingRate
            );

          return (
            Number.isFinite(oi) &&
            Number.isFinite(funding)
          );

        }
      );


    /*
       데이터 부족
    */

    if (
      valid.length < 2
    ) {

      return {

        level:
          "DATA BUILDING",

        icon:
          "⚪",

        color:
          "#8b95a5",

        score:
          0,

        message:
          "OI와 Funding 데이터가 아직 부족합니다. 데이터를 계속 축적하는 중입니다."

      };

    }


    const latest =
      valid[
        valid.length - 1
      ];


    const latestOI =
      Number(
        latest.oiBtc
      );


    const funding =
      Number(
        latest.fundingRate
      );


    /* -----------------------------------
       7일 전 OI
    ----------------------------------- */

    const latestDate =
      new Date(
        latest.date
      );


    const targetDate =
      new Date(
        latestDate
      );


    targetDate.setDate(
      targetDate.getDate() -
      7
    );


    let previous =
      null;


    let smallestDiff =
      Infinity;


    valid.forEach(
      item => {

        const date =
          new Date(
            item.date
          );


        const diff =
          Math.abs(
            date -
            targetDate
          );


        if (
          diff < smallestDiff
        ) {

          smallestDiff =
            diff;

          previous =
            item;

        }

      }
    );


    /*
       7일 데이터가 너무 부족하면
       가장 오래된 데이터 사용
    */

    if (
      !previous
    ) {

      previous =
        valid[0];

    }


    const previousOI =
      Number(
        previous.oiBtc
      );


    let oiChange =
      0;


    if (
      previousOI > 0
    ) {

      oiChange =
        (
          (
            latestOI /
            previousOI
          ) - 1
        ) * 100;

    }


    /* -----------------------------------
       최근 BTC 변화
    ----------------------------------- */

    let btcChange =
      0;


    const btcStart =
      valid[0];


    if (
      Number(
        btcStart.btc
      ) > 0
    ) {

      btcChange =
        (
          (
            Number(
              latest.btc
            ) /
            Number(
              btcStart.btc
            )
          ) - 1
        ) * 100;

    }


    /* -----------------------------------
       Risk Score
    ----------------------------------- */

    let score =
      0;


    /*
       Funding
    */

    if (
      funding >= 0.05
    ) {

      score += 4;

    } else if (
      funding >= 0.02
    ) {

      score += 3;

    } else if (
      funding >= 0.005
    ) {

      score += 1;

    }


    /*
       음의 Funding
       = 숏 포지션 과열
    */

    if (
      funding <= -0.05
    ) {

      score += 3;

    } else if (
      funding <= -0.02
    ) {

      score += 2;

    } else if (
      funding <= -0.005
    ) {

      score += 1;

    }


    /*
       OI 증가
    */

    if (
      oiChange >= 15
    ) {

      score += 4;

    } else if (
      oiChange >= 10
    ) {

      score += 3;

    } else if (
      oiChange >= 5
    ) {

      score += 1;

    }


    /*
       BTC 상승 + OI 증가
    */

    if (
      btcChange > 5 &&
      oiChange > 10
    ) {

      score += 2;

    }


    /* -----------------------------------
       최종 Level
    ----------------------------------- */

    if (
      score >= 8
    ) {

      return {

        level:
          "EXTREME",

        icon:
          "🔴",

        color:
          "#ff4d5a",

        score,

        funding,
        oiChange,
        btcChange,

        message:
          "레버리지와 Funding이 동시에 극단적으로 높습니다. 급격한 청산과 변동성 확대에 특히 주의해야 합니다."

      };

    }


    if (
      score >= 5
    ) {

      return {

        level:
          "OVERHEATED",

        icon:
          "🟠",

        color:
          "#ff9f43",

        score,

        funding,
        oiChange,
        btcChange,

        message:
          "레버리지와 Funding이 높은 상태입니다. 추격매수 위험이 커지고 있습니다."

      };

    }


    if (
      score >= 2
    ) {

      return {

        level:
          "CAUTION",

        icon:
          "🟡",

        color:
          "#f3c64e",

        score,

        funding,
        oiChange,
        btcChange,

        message:
          "OI 또는 Funding이 증가하고 있습니다. 시장 레버리지 확대 여부를 관찰하세요."

      };

    }


    return {

      level:
        "SAFE",

      icon:
        "🟢",

      color:
        "#5ee6a8",

      score,

      funding,
      oiChange,
      btcChange,

      message:
        "현재 OI와 Funding 기준으로 특별한 과열 신호가 없습니다."

    };

  }


  /* ---------------------------------------
     Risk Warning 표시
  --------------------------------------- */

  function updateRiskWarning(
    data
  ) {

    const box =
      document.getElementById(
        "riskWarning"
      );


    if (!box) {
      return;
    }


    const risk =
      calculateRisk(
        data
      );


    let activeBars =
      0;


    if (
      risk.level ===
      "CAUTION"
    ) {

      activeBars = 2;

    } else if (
      risk.level ===
      "OVERHEATED"
    ) {

      activeBars = 3;

    } else if (
      risk.level ===
      "EXTREME"
    ) {

      activeBars = 4;

    } else if (
      risk.level ===
      "SAFE"
    ) {

      activeBars = 1;

    }


    box.innerHTML = `

      <div class="risk-title">
        🚦 BTC 파생시장 위험도
      </div>


      <div class="risk-main">

        <div class="risk-icon">
          ${risk.icon}
        </div>


        <div>

          <div
            class="risk-level"
            style="
              color:${risk.color};
            ">
            ${risk.level}
          </div>


          ${
            risk.funding !== undefined
              ? `
                <div
                  class="risk-data">

                  Funding:
                  ${
                    risk.funding >= 0
                      ? "+"
                      : ""
                  }${risk.funding.toFixed(4)}%

                  ·

                  OI 7일:
                  ${
                    risk.oiChange >= 0
                      ? "+"
                      : ""
                  }${risk.oiChange.toFixed(1)}%

                </div>
              `
              : ""
          }

        </div>

      </div>


      <div
        class="risk-bar"
        style="
          color:${risk.color};
        ">

        <div
          class="risk-bar-item
          ${activeBars >= 1
            ? "active"
            : ""}">
        </div>

        <div
          class="risk-bar-item
          ${activeBars >= 2
            ? "active"
            : ""}">
        </div>

        <div
          class="risk-bar-item
          ${activeBars >= 3
            ? "active"
            : ""}">
        </div>

        <div
          class="risk-bar-item
          ${activeBars >= 4
            ? "active"
            : ""}">
        </div>

      </div>


      <div class="risk-message">

        ${risk.message}

        ${
          risk.btcChange !== undefined
            ? `
              <br><br>
              최근 BTC 변화:
              ${
                risk.btcChange >= 0
                  ? "+"
                  : ""
              }${risk.btcChange.toFixed(1)}%
            `
            : ""
        }

      </div>

    `;

  }


  /* ---------------------------------------
     Main Draw
  --------------------------------------- */

  function draw(
    period
  ) {

    const container =
      document.getElementById(
        "historyChart"
      );


    const derivatives =
      document.getElementById(
        "derivativesChart"
      );


    const summary =
      document.getElementById(
        "historySummary"
      );


    if (
      !container ||
      !derivatives ||
      !summary
    ) {
      return;
    }


    const data =
      filterData(
        period
      );


    removeTooltips();


    if (
      !data.length
    ) {

      container.innerHTML =
        `<div style="
          padding:40px;
          text-align:center;
          color:#788496;
        ">
          데이터가 없습니다.
        </div>`;


      derivatives.innerHTML =
        "";


      summary.innerHTML =
        "";


      updateRiskWarning(
        []
      );


      return;
    }


    /* --------------------------------
       MSTR / BTC / mNAV
    -------------------------------- */

    drawBaseChart(
      container,
      data,
      [

        {
          key:
            "mstr",

          label:
            "🔴 MSTR",

          color:
            "#ff4d5a"
        },


        {
          key:
            "mnav",

          label:
            "🟡 mNAV",

          color:
            "#f3c64e"
        },


        {
          key:
            "btc",

          label:
            "🔵 BTC",

          color:
            "#4d9cff"
        }

      ]
    );


    /* --------------------------------
       OI / Funding
    -------------------------------- */

    drawBaseChart(
      derivatives,
      data,
      [

        {
          key:
            "oiBtc",

          label:
            "🟣 BTC OI",

          color:
            "#b56cff"
        },


        {
          key:
            "fundingRate",

          label:
            "🟢 Funding",

          color:
            "#5ee6a8"
        }

      ]
    );


    /* --------------------------------
       Risk Warning
    -------------------------------- */

    updateRiskWarning(
      data
    );


    /* --------------------------------
       Summary
    -------------------------------- */

    const latest =
      data[
        data.length - 1
      ];


    const first =
      data[0];


    function change(
      key
    ) {

      const a =
        Number(
          first[key]
        );


      const b =
        Number(
          latest[key]
        );


      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        a === 0
      ) {

        return null;

      }


      return (
        (
          b / a
        ) - 1
      ) * 100;

    }


    const mstrChange =
      change(
        "mstr"
      );


    const btcChange =
      change(
        "btc"
      );


    const mnavChange =
      change(
        "mnav"
      );


    const oiChange =
      change(
        "oiBtc"
      );


    summary.innerHTML = `

      <div
        class="history-summary-card">

        <div
          class="history-summary-label">
          MSTR
        </div>

        <div
          class="history-summary-value"
          style="
            color:#ff4d5a;
          ">

          $${fmt(
            latest.mstr
          )}

          ${
            mstrChange !== null
              ? `
                <span
                  style="
                    font-size:11px;
                  ">

                  ${
                    mstrChange >= 0
                      ? "+"
                      : ""
                  }${mstrChange.toFixed(1)}%

                </span>
              `
              : ""
          }

        </div>

      </div>


      <div
        class="history-summary-card">

        <div
          class="history-summary-label">
          mNAV
        </div>

        <div
          class="history-summary-value"
          style="
            color:#f3c64e;
          ">

          ${
            Number.isFinite(
              Number(
                latest.mnav
              )
            )
              ? Number(
                  latest.mnav
                ).toFixed(2) + "×"
              : "—"
          }

          ${
            mnavChange !== null
              ? `
                <span
                  style="
                    font-size:11px;
                  ">

                  ${
                    mnavChange >= 0
                      ? "+"
                      : ""
                  }${mnavChange.toFixed(1)}%

                </span>
              `
              : ""
          }

        </div>

      </div>


      <div
        class="history-summary-card">

        <div
          class="history-summary-label">
          BTC
        </div>

        <div
          class="history-summary-value"
          style="
            color:#4d9cff;
          ">

          $${fmt(
            latest.btc
          )}

          ${
            btcChange !== null
              ? `
                <span
                  style="
                    font-size:11px;
                  ">

                  ${
                    btcChange >= 0
                      ? "+"
                      : ""
                  }${btcChange.toFixed(1)}%

                </span>
              `
              : ""
          }

        </div>

      </div>


      <div
        class="history-summary-card">

        <div
          class="history-summary-label">
          BTC OI
        </div>

        <div
          class="history-summary-value"
          style="
            color:#b56cff;
          ">

          ${
            Number.isFinite(
              Number(
                latest.oiBtc
              )
            )
              ? fmt(
                  latest.oiBtc
                ) +
                " BTC"
              : "—"
          }

          ${
            oiChange !== null
              ? `
                <span
                  style="
                    font-size:11px;
                  ">

                  ${
                    oiChange >= 0
                      ? "+"
                      : ""
                  }${oiChange.toFixed(1)}%

                </span>
              `
              : ""
          }

        </div>

      </div>


      <div
        class="history-summary-card">

        <div
          class="history-summary-label">
          Funding Rate
        </div>

        <div
          class="history-summary-value"
          style="
            color:#5ee6a8;
          ">

          ${
            Number.isFinite(
              Number(
                latest.fundingRate
              )
            )
              ? (
                  Number(
                    latest.fundingRate
                  ) >= 0
                    ? "+"
                    : ""
                ) +
                Number(
                  latest.fundingRate
                ).toFixed(4) +
                "%"
              : "—"
          }

        </div>

      </div>

    `;

  }


  /* ---------------------------------------
     실행
  --------------------------------------- */

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      injectStyle();

      createSection();

      loadHistory();

    }
  );

})();
