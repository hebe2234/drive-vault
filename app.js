/* ============ Quant Lab v1 ============ */
"use strict";

/* ---------- 小工具 ---------- */
const $ = id => document.getElementById(id);
const fmt$ = n => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtPct = n => (n * 100).toFixed(2) + "%";
const INTERVAL_MS = { "1d": 86400000, "4h": 14400000, "1h": 3600000 };
const fmtT = ms => { if (ms == null) return "—"; const d = new Date(ms), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const cls = n => n >= 0 ? "pos" : "neg";
const todayStr = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- 密碼門 ---------- */
const PASS_HASH = "1129b21a2ed9ea752cdfb776cc6fc7f8855b7345f27fc25cad9e3c5fbf14026f"; // 0806449
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function showApp() { $("gate").classList.add("hidden"); $("app").classList.remove("hidden"); }
async function unlock() {
  const v = $("pw").value, msg = $("gateMsg");
  if (!v) { msg.textContent = "請輸入密碼"; return; }
  msg.textContent = "驗證中…";
  if ((await sha256Hex(v)) === PASS_HASH) {
    sessionStorage.setItem("ql_auth", "1"); $("pw").value = ""; msg.textContent = ""; showApp();
  } else msg.textContent = "密碼錯誤，再試一次";
}
function lock() {
  sessionStorage.removeItem("ql_auth");
  $("app").classList.add("hidden"); $("gate").classList.remove("hidden");
}
function showTab(name) {
  document.querySelectorAll(".tabbtn[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  ["strat", "backtest", "paper", "live"].forEach(t => $("tab-" + t).classList.toggle("hidden", t !== name));
  if (name === "paper") refreshPaper();
  if (name === "live") renderLive();
  if (name === "backtest") refreshBacktestStratSelect();
}

/* ---------- 資料存取 ---------- */
const LS_KEY = "quantlab_v1";
function seedDB() {
  return {
    strategies: [
      { id: "s1", name: "BTC 均線交叉", market: "crypto", symbol: "BTCUSDT", template: "ma_cross",
        params: { fast: 10, slow: 30 }, stage: "backtest", created: todayStr(),
        hyp: "趨勢動能：短均線站上長均線代表買盤動能轉強，順勢持有；跌破則出場。假設趨勢在 crypto 日線級別有延續性。" },
      { id: "s2", name: "ETH RSI 均值回歸", market: "crypto", symbol: "ETHUSDT", template: "rsi_mr",
        params: { period: 14, oversold: 30, overbought: 70 }, stage: "idea", created: todayStr(),
        hyp: "情緒超賣超買後的均值回歸：散戶恐慌殺低後價格傾向反彈，RSI<30 買、>70 賣。" },
    ],
    paper: { cash: 100000, initial: 100000, positions: {}, log: [] },
  };
}
function loadDB() { try { const d = JSON.parse(localStorage.getItem(LS_KEY)); return d && d.strategies ? d : seedDB(); } catch (e) { return seedDB(); } }
function saveDB() { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
let DB = loadDB(); saveDB();

const STAGE_LABEL = { idea: "💡 點子", backtest: "📊 回測中", paper: "📝 Paper", live: "🚀 實盤", retired: "🗑 淘汰" };
const TPL_LABEL = { ma_cross: "均線交叉", rsi_mr: "RSI 均值回歸", bollinger: "布林通道", custom: "自訂程式碼" };
const TPL_PARAMS = {
  ma_cross: [{ k: "fast", label: "快線", def: 10 }, { k: "slow", label: "慢線", def: 30 }],
  rsi_mr: [{ k: "period", label: "RSI 週期", def: 14 }, { k: "oversold", label: "超賣線", def: 30 }, { k: "overbought", label: "超買線", def: 70 }],
  bollinger: [{ k: "period", label: "週期", def: 20 }, { k: "mult", label: "倍數", def: 2 }],
  custom: [],
};
const TPL_FORMULA = {
  ma_cross: p => `SMA(${p.fast}) 由下向上穿越 SMA(${p.slow}) → 買入（全倉）；由上向下跌破 → 賣出（全出）。以當根 K 棒收盤價成交。`,
  rsi_mr: p => `RSI(${p.period}) < ${p.oversold} → 買入；RSI(${p.period}) > ${p.overbought} → 賣出。賭情緒超賣超買後的均值回歸。`,
  bollinger: p => `收盤價跌破下軌（布林 ${p.period} 根、${p.mult}σ）→ 買入；漲破上軌 → 賣出。`,
};
const DEFAULT_CUSTOM_CODE =
`// signal(i, closes, p) → 回傳 1=買入, -1=賣出, 0=無動作
// 可用工具：sma(n,i)、rsi(period)[i]、boll(period,mult).up/.dn/.mid[i]
function signal(i, closes, p) {
  const f = sma(p.fast, i), s = sma(p.slow, i);
  const f0 = sma(p.fast, i - 1), s0 = sma(p.slow, i - 1);
  if (f == null || s == null || f0 == null || s0 == null) return 0;
  if (f0 <= s0 && f > s) return 1;   // 快線向上穿越慢線 → 買
  if (f0 >= s0 && f < s) return -1;  // 快線向下跌破慢線 → 賣
  return 0;
}`;

/* ---------- 策略區 ---------- */
function renderParamInputs() {
  const tpl = $("sTemplate").value, box = $("paramInputs"); box.innerHTML = "";
  $("customBox").classList.toggle("hidden", tpl !== "custom");
  const cur = editingId ? (DB.strategies.find(s => s.id === editingId) || {}) : {};
  if (tpl === "custom") {
    $("sParamsJson").value = cur.params ? JSON.stringify(cur.params) : '{"fast": 10, "slow": 30}';
    if (!editingId || !cur.code) $("sCode").value = cur.code || DEFAULT_CUSTOM_CODE;
    else $("sCode").value = cur.code;
    return;
  }
  const params = cur.params || {};
  TPL_PARAMS[tpl].forEach(p => {
    const d = document.createElement("div"); d.className = "field";
    d.innerHTML = `<label>${p.label}</label><input type="number" step="any" data-pk="${p.k}" value="${params[p.k] != null ? params[p.k] : p.def}" style="width:100px">`;
    box.appendChild(d);
  });
}
let editingId = null;
function readParams() {
  const o = {};
  document.querySelectorAll("#paramInputs input[data-pk]").forEach(i => o[i.dataset.pk] = parseFloat(i.value));
  return o;
}
function saveStrategy() {
  const name = $("sName").value.trim();
  if (!name) { alert("請輸入策略名稱"); return; }
  const tpl = $("sTemplate").value;
  let params, code = "";
  if (tpl === "custom") {
    try { params = JSON.parse($("sParamsJson").value); }
    catch (e) { alert("參數 JSON 格式錯誤：\n" + e.message); return; }
    code = $("sCode").value;
    if (!/function\s+signal\s*\(/.test(code)) { alert("程式碼裡要有 function signal(i, closes, p)"); return; }
  } else {
    params = readParams();
  }
  const prev = editingId ? (DB.strategies.find(s => s.id === editingId) || {}) : {};
  const obj = {
    id: editingId || ("s" + Date.now()),
    name, market: $("sMarket").value,
    symbol: ($("sSymbol").value.trim() || "BTCUSDT").toUpperCase(),
    template: tpl, params, code,
    stage: $("sStage").value, hyp: $("sHyp").value.trim(),
    created: prev.created || todayStr(),
    lastBacktest: prev.lastBacktest,
  };
  if (editingId) DB.strategies = DB.strategies.map(s => s.id === editingId ? obj : s);
  else DB.strategies.push(obj);
  saveDB(); resetStrategyForm(); renderStrategies(); refreshPaperStratSelect();
}
function editStrategy(id) {
  const s = DB.strategies.find(x => x.id === id); if (!s) return;
  editingId = id;
  $("sId").value = id; $("sName").value = s.name; $("sMarket").value = s.market;
  $("sSymbol").value = s.symbol; $("sTemplate").value = s.template; $("sStage").value = s.stage;
  $("sHyp").value = s.hyp || "";
  renderParamInputs();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function delStrategy(id) {
  if (!confirm("確定刪除這個策略？")) return;
  DB.strategies = DB.strategies.filter(s => s.id !== id);
  saveDB(); renderStrategies(); refreshPaperStratSelect();
}
function resetStrategyForm() {
  editingId = null; $("sId").value = ""; $("sName").value = ""; $("sSymbol").value = "";
  $("sHyp").value = ""; $("sStage").value = "idea"; $("sTemplate").value = "ma_cross"; renderParamInputs();
}
function renderStrategies() {
  const g = $("stratGrid"); g.innerHTML = "";
  $("stratCount").textContent = `（共 ${DB.strategies.length} 個）`;
  DB.strategies.forEach(s => {
    const d = document.createElement("div"); d.className = "strat";
    const pstr = Object.entries(s.params || {}).map(([k, v]) => `${k}=${v}`).join(", ");
    const logicHtml = s.template === "custom"
      ? `<pre style="background:#0d1320;padding:10px;border-radius:8px;overflow-x:auto;font-size:12px;margin:6px 0">${esc(s.code || "")}</pre>`
      : `<div style="margin:6px 0">${esc((TPL_FORMULA[s.template] || (() => ""))(s.params || {}))}</div>`;
    const lb = s.lastBacktest;
    const lbHtml = lb
      ? `<div>上次回測（${esc(lb.date)}）：總報酬 <b class="${cls(lb.totalRet)}">${fmtPct(lb.totalRet)}</b> · Sharpe ${Number(lb.sharpe).toFixed(2)} · 最大回撤 ${fmtPct(lb.maxDD)} · 勝率 ${fmtPct(lb.winRate)} · ${lb.nTrades} 筆交易</div>`
      : `<div>尚未回測 — 按「去回測」跑一次，成績會記在這裡。</div>`;
    d.innerHTML = `
      <span class="stage stage-${s.stage}">${STAGE_LABEL[s.stage] || s.stage}</span>
      <h3>${esc(s.name)}</h3>
      <div class="meta">${s.market === "crypto" ? "Crypto" : "美股"} · ${esc(s.symbol)} · ${TPL_LABEL[s.template]}（${esc(pstr)}）· ${esc(s.created || "")}</div>
      <div class="hyp">${esc(s.hyp || "（未寫假說）")}</div>
      <details style="margin:8px 0">
        <summary style="cursor:pointer;font-size:13px;color:var(--acc)">查看策略詳情</summary>
        <div style="margin-top:8px;font-size:13px;line-height:1.7">
          <div class="meta">訊號邏輯</div>${logicHtml}
          <div class="meta" style="margin-top:6px">參數</div>
          <div style="font-family:monospace;font-size:12px">${esc(JSON.stringify(s.params))}</div>
          <div class="meta" style="margin-top:6px">回測成績</div>${lbHtml}
        </div>
      </details>
      <div class="actions">
        <button class="btn sm ghost" onclick="editStrategy('${s.id}')">編輯</button>
        <button class="btn sm" onclick="quickBacktest('${s.id}')">去回測 →</button>
        <button class="btn sm ghost" onclick="delStrategy('${s.id}')">刪除</button>
      </div>`;
    g.appendChild(d);
  });
  if (!DB.strategies.length) g.innerHTML = '<p class="mut">還沒有策略，從上面新增第一個吧。</p>';
}
function quickBacktest(id) { showTab("backtest"); refreshBacktestStratSelect(); $("bStrat").value = id; syncBacktestSymbol(); }
function refreshBacktestStratSelect() {
  const sel = $("bStrat"), cur = sel.value; sel.innerHTML = "";
  DB.strategies.forEach(s => { const o = document.createElement("option"); o.value = s.id; o.textContent = `${s.name}（${s.symbol}）`; sel.appendChild(o); });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  syncBacktestSymbol();
}
function syncBacktestSymbol() {
  const s = DB.strategies.find(x => x.id === $("bStrat").value);
  if (s) $("bSymbol").value = s.symbol;
}

/* ---------- 技術指標（只用收盤價，不偷看未來） ---------- */
function sma(arr, n, i) {
  if (i < n - 1) return null;
  let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j];
  return s / n;
}
function rsiArr(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= period; l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function bollArr(closes, period, mult) {
  const up = new Array(closes.length).fill(null), dn = new Array(closes.length).fill(null), mid = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    const m = sma(closes, period, i); if (m == null) continue;
    let v = 0; for (let j = i - period + 1; j <= i; j++) v += (closes[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    mid[i] = m; up[i] = m + mult * sd; dn[i] = m - mult * sd;
  }
  return { up, dn, mid };
}

/* 訊號：1=買, -1=賣, 0=無（訊號用當根收盤產生、當根收盤成交） */
function genSignals(closes, template, p, code) {
  const n = closes.length, sig = new Array(n).fill(0);
  if (template === "ma_cross") {
    const { fast, slow } = p;
    for (let i = 1; i < n; i++) {
      const f0 = sma(closes, fast, i - 1), f1 = sma(closes, fast, i);
      const s0 = sma(closes, slow, i - 1), s1 = sma(closes, slow, i);
      if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
      if (f0 <= s0 && f1 > s1) sig[i] = 1;
      else if (f0 >= s0 && f1 < s1) sig[i] = -1;
    }
  } else if (template === "rsi_mr") {
    const r = rsiArr(closes, p.period);
    for (let i = 0; i < n; i++) {
      if (r[i] == null) continue;
      if (r[i] < p.oversold) sig[i] = 1;
      else if (r[i] > p.overbought) sig[i] = -1;
    }
  } else if (template === "bollinger") {
    const { up, dn } = bollArr(closes, p.period, p.mult);
    for (let i = 0; i < n; i++) {
      if (up[i] == null) continue;
      if (closes[i] < dn[i]) sig[i] = 1;
      else if (closes[i] > up[i]) sig[i] = -1;
    }
  } else if (template === "custom") {
    const rsiCache = {}, bollCache = {};
    const h = {
      sma: (nn, i) => sma(closes, nn, i),
      rsi: (per) => rsiCache[per] || (rsiCache[per] = rsiArr(closes, per)),
      boll: (per, mult) => { const k = per + "_" + mult; return bollCache[k] || (bollCache[k] = bollArr(closes, per, mult)); },
    };
    let fn;
    try {
      fn = new Function("i", "closes", "p", "sma", "rsi", "boll",
        (code || "") + "\n;return (typeof signal==='function') ? signal(i,closes,p) : 0;");
    } catch (e) { throw new Error("自訂程式碼編譯失敗：" + e.message); }
    for (let i = 0; i < n; i++) {
      let v = 0;
      try { v = fn(i, closes, p, h.sma, h.rsi, h.boll); }
      catch (e) { throw new Error(`自訂程式碼在第 ${i} 根 K 棒出錯：` + e.message); }
      sig[i] = v === 1 ? 1 : v === -1 ? -1 : 0;
    }
  }
  return sig;
}

/* 回測引擎：做多全倉進出 */
function runEngine(closes, template, params, feeRate, code, times) {
  const fee = feeRate / 100;
  const sig = genSignals(closes, template, params, code);
  let cash = 10000, pos = 0, entryPrice = 0, entryIdx = 0;
  const equity = [], trades = [];
  for (let i = 0; i < closes.length; i++) {
    const px = closes[i];
    if (sig[i] === 1 && pos === 0 && cash > 0) { pos = (cash * (1 - fee)) / px; entryPrice = px; entryIdx = i; cash = 0; }
    else if (sig[i] === -1 && pos > 0) {
      cash = pos * px * (1 - fee);
      trades.push({ in: entryIdx, out: i, ep: entryPrice, xp: px, ret: px / entryPrice - 1,
        inTime: times ? times[entryIdx] : null, outTime: times ? times[i] : null });
      pos = 0;
    }
    equity.push(cash + pos * px);
  }
  const rets = [];
  for (let i = 1; i < equity.length; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  let peak = -1e18, maxDD = 0;
  equity.forEach(e => { peak = Math.max(peak, e); maxDD = Math.min(maxDD, e / peak - 1); });
  const wins = trades.filter(t => t.ret > 0);
  const grossW = wins.reduce((a, t) => a + t.ret, 0), grossL = -trades.filter(t => t.ret <= 0).reduce((a, t) => a + t.ret, 0);
  return {
    equity, trades, sig,
    totalRet: equity[equity.length - 1] / equity[0] - 1,
    sharpe: sd === 0 ? 0 : (mean / sd) * Math.sqrt(365),
    maxDD, winRate: trades.length ? wins.length / trades.length : 0,
    nTrades: trades.length,
    profitFactor: grossL === 0 ? (grossW > 0 ? Infinity : 0) : grossW / grossL,
  };
}

/* ---------- 回測 UI ---------- */
function toggleCsv() { $("csvRow").classList.toggle("hidden", $("bSrc").value !== "csv"); }
/* 行情來源：data-api.binance.vision 是幣安官方公開行情站（無地區限制，優先）；
   api.binance.com 在美國會被擋（HTTP 451）；api.binance.us 是美國站備援 */
const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api.binance.us",
];
let lastNetDiag = [];
async function binanceFetch(path) {
  lastNetDiag = [];
  for (const h of BINANCE_HOSTS) {
    try {
      const r = await fetch(h + path);
      if (!r.ok) { lastNetDiag.push(h + " → HTTP " + r.status); continue; }
      return await r.json();
    } catch (e) { lastNetDiag.push(h + " → " + (e.message || "連線失敗")); }
  }
  throw new Error("三個行情來源都連不上。常見原因：Brave Shields 或擋廣告外掛擋了幣安網域、公司/學校網路限制。\n" + lastNetDiag.join("\n"));
}
/* 診斷按鈕用：逐一測試每個行情站 */
async function testConnection() {
  const el = $("bStatus");
  el.textContent = "測試中…";
  const rows = [];
  for (const h of BINANCE_HOSTS) {
    try {
      const t0 = Date.now();
      const r = await fetch(h + "/api/v3/ticker/price?symbol=BTCUSDT");
      rows.push(h + (r.ok ? ` ✅ ${(Date.now() - t0)}ms` : ` ❌ HTTP ${r.status}`));
    } catch (e) { rows.push(h + ` ❌ ${e.message || "連線失敗"}`); }
  }
  el.innerHTML = "連線測試結果：<br>" + rows.map(esc).join("<br>");
}
async function fetchBinance(symbol, interval, limit) {
  const k = await binanceFetch(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!Array.isArray(k) || !k.length) throw new Error("行情回傳格式異常，可能是交易對不存在");
  return { closes: k.map(x => parseFloat(x[4])), times: k.map(x => x[0]) };
}
/* 自訂日期區間：分頁抓取（每頁最多 1000 根），回傳 {closes, times} */
async function fetchBinanceRange(symbol, interval, startMs, endMs) {
  const step = INTERVAL_MS[interval] || 3600000;
  const hardEnd = endMs || Date.now();
  const closes = [], times = [];
  let cur = startMs, guard = 0;
  while (cur < hardEnd && guard++ < 8) {
    const k = await binanceFetch(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000&startTime=${cur}&endTime=${hardEnd}`);
    if (!Array.isArray(k) || !k.length) break;
    for (const x of k) {
      const t = x[0];
      if (t < cur) continue;
      if (t >= hardEnd) break;
      closes.push(parseFloat(x[4])); times.push(t);
    }
    const lastT = k[k.length - 1][0];
    if (k.length < 1000 || lastT + step >= hardEnd) break;
    cur = lastT + step;
  }
  if (closes.length < 60) throw new Error("該區間資料太少（至少需要 60 根 K 棒），請放寬日期範圍");
  return { closes, times };
}
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const closes = [], times = [];
  for (const ln of lines) {
    const cells = ln.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const nums = cells.map(Number).filter(v => !isNaN(v));
    if (!nums.length) continue;
    if (/date/i.test(cells[0]) && isNaN(Number(cells[0]))) continue; // header
    closes.push(nums[nums.length - 1]); // 取最後一個數字欄當收盤
    const dt = Date.parse(cells[0]);
    times.push(isNaN(dt) ? null : dt); // 第一欄若是日期就留作時間
  }
  if (closes.length < 60) throw new Error("資料太少（至少需要 60 根 K 棒）");
  return { closes, times };
}
let lastResult = null;
async function runBacktest() {
  const s = DB.strategies.find(x => x.id === $("bStrat").value);
  if (!s) { alert("請先在策略區建立策略"); return; }
  $("bRun").disabled = true; $("bStatus").textContent = "資料載入中…"; $("bResult").classList.add("hidden");
  try {
    let closes, times = null;
    if ($("bSrc").value === "binance") {
      const sym = $("bSymbol").value.trim().toUpperCase() || s.symbol;
      const iv = $("bInterval").value;
      const sMs = $("bStart").value ? new Date($("bStart").value + "T00:00:00").getTime() : null;
      const eMs = $("bEnd").value ? new Date($("bEnd").value + "T23:59:59").getTime() : null;
      if (sMs && eMs && eMs < sMs) throw new Error("結束日期不可早於開始日期");
      if (sMs) {
        const d = await fetchBinanceRange(sym, iv, sMs, eMs);
        closes = d.closes; times = d.times;
      } else {
        const d = await fetchBinance(sym, iv, 1000);
        closes = d.closes; times = d.times;
      }
    } else {
      const f = $("bCsv").files[0];
      if (!f) throw new Error("請先選擇 CSV 檔");
      const d = parseCSV(await f.text());
      closes = d.closes; times = d.times;
    }
    const r = runEngine(closes, s.template, s.params, parseFloat($("bFee").value) || 0, s.code || "", times);
    lastResult = { r, symbol: $("bSymbol").value.trim().toUpperCase() || s.symbol, name: s.name, times };
    s.lastBacktest = { date: todayStr(), totalRet: r.totalRet, sharpe: r.sharpe, maxDD: r.maxDD,
                       winRate: r.winRate, nTrades: r.nTrades };
    saveDB(); renderStrategies();
    renderBacktestResult(lastResult);
    const rangeTxt = (times && times[0] != null) ? `（${fmtT(times[0])}～${fmtT(times[times.length - 1])}）` : "";
    $("bStatus").textContent = `完成：${closes.length} 根 K 棒${rangeTxt}，${r.nTrades} 筆交易。`;
  } catch (e) { $("bStatus").textContent = "❌ " + e.message; }
  $("bRun").disabled = false;
}
function renderBacktestResult({ r, symbol, name, times }) {
  $("bResult").classList.remove("hidden");
  const pf = r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2);
  const cagr = (() => {
    if (!times || times[0] == null || r.equity.length < 2) return null;
    const yrs = (times[times.length - 1] - times[0]) / (365.25 * 86400000);
    return yrs > 0 ? Math.pow(r.equity[r.equity.length - 1] / r.equity[0], 1 / yrs) - 1 : null;
  })();
  $("bMetrics").innerHTML = `
    <div class="metric"><div class="k">策略</div><div class="v" style="font-size:14px">${esc(name)}</div></div>
    <div class="metric"><div class="k">總報酬</div><div class="v ${cls(r.totalRet)}">${fmtPct(r.totalRet)}</div></div>
    <div class="metric"><div class="k">年化報酬</div><div class="v ${cagr == null ? "" : cls(cagr)}">${cagr == null ? "—" : fmtPct(cagr)}</div></div>
    <div class="metric"><div class="k">Sharpe（年化）</div><div class="v ${cls(r.sharpe)}">${r.sharpe.toFixed(2)}</div></div>
    <div class="metric"><div class="k">最大回撤</div><div class="v neg">${fmtPct(r.maxDD)}</div></div>
    <div class="metric"><div class="k">勝率</div><div class="v">${fmtPct(r.winRate)}</div></div>
    <div class="metric"><div class="k">交易次數</div><div class="v">${r.nTrades}</div></div>
    <div class="metric"><div class="k">Profit Factor</div><div class="v">${pf}</div></div>`;
  drawChart($("bChart"), r.equity, r.trades.map(t => t.out));
  const tb = $("bTrades"); tb.innerHTML = "";
  r.trades.slice(-50).reverse().forEach((t, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.trades.length - i}</td><td title="K 棒 #${t.in}">${fmtT(t.inTime)}</td><td title="K 棒 #${t.out}">${fmtT(t.outTime)}</td>
      <td class="num">${t.ep.toFixed(2)}</td><td class="num">${t.xp.toFixed(2)}</td>
      <td class="num ${cls(t.ret)}">${fmtPct(t.ret)}</td>`;
    tb.appendChild(tr);
  });
}
function drawChart(cv, equity, exits) {
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const min = Math.min(...equity), max = Math.max(...equity), rg = (max - min) || 1;
  const X = i => (i / (equity.length - 1)) * (W - 16) + 8;
  const Y = v => H - 14 - ((v - min) / rg) * (H - 40);
  ctx.strokeStyle = "#2c3852"; ctx.beginPath(); ctx.moveTo(8, Y(10000)); ctx.lineTo(W - 8, Y(10000)); ctx.stroke();
  ctx.strokeStyle = "#4f8cff"; ctx.lineWidth = 2; ctx.beginPath();
  equity.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = "#8b96ad"; ctx.font = "11px sans-serif";
  ctx.fillText("max " + fmt$(max), 10, 14); ctx.fillText("min " + fmt$(min), 10, H - 4);
  ctx.fillStyle = "#ff7a7a";
  (exits || []).forEach(i => { ctx.beginPath(); ctx.arc(X(i), Y(equity[i]), 3, 0, 7); ctx.fill(); });
}

/* ---------- Paper Trading（虛擬） ---------- */
const PAPER_FEE = 0.001;
let priceCache = {}, priceTimer = null, runnerTimer = null, runnerState = null;

async function binancePrice(symbol) {
  const j = await binanceFetch(`/api/v3/ticker/price?symbol=${symbol}`);
  const px = parseFloat(j.price);
  if (!px) throw new Error("報價異常，可能是交易對不存在");
  return px;
}
function paperLog(msg) {
  DB.paper.log.unshift(`[${new Date().toLocaleString()}] ${msg}`);
  DB.paper.log = DB.paper.log.slice(0, 100); saveDB(); renderPaperLog();
}
function renderPaperLog() {
  const el = $("pLog");
  el.innerHTML = DB.paper.log.length ? DB.paper.log.map(x => `<div>${esc(x)}</div>`).join("") : '<div class="mut">尚無紀錄</div>';
}
function paperEquity(prices) {
  let mv = 0;
  for (const [sym, p] of Object.entries(DB.paper.positions)) mv += p.qty * (prices[sym] || p.avg);
  return { equity: DB.paper.cash + mv, mv };
}
async function refreshPaper() {
  refreshPaperStratSelect();
  const syms = new Set(Object.keys(DB.paper.positions));
  const ms = $("pSymbol").value.trim().toUpperCase(); if (ms) syms.add(ms);
  const prices = {};
  let ok = false;
  for (const s of syms) {
    try { prices[s] = await binancePrice(s); priceCache[s] = prices[s]; ok = true; }
    catch (e) { if (priceCache[s]) prices[s] = priceCache[s]; }
  }
  $("pEquityLive").innerHTML = ok ? '<span class="status-dot dot-on"></span>連線中' : '<span class="status-dot dot-off"></span>連線失敗（用快取價）';
  if (ms && prices[ms]) $("pPrice").textContent = fmt$(prices[ms]);
  const { equity, mv } = paperEquity(prices);
  $("pEquity").textContent = fmt$(equity);
  $("pCash").textContent = fmt$(DB.paper.cash);
  $("pMktVal").textContent = fmt$(mv);
  const ret = equity / DB.paper.initial - 1;
  $("pRet").innerHTML = `<span class="${cls(ret)}">${fmtPct(ret)}</span>`;
  const tb = $("pPositions"); tb.innerHTML = "";
  for (const [sym, p] of Object.entries(DB.paper.positions)) {
    const last = prices[sym] || p.avg, upnl = (last - p.avg) * p.qty;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(sym)}</td><td class="num">${p.qty}</td><td class="num">${fmt$(p.avg)}</td>
      <td class="num">${fmt$(last)}</td><td class="num ${cls(upnl)}">${fmt$(upnl)}</td>
      <td><button class="btn sm danger" onclick="paperFlatten('${esc(sym)}')">平倉</button></td>`;
    tb.appendChild(tr);
  }
  if (!Object.keys(DB.paper.positions).length) tb.innerHTML = '<tr><td colspan="6" class="mut">無持倉</td></tr>';
  renderPaperLog();
}
async function paperTrade(side) {
  const sym = $("pSymbol").value.trim().toUpperCase();
  const qty = parseFloat($("pQty").value);
  if (!sym || !(qty > 0)) { alert("請輸入交易對與數量"); return; }
  try {
    const px = await binancePrice(sym); priceCache[sym] = px;
    const P = DB.paper;
    if (side === "buy") {
      const cost = qty * px * (1 + PAPER_FEE);
      if (cost > P.cash) { alert("虛擬現金不足"); return; }
      const cur = P.positions[sym] || { qty: 0, avg: 0 };
      cur.avg = (cur.avg * cur.qty + qty * px) / (cur.qty + qty); cur.qty += qty;
      P.positions[sym] = cur; P.cash -= cost;
      paperLog(`買入 ${qty} ${sym} @ ${fmt$(px)}`);
    } else {
      const cur = P.positions[sym];
      if (!cur || cur.qty < qty) { alert("持倉不足"); return; }
      cur.qty -= qty; P.cash += qty * px * (1 - PAPER_FEE);
      if (cur.qty < 1e-9) delete P.positions[sym];
      paperLog(`賣出 ${qty} ${sym} @ ${fmt$(px)}`);
    }
    saveDB(); refreshPaper();
  } catch (e) { alert("下單失敗：" + e.message); }
}
async function paperFlatten(sym) {
  try {
    const px = await binancePrice(sym);
    const cur = DB.paper.positions[sym]; if (!cur) return;
    DB.paper.cash += cur.qty * px * (1 - PAPER_FEE);
    paperLog(`平倉 ${cur.qty} ${sym} @ ${fmt$(px)}`);
    delete DB.paper.positions[sym]; saveDB(); refreshPaper();
  } catch (e) { alert("平倉失敗：" + e.message); }
}
function resetPaper() {
  if (!confirm("重置虛擬帳戶？持倉與紀錄會清空。")) return;
  stopPaperRunner();
  DB.paper = { cash: 100000, initial: 100000, positions: {}, log: [] };
  saveDB(); refreshPaper();
}
function refreshPaperStratSelect() {
  const sel = $("pStrat"); if (!sel) return;
  const cur = sel.value; sel.innerHTML = "";
  DB.strategies.filter(s => s.stage !== "retired").forEach(s => {
    const o = document.createElement("option"); o.value = s.id; o.textContent = `${s.name}（${s.symbol}）`; sel.appendChild(o);
  });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
async function runnerTick() {
  if (!runnerState) return;
  const s = DB.strategies.find(x => x.id === runnerState.stratId);
  if (!s) { stopPaperRunner(); return; }
  try {
    const klines = await binanceFetch(`/api/v3/klines?symbol=${s.symbol}&interval=1m&limit=120`);
    const closes = klines.map(k => parseFloat(k[4]));
    const sig = genSignals(closes, s.template, s.params, s.code || "");
    const last = sig[sig.length - 2]; // 用已收盤的上一根，避免未收盤跳動
    const px = closes[closes.length - 1];
    const pos = DB.paper.positions[s.symbol];
    const { equity } = paperEquity({ [s.symbol]: px });
    if (last === 1 && !pos) {
      const budget = equity * (runnerState.alloc / 100), qty = (budget * (1 - PAPER_FEE)) / px;
      if (budget <= DB.paper.cash && qty > 0) {
        DB.paper.positions[s.symbol] = { qty, avg: px }; DB.paper.cash -= budget;
        paperLog(`[自動] ${s.name} 買訊號 → 買入 ${qty.toFixed(6)} ${s.symbol} @ ${fmt$(px)}`);
      } else paperLog(`[自動] ${s.name} 買訊號，但現金不足`);
    } else if (last === -1 && pos) {
      DB.paper.cash += pos.qty * px * (1 - PAPER_FEE);
      paperLog(`[自動] ${s.name} 賣訊號 → 平倉 ${pos.qty.toFixed(6)} ${s.symbol} @ ${fmt$(px)}`);
      delete DB.paper.positions[s.symbol];
    }
    saveDB(); refreshPaper();
    $("pRunnerStatus").textContent = `運行中：${s.name} @ ${s.symbol}，上次檢查 ${new Date().toLocaleTimeString()}，最新訊號=${last === 1 ? "買入" : last === -1 ? "賣出" : "無"}`;
  } catch (e) { $("pRunnerStatus").textContent = "自動執行出錯：" + e.message + "（會繼續重試）"; }
}
function startPaperRunner() {
  const id = $("pStrat").value;
  if (!id) { alert("請先在策略區建立策略"); return; }
  stopPaperRunner();
  runnerState = { stratId: id, alloc: parseFloat($("pAlloc").value) || 10 };
  const ms = parseInt($("pFreq").value, 10) * 1000;
  runnerTick(); runnerTimer = setInterval(runnerTick, ms);
  $("pStartBtn").classList.add("hidden"); $("pStopBtn").classList.remove("hidden");
  paperLog(`啟動自動 paper：${DB.strategies.find(s => s.id === id).name}`);
}
function stopPaperRunner() {
  if (runnerTimer) clearInterval(runnerTimer);
  runnerTimer = null; runnerState = null;
  const a = $("pStartBtn"), b = $("pStopBtn");
  if (a) a.classList.remove("hidden"); if (b) b.classList.add("hidden");
  const st = $("pRunnerStatus"); if (st) st.textContent = "已停止。";
}

/* ---------- 正式上線 ---------- */
function renderLive() {
  const list = DB.strategies.filter(s => s.stage === "live");
  const el = $("liveList");
  if (!list.length) { el.innerHTML = "尚無進入實盤階段的策略。先在策略區把階段切到「🚀 實盤」。"; return; }
  el.innerHTML = list.map(s => {
    const pstr = Object.entries(s.params || {}).map(([k, v]) => `${k}=${v}`).join(", ");
    return `<div class="strat" style="margin-bottom:10px"><h3>${esc(s.name)}</h3>
      <div class="meta">${esc(s.symbol)} · ${TPL_LABEL[s.template]}（${esc(pstr)}）</div>
      <div class="hyp">${esc(s.hyp || "")}</div></div>`;
  }).join("");
}
function killAll() {
  const syms = Object.keys(DB.paper.positions);
  if (!syms.length) { alert("目前沒有虛擬持倉"); return; }
  if (!confirm(`確定平掉全部 ${syms.length} 個虛擬持倉？`)) return;
  (async () => { for (const s of syms) await paperFlatten(s); paperLog("⛔ 緊急全部平倉已執行"); })();
}

/* ---------- 初始化 ---------- */
window.addEventListener("DOMContentLoaded", () => {
  renderParamInputs(); renderStrategies(); refreshPaperStratSelect();
  $("bStrat").addEventListener("change", syncBacktestSymbol);
  if (sessionStorage.getItem("ql_auth") === "1") showApp();
});
