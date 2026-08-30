/* =========================================
   MSTR / BTC / mNAV / OI / Funding History
   Stable Version
========================================= */

(function () {

  const GRAPH_ID = "mnavHistorySection";

  const DATA_URL =
    "history.json?ts=" + Date.now();

  let historyData = [];


  /* ---------------------------------------
     STYLE
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
      document.createElement("style");

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
        line-height: 1.55;
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

      .history-empty {
        padding: 40px;
        text-align: center;
        color: #788496;
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

      }
    `;

    document.head.appendChild(style);
  }


  /* ---------------------------------------
     SECTION
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
      document.createElement("section");

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
        id="historySummary"
        class="history-summary">
      </div>

    `;

    const footer =
      document.querySelector("footer");

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
     LOAD
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

      const json =
        await response.json();

      if (
        !Array.isArray(json)
      ) {

        throw new Error(
          "Invalid history data"
        );

      }

      historyData =
        json
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

      showError();

    }

  }


  /* ---------------------------------------
     ERROR
  --------------------------------------- */

  function showError() {

    const chart =
      document.getElementById(
        "historyChart"
      );

    const derivatives =
      document.getElementById(
        "derivativesChart"
      );

    if (chart) {

      chart.innerHTML = `
        <div class="history-empty">
          역사 데이터를 불러오지 못했습니다.
        </div>
      `;

    }

    if (derivatives) {

      derivatives.innerHTML = "";

    }

  }


  /* ---------------------------------------
     FILTER
  --------------------------------------- */

  function filterData(period) {

    if (
      !historyData.length
    ) {

      return [];

    }

    if (
      period === "all"
    ) {

      return historyData.slice();

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
     NUMBER
  --------------------------------------- */

  function toNumber(value) {

    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : null;

  }


  /* ---------------------------------------
     FORMAT
  --------------------------------------- */

  function fmt(
    value,
    digits = 2
  ) {

    const n =
      toNumber(value);

    if (
      n === null
    ) {

      return "—";

    }

    return n.toLocaleString(
      "en-US",
      {
        maximumFractionDigits:
          digits
      }
    );

  }


  /* ---------------------------------------
     SCALE
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

    if (
      max === min
    ) {

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
     PATH
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
      (raw, index) => {

        const value =
          toNumber(raw);

        if (
          value === null
        ) {

          started = false;
          return;

        }

        const px =
          x(index);

        const py =
          y(
            value,
            range
          );

        if (
          py === null
        ) {

          return;

        }

        path +=
          started
            ? ` L ${px} ${py}`
            : `M ${px} ${py}`;

        started = true;

      }
    );

    return path;

  }


  /* ---------------------------------------
     TOOLTIP
  --------------------------------------- */

  function removeOldTooltips() {

    document
      .querySelectorAll(
        ".history-tooltip"
      )
      .forEach(
        element =>
          element.remove()
      );

  }


  function createTooltip(
    container,
    data,
    series
  ) {

    removeOldTooltips();

    const tooltip =
      document.createElement("div");

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
            () => {

              const index =
                Number(
                  point.dataset.index
                );

              const item =
                data[index];

              if (!item) {
                return;
              }

              let html =
                `<strong>
                   ${item.date}
                 </strong>`;

              series.forEach(
                s => {

                  const value =
                    toNumber(
                      item[s.key]
                    );

                  if (
                    value === null
                  ) {

                    return;

                  }

                  let display;

                  if (
                    s.key ===
                    "mnav"
                  ) {

                    display =
                      value.toFixed(2) +
                      "×";

                  } else if (
                    s.key ===
                    "fundingRate"
                  ) {

                    display =
                      value.toFixed(4) +
                      "%";

                  } else if (
                    s.key ===
                    "oiBtc"
                  ) {

                    display =
                      fmt(value) +
                      " BTC";

                  } else {

                    display =
                      "$" +
                      fmt(value);

                  }

                  html +=
                    `<br>
                     ${s.label}:
                     ${display}`;

                }
              );

              tooltip.innerHTML =
                html;

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


  /* ---------------------------------------
     BASE CHART
  --------------------------------------- */

  function drawBaseChart(
    container,
    data,
    series
  ) {

    if (
      !container
    ) {

      return;

    }

    if (
      !data.length
    ) {

      container.innerHTML =
        `<div class="history-empty">
           데이터가 없습니다.
         </div>`;

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
          (
            data.length - 1
          )
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
                toNumber(
                  item[s.key]
                )
            )
            .filter(
              value =>
                value !== null
            );

        if (
          values.length
        ) {

          let min =
            Math.min(...values);

          let max =
            Math.max(...values);


          /*
             동일값이면 너무 납작해지지 않도록
             작은 여유를 준다.
          */

          if (
            min === max
          ) {

            const padding =
              Math.abs(min) *
              0.05 ||
              1;

            min -= padding;
            max += padding;

          }

          ranges[s.key] = [
            min,
            max
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
         </rect>`;


    /* -----------------------------------
       GRID
    ----------------------------------- */

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


    /* -----------------------------------
       DATE LABELS
    ----------------------------------- */

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


    /* -----------------------------------
       LINES
    ----------------------------------- */

    series.forEach(
      s => {

        if (
          !ranges[s.key]
        ) {

          return;

        }

        const values =
          data.map(
            item =>
              item[s.key]
          );

        const path =
          makePath(
            values,
            ranges[s.key],
            x,
            y
          );

        if (
          !path
        ) {

          return;

        }

        svg += `
          <path
            d="${path}"
            fill="none"
            stroke="${s.color}"
            stroke-width="3"
            vector-effect="non-scaling-stroke">
          </path>
        `;

      }
    );


    /* -----------------------------------
       POINTS
    ----------------------------------- */

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
              toNumber(
                item[s.key]
              );

            if (
              value === null
            ) {

              return;

            }

            const py =
              y(
                value,
                ranges[s.key]
              );

            if (
              py === null
            ) {

              return;

            }

            svg += `
              <circle
                cx="${x(index)}"
                cy="${py}"
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


    createTooltip(
      container,
      data,
      series
    );

  }


  /* ---------------------------------------
     CHANGE
  --------------------------------------- */

  function calculateChange(
    data,
    key
  ) {

    if (
      !data.length
    ) {

      return null;

    }

    const first =
      toNumber(
        data[0][key]
      );

    const latest =
      toNumber(
        data[data.length - 1][key]
      );

    if (
      first === null ||
      latest === null ||
      first === 0
    ) {

      return null;

    }

    return (
      (
        latest /
        first
      ) - 1
    ) * 100;

  }


  /* ---------------------------------------
     CHANGE DISPLAY
  --------------------------------------- */

  function changeHtml(
    value
  ) {

    if (
      value === null
    ) {

      return "";

    }

    return `
      <span
        style="font-size:11px">
        ${
          value >= 0
            ? "+"
            : ""
        }${value.toFixed(1)}%
      </span>
    `;

  }


  /* ---------------------------------------
     MAIN DRAW
  --------------------------------------- */

  function draw(period) {

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
      filterData(period);


    if (
      !data.length
    ) {

      container.innerHTML =
        `<div class="history-empty">
           데이터가 없습니다.
         </div>`;

      derivatives.innerHTML =
        `<div class="history-empty">
           파생상품 데이터가 없습니다.
         </div>`;

      summary.innerHTML =
        "";

      return;

    }


    /* -----------------------------------
       MSTR / mNAV / BTC
    ----------------------------------- */

    drawBaseChart(
      container,
      data,
      [

        {
          key: "mstr",
          label: "🔴 MSTR",
          color: "#ff4d5a"
        },

        {
          key: "mnav",
          label: "🟡 mNAV",
          color: "#f3c64e"
        },

        {
          key: "btc",
          label: "🔵 BTC",
          color: "#4d9cff"
        }

      ]
    );


    /* -----------------------------------
       OI / FUNDING
    ----------------------------------- */

    drawBaseChart(
      derivatives,
      data,
      [

        {
          key: "oiBtc",
          label: "🟣 BTC OI",
          color: "#b56cff"
        },

        {
          key: "fundingRate",
          label: "🟢 Funding",
          color: "#5ee6a8"
        }

      ]
    );


    /* -----------------------------------
       SUMMARY
    ----------------------------------- */

    const latest =
      data[
        data.length - 1
      ];


    const mstrChange =
      calculateChange(
        data,
        "mstr"
      );

    const btcChange =
      calculateChange(
        data,
        "btc"
      );

    const mnavChange =
      calculateChange(
        data,
        "mnav"
      );

    const oiChange =
      calculateChange(
        data,
        "oiBtc"
      );


    const funding =
      toNumber(
        latest.fundingRate
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
          style="color:#ff4d5a">

          $${fmt(
            latest.mstr
          )}

          ${changeHtml(
            mstrChange
          )}

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
          style="color:#f3c64e">

          ${
            toNumber(
              latest.mnav
            ) !== null
              ? toNumber(
                  latest.mnav
                ).toFixed(2) +
                "×"
              : "—"
          }

          ${changeHtml(
            mnavChange
          )}

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
          style="color:#4d9cff">

          $${fmt(
            latest.btc
          )}

          ${changeHtml(
            btcChange
          )}

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
          style="color:#b56cff">

          ${
            toNumber(
              latest.oiBtc
            ) !== null
              ? fmt(
                  latest.oiBtc
                ) +
                " BTC"
              : "—"
          }

          ${changeHtml(
            oiChange
          )}

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
          style="color:#5ee6a8">

          ${
            funding !== null
              ? funding.toFixed(4) +
                "%"
              : "—"
          }

        </div>

      </div>

    `;

  }


  /* ---------------------------------------
     START
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
