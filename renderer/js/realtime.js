/* ============================================================
   Realtime price chart — real market data, no API key needed.

   Primary stream : Binance PAXGUSDT (gold-backed token, tracks
                    XAUUSD within ~0.1-0.3%) via WebSocket kline
                    streams for ALL timeframes at once + REST
                    klines for history. True tick-by-tick updates.
   Fallback hist. : Yahoo Finance GC=F (COMEX gold futures) REST.
   Last resort    : local simulator (handled in data.js).

   Pure parsers are exported for Node unit tests.
   ============================================================ */
(function (global) {
  'use strict';

  const SYMBOL = 'PAXGUSDT';
  const REST_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
  const WS_HOSTS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];

  const TF_TO_BINANCE = { M1: '1m', M5: '5m', M15: '15m', H1: '1h', H4: '4h', D1: '1d' };
  const BINANCE_TO_TF = Object.fromEntries(Object.entries(TF_TO_BINANCE).map(([k, v]) => [v, k]));
  const TF_TO_YAHOO = {
    M1:  { interval: '1m',  range: '1d'  },
    M5:  { interval: '5m',  range: '5d'  },
    M15: { interval: '15m', range: '1mo' },
    H1:  { interval: '1h',  range: '3mo' },
    H4:  { interval: '4h',  range: '6mo' },
    D1:  { interval: '1d',  range: '2y'  },
  };

  /* ---------- pure parsers (tested) ---------- */

  // Binance REST klines: [[openTime, o, h, l, c, v, closeTime, ...], ...]
  function parseBinanceKlines(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => ({
        time: Number(r[0]),
        open: parseFloat(r[1]), high: parseFloat(r[2]),
        low: parseFloat(r[3]), close: parseFloat(r[4]),
        volume: parseFloat(r[5]) || 0,
      }))
      .filter((c) => isFinite(c.open) && isFinite(c.close) && c.high >= c.low);
  }

  // Yahoo chart JSON -> candles (filters null bars, e.g. illiquid minutes)
  function parseYahooChart(json) {
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.timestamp) return [];
    const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
    if (!q) return [];
    const out = [];
    result.timestamp.forEach((ts, i) => {
      const o = q.open && q.open[i], h = q.high && q.high[i],
            l = q.low && q.low[i], c = q.close && q.close[i];
      if (o == null || h == null || l == null || c == null) return;
      out.push({ time: ts * 1000, open: o, high: h, low: l, close: c, volume: (q.volume && q.volume[i]) || 0 });
    });
    return out;
  }

  // Binance combined-stream kline event -> { tf, candle, closed }
  function parseBinanceKlineEvent(msg) {
    const k = msg && (msg.data ? msg.data.k : msg.k);
    if (!k || !k.i) return null;
    const tf = BINANCE_TO_TF[k.i];
    if (!tf) return null;
    return {
      tf,
      closed: !!k.x,
      candle: {
        time: Number(k.t),
        open: parseFloat(k.o), high: parseFloat(k.h),
        low: parseFloat(k.l), close: parseFloat(k.c),
        volume: parseFloat(k.v) || 0,
      },
    };
  }

  // Apply a tick to a candle array: update last candle in place, or append a new one.
  function applyTick(candles, tick, maxCandles = 500) {
    if (!candles || !tick) return { isNew: false, prevClose: null };
    const last = candles[candles.length - 1];
    if (!last) { candles.push({ ...tick }); return { isNew: true, prevClose: null }; }
    if (tick.time === last.time) {
      const prevClose = last.close;
      last.open = tick.open; last.high = tick.high; last.low = tick.low;
      last.close = tick.close; last.volume = tick.volume;
      return { isNew: false, prevClose };
    }
    if (tick.time > last.time) {
      const prevClose = last.close;
      candles.push({ ...tick });
      while (candles.length > maxCandles) candles.shift();
      return { isNew: true, prevClose };
    }
    return { isNew: false, prevClose: last.close }; // stale tick, ignore
  }

  function combinedStreamUrl(host) {
    const streams = Object.values(TF_TO_BINANCE).map((i) => `${SYMBOL.toLowerCase()}@kline_${i}`).join('/');
    return `${host}/stream?streams=${streams}`;
  }

  function klinesUrl(host, tf, limit) {
    return `${host}/api/v3/klines?symbol=${SYMBOL}&interval=${TF_TO_BINANCE[tf]}&limit=${limit}`;
  }

  function yahooUrl(tf) {
    const m = TF_TO_YAHOO[tf];
    return `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${m.interval}&range=${m.range}`;
  }

  /* ---------- network helpers ---------- */

  async function fetchJSON(url, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  /** Fetch real OHLC history for one timeframe. Tries Binance, then Yahoo. */
  async function fetchHistory(tf, limit = 300) {
    for (const host of REST_HOSTS) {
      try {
        const rows = await fetchJSON(klinesUrl(host, tf, limit));
        const candles = parseBinanceKlines(rows);
        if (candles.length >= 30) return { candles, source: `Binance PAXG · ${tf}` };
      } catch (e) { /* next host */ }
    }
    try {
      const json = await fetchJSON(yahooUrl(tf));
      const candles = parseYahooChart(json).slice(-limit);
      if (candles.length >= 30) return { candles, source: `Yahoo GC=F · ${tf}` };
    } catch (e) { /* fall through */ }
    return null;
  }

  /** 24h ticker: last price, change %, day high/low, bid/ask spread. */
  async function fetchTicker24h() {
    for (const host of REST_HOSTS) {
      try {
        const j = await fetchJSON(`${host}/api/v3/ticker/24hr?symbol=${SYMBOL}`);
        if (j && j.lastPrice) {
          return {
            last: parseFloat(j.lastPrice),
            changePct: parseFloat(j.priceChangePercent),
            change: parseFloat(j.priceChange),
            high: parseFloat(j.highPrice), low: parseFloat(j.lowPrice),
            bid: parseFloat(j.bidPrice), ask: parseFloat(j.askPrice),
            open: parseFloat(j.openPrice),
          };
        }
      } catch (e) { /* next host */ }
    }
    return null;
  }

  /* ---------- WebSocket realtime client ---------- */

  /**
   * Connects to Binance combined kline streams (all TFs).
   * callbacks: onTick({tf, candle, closed, isNew}), onStatus(status, detail)
   * status: 'live' | 'reconnecting' | 'polling' | 'offline'
   * Returns a handle with stop() and a polling fallback if WS is unavailable.
   */
  function startRealtime(store, callbacks, opts = {}) {
    const onTick = callbacks.onTick || (() => {});
    const onStatus = callbacks.onStatus || (() => {});
    let ws = null, stopped = false, reconnectDelay = 2000, hostIdx = 0;
    let lastTickAt = 0, pollTimer = null, watchdogTimer = null;

    function setStatus(s, detail) { onStatus(s, detail); }

    function startPolling() {
      if (pollTimer) return;
      setStatus('polling', 'WebSocket unavailable — polling REST every 5s');
      pollTimer = setInterval(async () => {
        if (stopped) return;
        // Poll only the most recent kline for each TF (limit=2, take last)
        for (const tf of Object.keys(TF_TO_BINANCE)) {
          try {
            const rows = await fetchJSON(klinesUrl(REST_HOSTS[0], tf, 2), 6000);
            const parsed = parseBinanceKlines(rows);
            const tick = parsed[parsed.length - 1];
            if (tick && store[tf]) {
              const r = applyTick(store[tf], tick);
              lastTickAt = Date.now();
              onTick({ tf, candle: tick, closed: false, isNew: r.isNew });
            }
          } catch (e) { /* keep polling */ }
        }
      }, opts.pollMs || 5000);
    }

    function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

    function connect() {
      if (stopped) return;
      const WSImpl = global.WebSocket;
      if (!WSImpl) { startPolling(); return; }
      const url = combinedStreamUrl(WS_HOSTS[hostIdx % WS_HOSTS.length]);
      setStatus('reconnecting', `Connecting ${url.split('/')[2]}…`);
      try { ws = new WSImpl(url); } catch (e) { scheduleReconnect(); return; }

      ws.onopen = () => {
        reconnectDelay = 2000;
        stopPolling();
        setStatus('live', 'Binance PAXG WebSocket · all timeframes');
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        const parsed = parseBinanceKlineEvent(msg);
        if (!parsed || !store[parsed.tf]) return;
        const r = applyTick(store[parsed.tf], parsed.candle);
        lastTickAt = Date.now();
        onTick({ tf: parsed.tf, candle: parsed.candle, closed: parsed.closed, isNew: r.isNew });
      };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
      ws.onclose = () => {
        if (stopped) return;
        hostIdx++;
        setStatus('reconnecting', 'Connection lost — retrying…');
        scheduleReconnect();
        // If no tick for a while, polling keeps the chart alive meanwhile
        watchdogTimer = setTimeout(() => { if (!stopped && Date.now() - lastTickAt > 10000) startPolling(); }, 10000);
      };
    }

    function scheduleReconnect() {
      setTimeout(() => { if (!stopped) connect(); }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }

    connect();
    return {
      stop() {
        stopped = true;
        stopPolling();
        if (watchdogTimer) clearTimeout(watchdogTimer);
        if (ws) { try { ws.close(); } catch (e) {} ws = null; }
      },
      get lastTickAt() { return lastTickAt; },
    };
  }

  const api = {
    SYMBOL, TF_TO_BINANCE, BINANCE_TO_TF, TF_TO_YAHOO,
    parseBinanceKlines, parseYahooChart, parseBinanceKlineEvent, applyTick,
    combinedStreamUrl, klinesUrl, yahooUrl,
    fetchHistory, fetchTicker24h, startRealtime,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PulseRealtime = api;
})(typeof window !== 'undefined' ? window : globalThis);
