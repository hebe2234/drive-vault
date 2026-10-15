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
const TPL_LABEL = { ma_cross: "均線交叉", rsi_mr: "RSI 均值回歸", bollinger: "布林通道", vix_fear: "VIX 恐懼貪婪", macd: "MACD 動量", custom: "自訂程式碼" };
const TPL_PARAMS = {
  ma_cross: [{ k: "fast", label: "快線", def: 10 }, { k: "slow", label: "慢線", def: 30 }],
  rsi_mr: [{ k: "period", label: "RSI 週期", def: 14 }, { k: "oversold", label: "超賣線", def: 30 }, { k: "overbought", label: "超買線", def: 70 }],
  bollinger: [{ k: "period", label: "週期", def: 20 }, { k: "mult", label: "倍數", def: 2 }],
  vix_fear: [{ k: "lookback", label: "分位回看（天）", def: 252 }, { k: "buyPct", label: "買入分位（恐懼）", def: 0.9 }, { k: "sellPct", label: "賣出分位（安逸）", def: 0.2 }],
  macd: [{ k: "fast", label: "快 EMA", def: 12 }, { k: "slow", label: "慢 EMA", def: 26 }, { k: "sig", label: "訊號線", def: 9 }],
  custom: [],
};
const TPL_FORMULA = {
  ma_cross: p => `SMA(${p.fast}) 由下向上穿越 SMA(${p.slow}) → 買入（全倉）；由上向下跌破 → 賣出（全出）。以當根 K 棒收盤價成交。`,
  rsi_mr: p => `RSI(${p.period}) < ${p.oversold} → 買入；RSI(${p.period}) > ${p.overbought} → 賣出。賭情緒超賣超買後的均值回歸。`,
  bollinger: p => `收盤價跌破下軌（布林 ${p.period} 根、${p.mult}σ）→ 買入；漲破上軌 → 賣出。`,
  macd: p => `MACD(${p.fast},${p.slow}) 快線由下向上穿越訊號線(${p.sig}) → 買入（全倉）；由上向下跌破 → 賣出（全出）。經典動量交叉，以當根 K 棒收盤價成交。`,
  vix_fear: p => `VIX 過去 ${p.lookback || 252} 天分位數 ≥ ${p.buyPct != null ? p.buyPct : 0.9}（極度恐懼）→ 全倉買入；≤ ${p.sellPct != null ? p.sellPct : 0.2}（極度安逸）→ 全出。別人恐懼我貪婪，賭 VIX 均值回歸。`,
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
      ? `<div>上次回測（${esc(lb.date)}）：總報酬 <b class="${cls(lb.totalRet)}">${fmtPct(lb.totalRet)}</b> · Sharpe ${Number(lb.sharpe).toFixed(2)} · 最大回撤 ${fmtPct(lb.maxDD)} · 勝率 ${lb.winRate == null ? "—" : fmtPct(lb.winRate)} · ${lb.nTrades} 筆交易</div>`
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

function emaArr(closes, n) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < n) return out;
  const k = 2 / (n + 1);
  let s = 0; for (let j = 0; j < n; j++) s += closes[j];
  let e = s / n; out[n - 1] = e;
  for (let i = n; i < closes.length; i++) { e = closes[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
/* MACD: dif = EMA(fast)-EMA(slow)（i>=slow-1 起有效）；dea = dif 的 EMA(sig) */
function macdArr(closes, fast, slow, sigP) {
  const F = emaArr(closes, fast), S = emaArr(closes, slow);
  const dif = new Array(closes.length).fill(null), dea = new Array(closes.length).fill(null);
  const s0 = slow - 1, k = 2 / (sigP + 1);
  const valid = [];
  for (let i = s0; i < closes.length; i++) { if (F[i] != null && S[i] != null) { dif[i] = F[i] - S[i]; valid.push(i); } }
  if (valid.length >= sigP) {
    let e = 0; for (let j = 0; j < sigP; j++) e += dif[valid[j]]; e /= sigP;
    dea[valid[sigP - 1]] = e; let prev = e;
    for (let j = sigP; j < valid.length; j++) { prev = dif[valid[j]] * k + prev * (1 - k); dea[valid[j]] = prev; }
  }
  return { dif, dea };
}

/* 訊號：1=買, -1=賣, 0=無（訊號用當根收盤產生、當根收盤成交） */
/* ---------- VIX 資料（FRED VIXCLS，每日；vix.csv 與網站同源，無 CORS 問題） ---------- */
let _vixCache = null;
async function loadVixData() {
  if (_vixCache) return _vixCache;
  const r = await fetch("vix.csv");
  if (!r.ok) throw new Error("VIX 資料檔載入失敗（vix.csv）");
  const lines = (await r.text()).trim().split(/\r?\n/);
  const dates = [], closes = [];
  for (const ln of lines) {
    const c = ln.split(",").map(x => x.trim());
    if (/date/i.test(c[0])) continue;
    const t = Date.parse(c[0] + "T00:00:00Z"), v = parseFloat(c[1]);
    if (!isNaN(t) && !isNaN(v)) { dates.push(t); closes.push(v); }
  }
  if (!closes.length) throw new Error("VIX 資料檔是空的");
  return (_vixCache = { dates, closes });
}
/* 把 VIX 對齊到每根 K 棒：日線用當天收盤；分鐘線用前一交易日收盤（避免前視偏差） */
function alignVix(barTimes, interval, vd) {
  const m = new Map();
  vd.dates.forEach((d, i) => m.set(d, vd.closes[i]));
  const sorted = [...m.keys()].sort((a, b) => a - b);
  const out = new Array(barTimes.length).fill(null);
  let vi = 0, last = null;
  for (let i = 0; i < barTimes.length; i++) {
    const d = new Date(barTimes[i]);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const target = interval === "1d" ? day : day - 86400000;
    while (vi < sorted.length && sorted[vi] <= target) { last = m.get(sorted[vi]); vi++; }
    out[i] = last;
  }
  return out;
}

/* 訊號產生：回傳 { mode, sig, targets }
   discrete：舊式 -1/0/1（1=買、-1=賣、0=無動作）
   target：分級倉位，targets[i] 為 0~1 目標權重（null=維持不動） */
function genSignals(closes, template, p, code, vix) {
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
    return { mode: "discrete", sig };
  } else if (template === "rsi_mr") {
    const r = rsiArr(closes, p.period);
    for (let i = 0; i < n; i++) {
      if (r[i] == null) continue;
      if (r[i] < p.oversold) sig[i] = 1;
      else if (r[i] > p.overbought) sig[i] = -1;
    }
    return { mode: "discrete", sig };
  } else if (template === "bollinger") {
    const { up, dn } = bollArr(closes, p.period, p.mult);
    for (let i = 0; i < n; i++) {
      if (up[i] == null) continue;
      if (closes[i] < dn[i]) sig[i] = 1;
      else if (closes[i] > up[i]) sig[i] = -1;
    }
    return { mode: "discrete", sig };
  } else if (template === "vix_fear") {
    const lb = p.lookback || 252, bp = p.buyPct != null ? p.buyPct : 0.9, sp = p.sellPct != null ? p.sellPct : 0.2;
    for (let i = 0; i < n; i++) {
      const v = vix ? vix[i] : null;
      if (v == null || i < lb) continue;
      let cnt = 0;
      for (let k = i - lb + 1; k <= i; k++) { const w = vix[k]; if (w != null && w <= v) cnt++; }
      const pct = cnt / lb;
      if (pct >= bp) sig[i] = 1;        // 極度恐懼 → 貪婪買入（全倉）
      else if (pct <= sp) sig[i] = -1;  // 極度安逸 → 恐懼賣出（全出）
    }
    return { mode: "discrete", sig };
  } else if (template === "macd") {
    const { dif, dea } = macdArr(closes, p.fast, p.slow, p.sig);
    for (let i = 1; i < n; i++) {
      if (dif[i] == null || dea[i] == null || dif[i - 1] == null || dea[i - 1] == null) continue;
      if (dif[i - 1] <= dea[i - 1] && dif[i] > dea[i]) sig[i] = 1;
      else if (dif[i - 1] >= dea[i - 1] && dif[i] < dea[i]) sig[i] = -1;
    }
    return { mode: "discrete", sig };
  } else if (template === "custom") {
    const rsiCache = {}, bollCache = {}, macdCache = {};
    const h = {
      sma: (nn, i) => sma(closes, nn, i),
      rsi: (per) => rsiCache[per] || (rsiCache[per] = rsiArr(closes, per)),
      boll: (per, mult) => { const k = per + "_" + mult; return bollCache[k] || (bollCache[k] = bollArr(closes, per, mult)); },
      macd: (f, s2, g) => { const k = f + "_" + s2 + "_" + g; return macdCache[k] || (macdCache[k] = macdArr(closes, f, s2, g)); },
    };
    let fn;
    try {
      fn = new Function("i", "closes", "p", "sma", "rsi", "boll", "vix",
        (code || "") + "\n;return (typeof signal==='function') ? signal(i,closes,p,sma,rsi,boll,vix) : 0;");
    } catch (e) { throw new Error("自訂程式碼編譯失敗：" + e.message); }
    const raw = new Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      try { v = fn(i, closes, p, h.sma, h.rsi, h.boll, vix); }
      catch (e) { throw new Error(`自訂程式碼在第 ${i} 根 K 棒出錯：` + e.message); }
      raw[i] = v;
    }
    if (raw.some(v => typeof v === "number" && !isNaN(v) && v !== -1 && v !== 0 && v !== 1)) {
      return { mode: "target", targets: raw.map(v => (v == null || isNaN(Number(v))) ? null : Math.min(1, Math.max(0, Number(v)))) };
    }
    return { mode: "discrete", sig: raw.map(v => v === 1 ? 1 : v === -1 ? -1 : 0) };
  }
  return { mode: "discrete", sig };
}

