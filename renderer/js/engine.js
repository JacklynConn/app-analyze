/* ============================================================
   XAUUSD PULSE PRO — Signal Engine
   9-indicator confluence: EMA trend, RSI, MACD, Bollinger,
   Stochastic, ATR, VWAP, Support/Resistance, Momentum.
   Pure functions — fully testable in Node (see tests/).
   ============================================================ */
(function (global) {
  'use strict';

  const closes = (candles) => candles.map((c) => c.close);
  const highs = (candles) => candles.map((c) => c.high);
  const lows = (candles) => candles.map((c) => c.low);

  function ema(values, period) {
    if (values.length < period) return values.length ? values[values.length - 1] : 0;
    const k = 2 / (period + 1);
    let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
    return e;
  }

  function emaSeries(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = e;
    for (let i = period; i < values.length; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }

  function rsi(values, period = 14) {
    if (values.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  function macd(values) {
    const e12 = ema(values, 12), e26 = ema(values, 26);
    const macdLine = e12 - e26;
    // signal line approximated from recent macd line history
    const lineSeries = [];
    for (let i = 26; i < values.length; i++) lineSeries.push(ema(values.slice(0, i + 1), 12) - ema(values.slice(0, i + 1), 26));
    const signal = lineSeries.length >= 9 ? ema(lineSeries, 9) : macdLine;
    return { macd: macdLine, signal, hist: macdLine - signal };
  }

  function bollinger(values, period = 20, mult = 2) {
    const slice = values.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    const sd = Math.sqrt(variance);
    return { middle: mean, upper: mean + mult * sd, lower: mean - mult * sd, bandwidth: sd === 0 ? 0 : (mult * sd) / mean };
  }

  function atr(candles, period = 14) {
    if (candles.length < period + 1) return candles.length ? candles[candles.length - 1].high - candles[candles.length - 1].low : 1;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i], p = candles[i - 1];
      trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }
    const slice = trs.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  function stochastic(candles, period = 14, smooth = 3) {
    const slice = candles.slice(-period);
    const hh = Math.max(...slice.map((c) => c.high));
    const ll = Math.min(...slice.map((c) => c.low));
    if (hh === ll) return { k: 50, d: 50 };
    const last = candles[candles.length - 1].close;
    const k = ((last - ll) / (hh - ll)) * 100;
    return { k, d: k }; // simplified %D = %K for live use
  }

  function vwap(candles) {
    let pv = 0, v = 0;
    for (const c of candles.slice(-50)) {
      const typical = (c.high + c.low + c.close) / 3;
      const vol = c.volume || 100;
      pv += typical * vol; v += vol;
    }
    return v ? pv / v : candles[candles.length - 1].close;
  }

  function swingLevels(candles, lookback = 50) {
    const slice = candles.slice(-lookback);
    const sortedHighs = [...slice.map((c) => c.high)].sort((a, b) => b - a);
    const sortedLows = [...slice.map((c) => c.low)].sort((a, b) => a - b);
    return {
      resistance: sortedHighs[Math.min(2, sortedHighs.length - 1)],
      support: sortedLows[Math.min(2, sortedLows.length - 1)],
      resistance2: sortedHighs[0],
      support2: sortedLows[0],
    };
  }

  function momentum(values, period = 10) {
    if (values.length < period + 1) return 0;
    return values[values.length - 1] - values[values.length - period - 1];
  }

  /** Full analysis of one candle set. Returns indicators + confluence score. */
  function analyze(candles, mode = 'scalping') {
    if (!candles || candles.length < 30) return null;
    const cl = closes(candles);
    const price = cl[cl.length - 1];
    const e9 = ema(cl, 9), e21 = ema(cl, 21), e50 = ema(cl, 50), e200 = ema(cl, 200);
    const r = rsi(cl, 14);
    const m = macd(cl);
    const bb = bollinger(cl, 20, 2);
    const a = atr(candles, 14);
    const st = stochastic(candles, 14);
    const vw = vwap(candles);
    const lv = swingLevels(candles, 50);
    const mom = momentum(cl, 10);

    const votes = []; // {name, vote:-1|0|1, weight, detail}
    const add = (name, vote, weight, detail) => votes.push({ name, vote, weight, detail });

    // 1. EMA trend stack
    if (e9 > e21 && e21 > e50) add('EMA Trend', 1, 3, `9 > 21 > 50 · Uptrend`);
    else if (e9 < e21 && e21 < e50) add('EMA Trend', -1, 3, `9 < 21 < 50 · Downtrend`);
    else add('EMA Trend', price > e50 ? 1 : -1, 1, `Price vs EMA50`);

    // 2. RSI — in a strong trend RSI can stay overbought/oversold; treat extremes as momentum, not reversal
    if (r >= 55 && r <= 70) add('RSI 14', 1, 2, `RSI ${r.toFixed(1)} · bullish momentum`);
    else if (r <= 45 && r >= 30) add('RSI 14', -1, 2, `RSI ${r.toFixed(1)} · bearish momentum`);
    else if (r > 75) add('RSI 14', 1, 1, `RSI ${r.toFixed(1)} · strong momentum (overbought caution)`);
    else if (r < 25) add('RSI 14', -1, 1, `RSI ${r.toFixed(1)} · strong downside momentum (oversold caution)`);
    else add('RSI 14', 0, 1, `RSI ${r.toFixed(1)} · neutral`);

    // 3. MACD
    if (m.hist > 0 && m.macd > m.signal) add('MACD', 1, 2, `Hist +${m.hist.toFixed(2)} · bullish cross`);
    else if (m.hist < 0 && m.macd < m.signal) add('MACD', -1, 2, `Hist ${m.hist.toFixed(2)} · bearish cross`);
    else add('MACD', 0, 1, `Hist ${m.hist.toFixed(2)} · flat`);

    // 4. Bollinger position — riding the band = strong trend momentum
    if (price > bb.upper) add('Bollinger', 1, 1, `Above upper band · strong momentum`);
    else if (price < bb.lower) add('Bollinger', -1, 1, `Below lower band · strong downside`);
    else if (price > bb.middle) add('Bollinger', 1, 1, `Above midline · buyers in control`);
    else add('Bollinger', -1, 1, `Below midline · sellers in control`);

    // 5. Stochastic
    if (st.k > 50) add('Stochastic', 1, 1, `%K ${st.k.toFixed(0)} · rising`);
    else if (st.k < 50) add('Stochastic', -1, 1, `%K ${st.k.toFixed(0)} · falling`);
    else add('Stochastic', 0, 1, `%K ${st.k.toFixed(0)} · neutral`);

    // 6. VWAP
    add('VWAP', price > vw ? 1 : -1, 2, price > vw ? `Price above VWAP $${vw.toFixed(2)}` : `Price below VWAP $${vw.toFixed(2)}`);

    // 7. Support / Resistance proximity
    const distR = (lv.resistance - price) / a;
    const distS = (price - lv.support) / a;
    if (distS < 0.6 && distR > 1.5) add('S/R Zone', 1, 2, `Near support $${lv.support.toFixed(2)}`);
    else if (distR < 0.6 && distS > 1.5) add('S/R Zone', -1, 2, `Near resistance $${lv.resistance.toFixed(2)}`);
    else add('S/R Zone', 0, 1, `Mid-range $${lv.support.toFixed(0)} – $${lv.resistance.toFixed(0)}`);

    // 8. Momentum
    if (mom > a * 0.5) add('Momentum', 1, 2, `+${mom.toFixed(2)} over 10 candles`);
    else if (mom < -a * 0.5) add('Momentum', -1, 2, `${mom.toFixed(2)} over 10 candles`);
    else add('Momentum', 0, 1, `Flat momentum`);

    // 9. Volatility regime (ATR vs price) — informs SL width, not direction
    const volPct = (a / price) * 100;
    add('Volatility ATR', 0, 0, `ATR $${a.toFixed(2)} (${volPct.toFixed(3)}%) · ${volPct > 0.15 ? 'high' : volPct > 0.05 ? 'normal' : 'low'}`);

    const totalWeight = votes.reduce((s, v) => s + v.weight, 0) || 1;
    const weighted = votes.reduce((s, v) => s + v.vote * v.weight, 0);
    const score = Math.round((weighted / totalWeight) * 100); // -100..+100
    const confidence = Math.abs(score);

    let signal = 'WAIT';
    if (score >= 35) signal = 'BUY';
    else if (score <= -35) signal = 'SELL';

    // Entry / SL / TP — mode-aware ATR multiples
    const slMult = mode === 'swing' ? 2.2 : 1.5;
    const dir = signal === 'SELL' ? -1 : 1;
    const entry = price;
    const slDist = Math.max(a * slMult, 0.8);
    const sl = entry - dir * slDist;
    const tp1 = entry + dir * slDist * 1.5;
    const tp2 = entry + dir * slDist * 2.5;
    const tp3 = entry + dir * slDist * 4.0;
    const rr = (Math.abs(tp2 - entry) / slDist).toFixed(1);

    const reasons = votes
      .filter((v) => v.vote !== 0)
      .sort((x, y) => Math.abs(y.vote * y.weight) - Math.abs(x.vote * x.weight))
      .slice(0, 5)
      .map((v) => `${v.vote > 0 ? '▲' : '▼'} ${v.name}: ${v.detail}`);

    return {
      price, signal, score, confidence,
      indicators: { e9, e21, e50, e200, rsi: r, macd: m, bollinger: bb, atr: a, stochastic: st, vwap: vw, levels: lv, momentum: mom },
      votes, reasons,
      trade: { entry, sl, tp1, tp2, tp3, rr, slDist, direction: dir },
      mode,
      time: new Date().toISOString(),
    };
  }

  /** Backtest: walk through history, enter on signal, exit at SL/TP. */
  function backtest(candles, mode = 'scalping') {
    let wins = 0, losses = 0, pnl = 0, grossWin = 0, grossLoss = 0;
    let inTrade = null;
    const trades = [];
    for (let i = 40; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const c = candles[i];
      if (inTrade) {
        if (inTrade.direction === 1) {
          if (c.low <= inTrade.sl) { losses++; pnl -= inTrade.slDist; grossLoss += inTrade.slDist; trades.push({ ...inTrade, exit: inTrade.sl, result: -inTrade.slDist }); inTrade = null; }
          else if (c.high >= inTrade.tp2) { wins++; pnl += inTrade.slDist * 2.5; grossWin += inTrade.slDist * 2.5; trades.push({ ...inTrade, exit: inTrade.tp2, result: inTrade.slDist * 2.5 }); inTrade = null; }
        } else {
          if (c.high >= inTrade.sl) { losses++; pnl -= inTrade.slDist; grossLoss += inTrade.slDist; trades.push({ ...inTrade, exit: inTrade.sl, result: -inTrade.slDist }); inTrade = null; }
          else if (c.low <= inTrade.tp2) { wins++; pnl += inTrade.slDist * 2.5; grossWin += inTrade.slDist * 2.5; trades.push({ ...inTrade, exit: inTrade.tp2, result: inTrade.slDist * 2.5 }); inTrade = null; }
        }
        continue;
      }
      const res = analyze(slice, mode);
      if (res && res.signal !== 'WAIT' && res.confidence >= 45) {
        inTrade = { ...res.trade, entryTime: c.time, signal: res.signal, confidence: res.confidence };
      }
    }
    const total = wins + losses;
    return {
      total, wins, losses,
      winRate: total ? Math.round((wins / total) * 100) : 0,
      profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : (grossWin ? 99 : 0),
      netPnl: +pnl.toFixed(2),
      trades: trades.slice(-30),
    };
  }

  /** Lot size from risk % — XAUUSD contract = 100 oz per lot. */
  function lotSize(balance, riskPct, slDistance, contractSize = 100) {
    const riskMoney = balance * (riskPct / 100);
    if (slDistance <= 0) return { lot: 0, riskMoney };
    const lot = riskMoney / (slDistance * contractSize);
    return { lot: Math.max(0.01, Math.round(lot * 100) / 100), riskMoney: +riskMoney.toFixed(2) };
  }

  const api = { ema, emaSeries, rsi, macd, bollinger, atr, stochastic, vwap, swingLevels, momentum, analyze, backtest, lotSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PulseEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
