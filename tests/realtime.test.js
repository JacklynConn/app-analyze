const { test } = require('node:test');
const assert = require('node:assert');
const RT = require('../renderer/js/realtime.js');

test('parseBinanceKlines converts REST rows to candles', () => {
  const rows = [[1795173420000, '3582.29', '3583.36', '3582.29', '3583.07', '3.3093', 1795173479999]];
  const cs = RT.parseBinanceKlines(rows);
  assert.strictEqual(cs.length, 1);
  assert.strictEqual(cs[0].time, 1795173420000);
  assert.strictEqual(cs[0].close, 3583.07);
  assert.ok(cs[0].high >= cs[0].low);
});

test('parseBinanceKlines rejects garbage', () => {
  assert.deepStrictEqual(RT.parseBinanceKlines(null), []);
  assert.deepStrictEqual(RT.parseBinanceKlines('nope'), []);
});

test('parseYahooChart converts timestamps + quote arrays, skips null bars', () => {
  const json = { chart: { result: [{ timestamp: [1000, 1060, 1120], indicators: { quote: [{ open: [1, null, 3], high: [2, 2, 4], low: [0.5, 1, 2.5], close: [1.5, 1.5, 3.5], volume: [10, 10, 10] }] } }] } };
  const cs = RT.parseYahooChart(json);
  assert.strictEqual(cs.length, 2);
  assert.strictEqual(cs[0].time, 1000000);
  assert.strictEqual(cs[1].close, 3.5);
});

test('parseYahooChart returns [] on empty input', () => {
  assert.deepStrictEqual(RT.parseYahooChart(null), []);
  assert.deepStrictEqual(RT.parseYahooChart({ chart: { result: [] } }), []);
});

test('parseBinanceKlineEvent maps interval to timeframe', () => {
  const msg = { data: { k: { i: '15m', t: 123, o: '100', h: '101', l: '99', c: '100.5', v: '2', x: false } } };
  const parsed = RT.parseBinanceKlineEvent(msg);
  assert.strictEqual(parsed.tf, 'M15');
  assert.strictEqual(parsed.candle.close, 100.5);
  assert.strictEqual(parsed.closed, false);
  // unknown interval -> null
  assert.strictEqual(RT.parseBinanceKlineEvent({ data: { k: { i: '3m', t: 1, o: '1', h: '1', l: '1', c: '1', v: '0' } } }), null);
});

test('applyTick updates forming candle in place', () => {
  const candles = [{ time: 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 5 }];
  const r = RT.applyTick(candles, { time: 1000, open: 100, high: 102, low: 99, close: 101.5, volume: 7 });
  assert.strictEqual(r.isNew, false);
  assert.strictEqual(candles.length, 1);
  assert.strictEqual(candles[0].close, 101.5);
  assert.strictEqual(candles[0].high, 102);
});

test('applyTick appends new candle and caps length', () => {
  const candles = Array.from({ length: 500 }, (_, i) => ({ time: i * 60000, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  const r = RT.applyTick(candles, { time: 500 * 60000, open: 100, high: 101, low: 99, close: 101, volume: 1 });
  assert.strictEqual(r.isNew, true);
  assert.strictEqual(candles.length, 500); // capped
  assert.strictEqual(candles[candles.length - 1].close, 101);
});

test('applyTick ignores stale ticks', () => {
  const candles = [{ time: 2000, open: 100, high: 101, low: 99, close: 100, volume: 1 }];
  const r = RT.applyTick(candles, { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  assert.strictEqual(r.isNew, false);
  assert.strictEqual(candles[0].close, 100);
});

test('TF mappings cover all app timeframes', () => {
  for (const tf of ['M1', 'M5', 'M15', 'H1', 'H4', 'D1']) {
    assert.ok(RT.TF_TO_BINANCE[tf], tf + ' binance interval');
    assert.ok(RT.TF_TO_YAHOO[tf], tf + ' yahoo mapping');
    assert.strictEqual(RT.BINANCE_TO_TF[RT.TF_TO_BINANCE[tf]], tf);
  }
});

test('combinedStreamUrl includes all 6 kline streams', () => {
  const url = RT.combinedStreamUrl('wss://stream.binance.com:9443');
  assert.ok(url.includes('paxgusdt@kline_1m'));
  assert.ok(url.includes('paxgusdt@kline_1d'));
  assert.strictEqual((url.match(/kline_/g) || []).length, 6);
});
