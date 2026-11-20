/* ============================================================
   Live price feed — tries real sources, falls back to a
   realistic regime-switching simulator so the app NEVER
   shows a blank screen (offline / blocked network safe).
   Sources tried in order:
     1. Stooq CSV  (xauusd)          — free, no key
     2. Yahoo Finance chart API      — free, no key
     3. gold-api.com                 — free spot price
     4. Local simulator              — always available
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

  let basePrice = 2650 + Math.random() * 200; // will be overwritten by live fetch
  let regime = 0; // -1 down, 0 range, 1 up
  let regimeTimer = 0;
  let liveSource = 'Simulator';

  function seededRandom(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  const volFor = (minutes) => Math.min(0.0007 * Math.sqrt(minutes), 0.012); // sqrt-time scaling, capped at 1.2%/candle

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
      const meanRevert = (startPrice - open) * 0.004; // anchor price near start so 220 candles stay realistic
      const change = open * (drift + shock) + meanRevert;
      const close = open + change;
      const high = Math.max(open, close) + Math.abs(open * (rand() - 0.4) * vol * 0.9);
      const low = Math.min(open, close) - Math.abs(open * (rand() - 0.6) * vol * 0.9);
      candles.push({
        time: now - (count - i) * minutes * 60000,
        open, high, low, close,
        volume: Math.round(80 + rand() * 900),
      });
      price = close;
    }
    // Rebase so every timeframe ends at the same live price (like real market data)
    const factor = startPrice / price;
    if (isFinite(factor) && factor > 0) {
      candles.forEach((c) => { c.open *= factor; c.high *= factor; c.low *= factor; c.close *= factor; });
    }
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

  async function fetchJSON(url, timeoutMs = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async function fetchText(url, timeoutMs = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally { clearTimeout(t); }
  }

  async function tryLivePrice() {
    // 1) Stooq
    try {
      const txt = await fetchText('https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=csv');
      const parts = txt.trim().split('\n')[1]?.split(',');
      if (parts && parts[6]) {
        const p = parseFloat(parts[6]);
        if (p > 1000 && p < 10000) { liveSource = 'Stooq Live'; return p; }
      }
    } catch (e) { /* fall through */ }
    // 2) Yahoo Finance
    try {
      const j = await fetchJSON('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=5m&range=1d');
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price > 1000 && price < 10000) { liveSource = 'Yahoo Finance Live'; return price; }
    } catch (e) { /* fall through */ }
    // 3) gold-api.com
    try {
      const j = await fetchJSON('https://api.gold-api.com/price/XAU');
      if (j?.price > 1000 && j?.price < 10000) { liveSource = 'Gold-API Live'; return j.price; }
    } catch (e) { /* fall through */ }
    liveSource = 'Simulator (offline fallback)';
    return null;
  }

  async function init() {
    const live = await tryLivePrice();
    if (live) basePrice = live;
    const store = {};
    for (const [tf, cfg] of Object.entries(TIMEFRAMES)) {
      store[tf] = genCandles(cfg.candles, cfg.minutes, basePrice);
    }
    return store;
  }

  function getSource() { return liveSource; }
  function getBasePrice() { return basePrice; }

  const api = { TIMEFRAMES, init, tickCandle, tryLivePrice, getSource, getBasePrice, genCandles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PulseData = api;
})(typeof window !== 'undefined' ? window : globalThis);