/* 回測引擎：分級倉位 — 每根 K 棒朝目標權重（0~1）再平衡
   舊模板的 1/-1 視為 100%/0%，行為與舊版全倉進出完全一致 */
const REBAL_TOL = 0.10; // 權重偏離超過 10% 才調倉，避免頻繁小額進出手續費大出血
function runEngine(closes, template, params, feeRate, code, times, vix) {
  const fee = feeRate / 100;
  const { mode, sig, targets } = genSignals(closes, template, params, code, vix);
  const tgt = mode === "target" ? targets : sig.map(s => s === 1 ? 1 : s === -1 ? 0 : null);
  let cash = 10000, pos = 0;
  const equity = [], trades = [], markers = [], rounds = [];
  let entry = null; // discrete 模式進出場配對
  for (let i = 0; i < closes.length; i++) {
    const px = closes[i], t = tgt[i];
    if (t != null) {
      const eq = cash + pos * px, wNow = eq > 0 ? (pos * px) / eq : 0;
      if (Math.abs(t - wNow) > REBAL_TOL) {
        const dv = eq * t - pos * px; // >0 加倉，<0 減倉
        const tm = times ? times[i] : null;
        if (dv > 0 && cash > 0) {
          const spend = Math.min(dv, cash);
          pos += (spend * (1 - fee)) / px; cash -= spend;
          trades.push({ i, time: tm, dir: "buy", px, wBefore: wNow, wAfter: t });
          markers.push({ i, dir: "buy" });
          if (mode === "discrete" && !entry) entry = { idx: i, px, time: tm };
        } else if (dv < 0 && pos > 0) {
          const sellVal = Math.min(-dv, pos * px);
          cash += sellVal * (1 - fee); pos -= sellVal / px;
          trades.push({ i, time: tm, dir: "sell", px, wBefore: wNow, wAfter: t });
          markers.push({ i, dir: "sell" });
          if (mode === "discrete" && entry) {
            rounds.push({ in: entry.idx, out: i, ep: entry.px, xp: px, ret: px / entry.px - 1,
              inTime: entry.time, outTime: tm });
            entry = null;
          }
        }
      }
    }
    equity.push(cash + pos * px);
  }
  const rets = [];
  for (let i = 1; i < equity.length; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  let peak = -1e18, maxDD = 0;
  equity.forEach(e => { peak = Math.max(peak, e); maxDD = Math.min(maxDD, e / peak - 1); });
  /* 大盤基準：同一標的、同一區間的買入持有 */
  const benchEquity = closes.map(c => c / closes[0] * 10000);
  let bpeak = -1e18, bmaxDD = 0;
  benchEquity.forEach(e => { bpeak = Math.max(bpeak, e); bmaxDD = Math.min(bmaxDD, e / bpeak - 1); });
  const wins = rounds.filter(t => t.ret > 0);
  const grossW = wins.reduce((a, t) => a + t.ret, 0), grossL = -rounds.filter(t => t.ret <= 0).reduce((a, t) => a + t.ret, 0);
  const isDiscrete = mode === "discrete";
  return {
    equity, trades, rounds, markers, mode,
    totalRet: equity[equity.length - 1] / equity[0] - 1,
    sharpe: sd === 0 ? 0 : (mean / sd) * Math.sqrt(365),
    maxDD,
    winRate: isDiscrete ? (rounds.length ? wins.length / rounds.length : 0) : null,
    nTrades: isDiscrete ? rounds.length : trades.length,
    profitFactor: isDiscrete ? (grossL === 0 ? (grossW > 0 ? Infinity : 0) : grossW / grossL) : null,
    bench: { equity: benchEquity, totalRet: benchEquity[benchEquity.length - 1] / benchEquity[0] - 1, maxDD: bmaxDD },
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
    let vix = null;
    if (s.template === "vix_fear" || (s.template === "custom" && /vix/i.test(s.code || ""))) {
      const vd = await loadVixData();
      vix = alignVix(times, $("bSrc").value === "binance" ? $("bInterval").value : "1d", vd);
    }
    const r = runEngine(closes, s.template, s.params, parseFloat($("bFee").value) || 0, s.code || "", times, vix);
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
  const pf = r.profitFactor == null ? "—" : r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2);
  const wrTxt = r.winRate == null ? "—" : fmtPct(r.winRate);
  const yrs = (times && times[0] != null && r.equity.length >= 2)
    ? (times[times.length - 1] - times[0]) / (365.25 * 86400000) : 0;
  const cagrOf = eq => yrs > 0 ? Math.pow(eq[eq.length - 1] / eq[0], 1 / yrs) - 1 : null;
  const cagr = cagrOf(r.equity);
  const bcagr = r.bench ? cagrOf(r.bench.equity) : null;
  const excess = (cagr == null || bcagr == null) ? null : cagr - bcagr;
  $("bMetrics").innerHTML = `
    <div class="metric"><div class="k">策略</div><div class="v" style="font-size:14px">${esc(name)}</div></div>
    <div class="metric"><div class="k">總報酬</div><div class="v ${cls(r.totalRet)}">${fmtPct(r.totalRet)}</div></div>
    <div class="metric"><div class="k">年化報酬</div><div class="v ${cagr == null ? "" : cls(cagr)}">${cagr == null ? "—" : fmtPct(cagr)}</div></div>
    <div class="metric"><div class="k">大盤年化</div><div class="v ${bcagr == null ? "" : cls(bcagr)}">${bcagr == null ? "—" : fmtPct(bcagr)}</div></div>
    <div class="metric"><div class="k">超額年化</div><div class="v ${excess == null ? "" : cls(excess)}">${excess == null ? "—" : fmtPct(excess)}</div></div>
    <div class="metric"><div class="k">Sharpe（年化）</div><div class="v ${cls(r.sharpe)}">${r.sharpe.toFixed(2)}</div></div>
    <div class="metric"><div class="k">最大回撤</div><div class="v neg">${fmtPct(r.maxDD)}</div></div>
    <div class="metric"><div class="k">大盤最大回撤</div><div class="v neg">${r.bench ? fmtPct(r.bench.maxDD) : "—"}</div></div>
    <div class="metric"><div class="k">勝率</div><div class="v">${wrTxt}</div></div>
    <div class="metric"><div class="k">${r.mode === "target" ? "調倉次數" : "交易次數"}</div><div class="v">${r.nTrades}</div></div>
    <div class="metric"><div class="k">Profit Factor</div><div class="v">${pf}</div></div>`;
  drawChart($("bChart"), r.equity, r.markers, r.bench ? r.bench.equity : null);
  const isT = r.mode === "target";
  $("bTradesTitle").textContent = isT ? "調倉明細（近 50 筆）" : "交易明細（近 50 筆）";
  $("bTradesHead").innerHTML = isT
    ? `<tr><th>#</th><th>時間</th><th>方向</th><th class="num">價格</th><th class="num">倉位</th></tr>`
    : `<tr><th>#</th><th>進場</th><th>出場</th><th class="num">進場價</th><th class="num">出場價</th><th class="num">報酬率</th></tr>`;
  const tb = $("bTrades"); tb.innerHTML = "";
  const tlist = isT ? r.trades : r.rounds;
  tlist.slice(-50).reverse().forEach((t, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = isT
      ? `<td>${tlist.length - i}</td><td title="K 棒 #${t.i}">${fmtT(t.time)}</td>
         <td style="color:${t.dir === "buy" ? "#3ddc84" : "#ff7a7a"}">${t.dir === "buy" ? "加倉" : "減倉"}</td>
         <td class="num">${t.px.toFixed(2)}</td>
         <td class="num">${(t.wBefore * 100).toFixed(0)}% → ${(t.wAfter * 100).toFixed(0)}%</td>`
      : `<td>${tlist.length - i}</td><td title="K 棒 #${t.in}">${fmtT(t.inTime)}</td><td title="K 棒 #${t.out}">${fmtT(t.outTime)}</td>
         <td class="num">${t.ep.toFixed(2)}</td><td class="num">${t.xp.toFixed(2)}</td>
         <td class="num ${cls(t.ret)}">${fmtPct(t.ret)}</td>`;
    tb.appendChild(tr);
  });
}
function drawChart(cv, equity, markers, bench) {
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const all = (bench && bench.length === equity.length) ? equity.concat(bench) : equity;
  const min = Math.min(...all), max = Math.max(...all), rg = (max - min) || 1;
  const X = i => (i / (equity.length - 1)) * (W - 16) + 8;
  const Y = v => H - 14 - ((v - min) / rg) * (H - 40);
  ctx.strokeStyle = "#2c3852"; ctx.beginPath(); ctx.moveTo(8, Y(10000)); ctx.lineTo(W - 8, Y(10000)); ctx.stroke();
  if (bench && bench.length === equity.length) {
    ctx.strokeStyle = "#6b7688"; ctx.setLineDash([5, 4]); ctx.beginPath();
    bench.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle = "#4f8cff"; ctx.lineWidth = 2; ctx.beginPath();
  equity.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
  ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = "#8b96ad"; ctx.font = "11px sans-serif";
  ctx.fillText("max " + fmt$(max), 10, 14); ctx.fillText("min " + fmt$(min), 10, H - 4);
  ctx.fillStyle = "#4f8cff"; ctx.fillText("— 策略", W - 108, 14);
  if (bench && bench.length === equity.length) { ctx.fillStyle = "#6b7688"; ctx.fillText("- - 大盤", W - 108, 28); }
  ctx.fillStyle = "#3ddc84"; ctx.fillText("● 加倉", W - 108, 42);
  ctx.fillStyle = "#ff7a7a"; ctx.fillText("● 減倉", W - 108, 56);
  (markers || []).slice(-300).forEach(m => {
    ctx.fillStyle = m.dir === "buy" ? "#3ddc84" : "#ff7a7a";
    ctx.beginPath(); ctx.arc(X(m.i), Y(equity[m.i]), 3, 0, 7); ctx.fill();
  });
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
    let vix = null;
    if (s.template === "vix_fear" || (s.template === "custom" && /vix/i.test(s.code || ""))) {
      try { vix = alignVix(klines.map(k => k[0]), "1m", await loadVixData()); }
      catch (e) { paperLog("[自動] VIX 資料載入失敗，跳過本次"); return; }
    }
    const { mode, sig, targets } = genSignals(closes, s.template, s.params, s.code || "", vix);
    const px = closes[closes.length - 1];
    const pos = DB.paper.positions[s.symbol];
    const { equity } = paperEquity({ [s.symbol]: px });
    let statusSig = "無";
    if (mode === "discrete") {
      const last = sig[sig.length - 2]; // 用已收盤的上一根，避免未收盤跳動
      if (last === 1 && !pos) {
        const budget = equity * (runnerState.alloc / 100), qty = (budget * (1 - PAPER_FEE)) / px;
        if (budget <= DB.paper.cash && qty > 0) {
          DB.paper.positions[s.symbol] = { qty, avg: px }; DB.paper.cash -= budget;
          paperLog(`[自動] ${s.name} 買訊號 → 買入 ${qty.toFixed(6)} ${s.symbol} @ ${fmt$(px)}`);
        } else paperLog(`[自動] ${s.name} 買訊號，但現金不足`);
        statusSig = "買入";
      } else if (last === -1 && pos) {
        DB.paper.cash += pos.qty * px * (1 - PAPER_FEE);
        paperLog(`[自動] ${s.name} 賣訊號 → 平倉 ${pos.qty.toFixed(6)} ${s.symbol} @ ${fmt$(px)}`);
        delete DB.paper.positions[s.symbol];
        statusSig = "賣出";
      }
    } else {
      const lastT = targets[targets.length - 2]; // 已收盤的上一根
      if (lastT != null) {
        statusSig = `目標權重 ${(lastT * 100).toFixed(0)}%`;
        const targetVal = equity * (runnerState.alloc / 100) * lastT;
        const curVal = pos ? pos.qty * px : 0, dv = targetVal - curVal;
        if (Math.abs(dv) > equity * 0.005) {
          if (dv > 0) {
            const spend = Math.min(dv, DB.paper.cash);
            if (spend > 0) {
              const qty = (spend * (1 - PAPER_FEE)) / px;
              DB.paper.positions[s.symbol] = { qty: (pos ? pos.qty : 0) + qty, avg: px };
              DB.paper.cash -= spend;
              paperLog(`[自動] ${s.name} 加倉 → 目標 ${(lastT * 100).toFixed(0)}%，買入 ${qty.toFixed(6)} ${s.symbol} @ ${fmt$(px)}`);
            } else paperLog(`[自動] ${s.name} 加倉訊號，但現金不足`);
          } else {
            const sellVal = Math.min(-dv, curVal), qty = sellVal / px;
            DB.paper.cash += sellVal * (1 - PAPER_FEE);
            const newQty = pos.qty - qty;
            if (newQty <= 1e-9) delete DB.paper.positions[s.symbol];
            else DB.paper.positions[s.symbol] = { qty: newQty, avg: pos.avg };
            paperLog(`[自動] ${s.name} 減倉 → 目標 ${(lastT * 100).toFixed(0)}%，賣出 ${qty.toFixed(6)} ${s.symbol} @ ${fmt$(px)}`);
          }
        }
      }
    }
    saveDB(); refreshPaper();
    $("pRunnerStatus").textContent = `運行中：${s.name} @ ${s.symbol}，上次檢查 ${new Date().toLocaleTimeString()}，最新訊號=${statusSig}`;
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
