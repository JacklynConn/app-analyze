const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../renderer/js/engine.js');
const D = require('../renderer/js/data.js');

function makeCandles(n, trend = 0.001) {
  const out = []; let p = 2600;
  for (let i = 0; i < n; i++) {
    const open = p, close = p * (1 + trend);
    out.push({ time: Date.now() - (n - i) * 60000, open, high: Math.max(open, close) * 1.0005, low: Math.min(open, close) * 0.9995, close, volume: 100 });
    p = close;
  }
  return out;
}

test('EMA rises with price', () => {
  assert.ok(E.ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5) > 5);
});
test('RSI is 100 on pure uptrend, 0-ish on pure downtrend', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 200 - i);
  assert.strictEqual(E.rsi(up, 14), 100);
  assert.ok(E.rsi(down, 14) < 5);
});
test('analyze returns BUY on strong uptrend', () => {
  const res = E.analyze(makeCandles(220, 0.0012), 'scalping');
  assert.ok(res, 'analysis should not be null');
  assert.strictEqual(res.signal, 'BUY');
  assert.ok(res.trade.tp2 > res.trade.entry && res.trade.sl < res.trade.entry);
  assert.ok(res.confidence >= 0 && res.confidence <= 100);
});
test('analyze returns SELL on strong downtrend', () => {
  const res = E.analyze(makeCandles(220, -0.0012), 'scalping');
  assert.strictEqual(res.signal, 'SELL');
  assert.ok(res.trade.tp2 < res.trade.entry && res.trade.sl > res.trade.entry);
});
test('lotSize math: $1000, 1% risk, $5 SL distance => 0.02 lot', () => {
  const { lot, riskMoney } = E.lotSize(1000, 1, 5, 100);
  assert.strictEqual(lot, 0.02);
  assert.strictEqual(riskMoney, 10);
});
test('backtest completes and returns sane stats', () => {
  const bt = E.backtest(makeCandles(220, 0.0008), 'scalping');
  assert.ok(bt.total >= 0 && bt.winRate >= 0 && bt.winRate <= 100);
});
test('data generator produces valid OHLC', () => {
  const cs = D.genCandles(50, 15, 2650);
  assert.strictEqual(cs.length, 50);
  cs.forEach((c) => { assert.ok(c.high >= c.low && c.high >= c.close && c.low <= c.close); });
});
