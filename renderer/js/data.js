/* ============================================================
   Price data layer — REAL realtime history first, simulator
   only as last-resort offline fallback.

   Order for history (per timeframe):
     1. Binance PAXGUSDT klines REST (data-api.binance.vision)
     2. Yahoo Finance GC=F chart REST
     3. Local simulator (offline / blocked network)

   Live tick streaming is handled by realtime.js (WebSocket).
   ============================================================ */
(function (global) {
  'use strict';

  const TIMEFRAMES = {
    M1:  { label: 'M1',  minutes: 1,   candles: 220 },
    M5:  { label: 'M5',  minutes: 5,   candles: 220 },
    M15: { label: 'M15', minutes: 15,  candles: 220 },
    H1:  { label: 'H1',  minutes: 60,  candles: 220 },
    H4:  { label: 'H4',  minutes: 240, candles: 160 },
    D1:  { label: 'D1',  minutes: 1440, candles: 140 },
  };

  let basePrice = 2650 + Math.random() * 200;
  let regime = 0, regimeTimer = 0;
  let liveSource = 'Simulator';
  let mode = 'simulator'; // 'realtime' | 'simulator'
  let ticker24h = null;
  let realtimeHandle = null;

  function seededRandom(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  const volFor = (minutes) => Math.min(0.0007 * Math.sqrt(minutes), 0.012);

  function genCandles(count, minutes, startPrice) {
    const rand = seededRandom(42 + minutes * 7 + count);
    const candles = [];
    let price = startPrice;
    let vol = volFor(minutes);
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      if (i % 30 === 0) regime = [-1, 0, 1][Math.floor(rand() * 3)];
      const drift = regime * vol * 0.3;
      const shock = (rand() - 0.5) * 2 * vol;
      const open = price;
      const meanRevert = (startPrice - open) * 0.004;
      const change = open * (drift + shock) + meanRevert;
      const close = open + change;
      const high = Math.max(open, close) + Math.abs(open * (rand() - 0.4) * vol * 0.9);
      const low = Math.min(open, close) - Math.abs(open * (rand() - 0.6) * vol * 0.9);
      candles.push({ time: now - (count - i) * minutes * 60000, open, high, low, close, volume: Math.round(80 + rand() * 900) });
      price = close;
    }
    const factor = startPrice / price;
    if (isFinite(factor) && factor > 0) candles.forEach((c) => { c.open *= factor; c.high *= factor; c.low *= factor; c.close *= factor; });
    return candles;
  }

  function tickCandle(candles, minutes) {
    const last = candles[candles.length - 1];
    const vol = volFor(minutes);
    regimeTimer++;
    if (regimeTimer > 40) { regime = [-1, 0, 1][Math.floor(Math.random() * 3)]; regimeTimer = 0; }
    const change = last.close * (regime * vol * 0.4 + (Math.random() - 0.5) * vol * 1.4);
    const next = {
      time: last.time + minutes * 60000,
      open: last.close,
      high: Math.max(last.close, last.close + change) + Math.random() * last.close * vol * 0.3,
      low: Math.min(last.close, last.close + change) - Math.random() * last.close * vol * 0.3,
      close: last.close + change,
      volume: Math.round(80 + Math.random() * 900),
    };
    candles.push(next);
    if (candles.length > 400) candles.shift();
    return next;
  }

  async function fetchJSON(url, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async function fetchText(url, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally { clearTimeout(t); }
  }

  async function tryLivePrice() {
    // 1) Binance 24h ticker (fast, CORS-enabled)
    try {
      const j = await fetchJSON('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=PAXGUSDT');
      const p = parseFloat(j.lastPrice);
      if (p > 1000 && p < 10000) { liveSource = 'Binance PAXG Live'; return p; }
    } catch (e) {}
    // 2) Stooq spot quote
    try {
      const txt = await fetchText('https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=csv');
      const parts = txt.trim().split('\n')[1]?.split(',');
      if (parts && parts[6]) {
        const p = parseFloat(parts[6]);
        if (p > 1000 && p < 10000) { liveSource = 'Stooq Live'; return p; }
      }
    } catch (e) {}
    // 3) Yahoo Finance
    try {
      const j = await fetchJSON('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=5m&range=1d');
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price > 1000 && price < 10000) { liveSource = 'Yahoo Finance Live'; return price; }
    } catch (e) {}
    liveSource = 'Simulator (offline fallback)';
    return null;
  }

  /**
   * Init store: fetch REAL history for every timeframe in parallel.
   * Any TF that fails falls back to simulator candles anchored at the
   * live price, so the chart is never blank.
   */
  async function init() {
    const store = {};
    const RT = global.PulseRealtime;
    let realCount = 0;

    // 24h ticker (header stats) — best effort, non-blocking
    if (RT) {
      RT.fetchTicker24h().then((t) => { if (t) { ticker24h = t; basePrice = t.last; } }).catch(() => {});
    }

    if (RT) {
      const jobs = Object.keys(TIMEFRAMES).map(async (tf) => {
        const cfg = TIMEFRAMES[tf];
        const hist = await RT.fetchHistory(tf, 300).catch(() => null);
        if (hist && hist.candles.length >= 30) {
          store[tf] = hist.candles;
          realCount++;
          return { tf, source: hist.source };
        }
        return { tf, source: null };
      });
      const results = await Promise.all(jobs);
      const sources = [...new Set(results.map((r) => r.source).filter(Boolean))];
      if (realCount > 0) {
        mode = 'realtime';
        liveSource = sources.join(' + ') || 'Realtime';
        // Fill any failed TFs with simulator anchored at the real last price
        const anchor = store[Object.keys(store)[0]].slice(-1)[0].close;
        basePrice = anchor;
        for (const tf of Object.keys(TIMEFRAMES)) {
          if (!store[tf]) store[tf] = genCandles(TIMEFRAMES[tf].candles, TIMEFRAMES[tf].minutes, anchor);
        }
        return store;
      }
    }

    // All real sources failed -> simulator mode
    const live = await tryLivePrice();
    if (live) basePrice = live;
    mode = 'simulator';
    for (const [tf, cfg] of Object.entries(TIMEFRAMES)) store[tf] = genCandles(cfg.candles, cfg.minutes, basePrice);
    return store;
  }

  /** Start WebSocket streaming into store. Returns handle or null in simulator mode. */
  function startRealtime(store, callbacks) {
    const RT = global.PulseRealtime;
    if (!RT || mode !== 'realtime') return null;
    if (realtimeHandle) realtimeHandle.stop();
    realtimeHandle = RT.startRealtime(store, callbacks);
    return realtimeHandle;
  }

  function stopRealtime() { if (realtimeHandle) { realtimeHandle.stop(); realtimeHandle = null; } }

  function getSource() { return liveSource; }
  function getMode() { return mode; }
  function setMode(m) { mode = m; }
  function getBasePrice() { return basePrice; }
  function getTicker() { return ticker24h; }
  function setTicker(t) { ticker24h = t; }
  function setSource(s) { liveSource = s; }

  const api = { TIMEFRAMES, init, tickCandle, tryLivePrice, startRealtime, stopRealtime, getSource, getMode, setMode, getBasePrice, getTicker, setTicker, setSource, genCandles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PulseData = api;
})(typeof window !== 'undefined' ? window : globalThis);
