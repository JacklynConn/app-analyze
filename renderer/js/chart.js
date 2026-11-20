/* Canvas candlestick chart — no libraries, works offline. */
(function (global) {
  'use strict';

  function drawChart(canvas, candles, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(300, rect.width), H = Math.max(180, rect.height);
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const padR = 64, padT = 12, padB = 22, padL = 8;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const view = candles.slice(-(opts.count || 90));
    if (!view.length) return;

    let hi = -Infinity, lo = Infinity;
    view.forEach((c) => { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); });
    if (opts.bb) { hi = Math.max(hi, opts.bb.upper); lo = Math.min(lo, opts.bb.lower); }
    const range = (hi - lo) || 1;
    hi += range * 0.06; lo -= range * 0.06;
    const y = (p) => padT + ((hi - p) / (hi - lo)) * plotH;
    const step = plotW / view.length;
    const bodyW = Math.max(2, step * 0.62);

    // grid + price labels
    ctx.font = '11px system-ui, sans-serif';
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const p = lo + ((hi - lo) * i) / 5;
      const yy = y(p);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
      ctx.fillText(p.toFixed(2), padL + plotW + 6, yy + 4);
    }

    // EMA lines
    if (opts.emaFast && opts.emaSlow) {
      const drawLine = (series, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
        let started = false;
        view.forEach((c, i) => {
          const v = series[candles.length - view.length + i];
          if (v == null) return;
          const x = padL + i * step + step / 2;
          if (!started) { ctx.moveTo(x, y(v)); started = true; } else ctx.lineTo(x, y(v));
        });
        ctx.stroke();
      };
      drawLine(opts.emaFast, '#f5c542');
      drawLine(opts.emaSlow, '#4da3ff');
    }

    // Bollinger band
    if (opts.bb) {
      ctx.strokeStyle = 'rgba(168,85,247,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y(opts.bb.upper)); ctx.lineTo(padL + plotW, y(opts.bb.upper)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padL, y(opts.bb.lower)); ctx.lineTo(padL + plotW, y(opts.bb.lower)); ctx.stroke();
    }

    // candles
    view.forEach((c, i) => {
      const x = padL + i * step + step / 2;
      const up = c.close >= c.open;
      ctx.strokeStyle = up ? '#26a69a' : '#ef5350';
      ctx.fillStyle = up ? '#26a69a' : '#ef5350';
      ctx.beginPath(); ctx.moveTo(x, y(c.high)); ctx.lineTo(x, y(c.low)); ctx.stroke();
      const top = y(Math.max(c.open, c.close)), bot = y(Math.min(c.open, c.close));
      ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bot - top));
    });

    // last price dashed line + label (color follows live candle direction)
    const last = view[view.length - 1];
    const lastUp = last.close >= last.open;
    const lastColor = lastUp ? '#26a69a' : '#ef5350';
    ctx.strokeStyle = 'rgba(245,197,66,0.7)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, y(last.close)); ctx.lineTo(padL + plotW, y(last.close)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = lastColor;
    ctx.fillRect(padL + plotW + 2, y(last.close) - 9, 60, 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(last.close.toFixed(2), padL + plotW + 6, y(last.close) + 4);
    // live pulsing dot on the forming candle
    if (opts.live) {
      const lx = padL + (view.length - 1) * step + step / 2;
      const pulse = 3 + Math.sin(Date.now() / 300) * 1.2;
      ctx.fillStyle = lastColor;
      ctx.beginPath(); ctx.arc(lx, y(last.close), Math.max(2.5, pulse), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(lx, y(last.close), 1.4, 0, Math.PI * 2); ctx.fill();
    }

    // Entry / SL / TP markers
    if (opts.trade) {
      const t = opts.trade;
      const mark = (price, label, color) => {
        if (price == null) return;
        ctx.strokeStyle = color; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(padL, y(price)); ctx.lineTo(padL + plotW, y(price)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillText(label + ' ' + price.toFixed(2), padL + 4, y(price) - 4);
      };
      mark(t.entry, 'ENTRY', '#ffffff');
      mark(t.sl, 'SL', '#ef5350');
      mark(t.tp1, 'TP1', '#26a69a');
      mark(t.tp2, 'TP2', '#26a69a');
    }

    // time axis (first / middle / last)
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '10px system-ui, sans-serif';
    const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(fmt(view[0].time), padL, H - 6);
    ctx.fillText(fmt(view[Math.floor(view.length / 2)].time), padL + plotW / 2, H - 6);
    ctx.fillText(fmt(view[view.length - 1].time), padL + plotW - 40, H - 6);
  }

  global.PulseChart = { drawChart };
})(typeof window !== 'undefined' ? window : globalThis);
