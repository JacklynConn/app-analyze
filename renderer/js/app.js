/* XAUUSD PULSE PRO — UI controller */
(function () {
  'use strict';
  const E = window.PulseEngine, D = window.PulseData, C = window.PulseChart;
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(d));

  let store = {}, currentTF = 'M15', mode = 'scalping';
  let lastSignal = null, lastSignalKey = '', soundOn = true, alertArmed = false;
  let journal = JSON.parse(localStorage.getItem('pulse_journal') || '[]');
  let audioCtx = null;

  /* ---------- toast + sound + desktop notify ---------- */
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3200);
  }
  function beep(freq = 880, dur = 0.18) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.12, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  }
  function notify(title, body) {
    beep(title.includes('BUY') ? 990 : 660);
    if (window.pulseAPI?.notifySignal) window.pulseAPI.notifySignal(title, body);
    else if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
    toast(title + ' — ' + body);
  }
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});

  /* ---------- sessions (UTC based) ---------- */
  function sessions() {
    const now = new Date(), h = now.getUTCHours();
    const inRange = (a, b) => h >= a && h < b;
    return [
      { name: '🇦🇺 Sydney', open: inRange(21, 6) || h < 6, time: '21:00–06:00 UTC' },
      { name: '🇯🇵 Tokyo', open: inRange(0, 9), time: '00:00–09:00 UTC' },
      { name: '🇬🇧 London', open: inRange(8, 17), time: '08:00–17:00 UTC' },
      { name: '🇺🇸 New York', open: inRange(13, 22), time: '13:00–22:00 UTC' },
    ];
  }

  /* ---------- economic calendar (high-impact, recurring) ---------- */
  function nextNews() {
    const now = new Date();
    const mk = (name, currency, impact, hourUTC, dayOffset, desc) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hourUTC, 30));
      if (d < now) d.setUTCDate(d.getUTCDate() + 7);
      return { name, currency, impact, when: d, desc };
    };
    const list = [
      mk('CPI (Consumer Price Index)', 'USD', 'high', 13, 1, 'CPI ខ្ពស់ → USD ខ្លាំង · Gold ធ្លាក់ | CPI ទាប → Gold ឡើង'),
      mk('Non-Farm Payrolls (NFP)', 'USD', 'high', 13, 3, 'NFP ខ្ពស់ → USD ខ្លាំង · Gold ធ្លាក់'),
      mk('FOMC Interest Rate Decision', 'USD', 'high', 18, 5, 'Fed សម្រេចអត្រាការប្រាក់ — Gold លោតខ្លាំងបំផុត'),
      mk('PPI (Producer Price Index)', 'USD', 'high', 13, 2, 'PPI ខ្ពស់ → USD ខ្លាំង · Gold ធ្លាក់'),
      mk('ECB Interest Rate Decision', 'EUR', 'medium', 12, 4, 'ប៉ះពាល់ EUR/USD និងសម្ពាធលើ Gold'),
      mk('Retail Sales m/m', 'USD', 'medium', 13, 0, 'ការលក់រាយ — វាស់កម្លាំងសេដ្ឋកិច្ចអាមេរិក'),
    ].sort((a, b) => a.when - b.when);
    return list;
  }

  /* ---------- renderers ---------- */
  function renderTFs() {
    $('tfTabs').innerHTML = Object.keys(D.TIMEFRAMES).map((tf) =>
      `<button class="tf-btn ${tf === currentTF ? 'active' : ''}" data-tf="${tf}">${tf}</button>`).join('');
    document.querySelectorAll('.tf-btn').forEach((b) => b.onclick = () => { currentTF = b.dataset.tf; renderAll(); });
  }

  function renderSignal(res) {
    if (!res) return;
    lastSignal = res;
    const big = $('signalBig');
    big.textContent = res.signal === 'WAIT' ? 'WAIT ⏸' : res.signal === 'BUY' ? 'BUY ▲' : 'SELL ▼';
    big.className = 'signal-big ' + (res.signal === 'BUY' ? 'buy' : res.signal === 'SELL' ? 'sell' : 'wait');
    $('gaugeArc').style.strokeDashoffset = String(264 - (264 * res.confidence) / 100);
    $('gaugeArc').style.stroke = res.signal === 'BUY' ? '#26a69a' : res.signal === 'SELL' ? '#ef5350' : '#f5c542';
    $('gaugeText').textContent = res.confidence + '%';
    $('tEntry').textContent = fmt(res.trade.entry);
    $('tSL').textContent = fmt(res.trade.sl);
    $('tTP1').textContent = fmt(res.trade.tp1);
    $('tTP2').textContent = fmt(res.trade.tp2);
    $('tTP3').textContent = fmt(res.trade.tp3);
    $('tRR').textContent = res.trade.rr + ' : 1';
    $('reasonsList').innerHTML = res.reasons.map((r) => `<li>${r}</li>`).join('') || '<li class="muted">No strong confluence — wait for clearer setup.</li>';
    $('votesList').innerHTML = res.votes.map((v) =>
      `<div class="vote ${v.vote > 0 ? 'up' : v.vote < 0 ? 'down' : 'flat'}"><b>${v.vote > 0 ? '▲' : v.vote < 0 ? '▼' : '—'} ${v.name}</b>${v.detail}</div>`).join('');
    const ind = res.indicators;
    $('indicatorStrip').innerHTML = [
      ['RSI', fmt(ind.rsi, 1)], ['MACD Hist', fmt(ind.macd.hist, 2)],
      ['ATR', fmt(ind.atr)], ['VWAP', fmt(ind.vwap)],
      ['Stoch %K', fmt(ind.stochastic.k, 0)],
      ['EMA50', fmt(ind.e50)], ['Support', fmt(ind.levels.support)],
      ['Resistance', fmt(ind.levels.resistance)],
    ].map(([k, v]) => `<div class="ind-chip">${k}<b>${v}</b></div>`).join('');
    updateLot(res);
    // new-signal alert
    const key = res.signal + '|' + res.trade.entry.toFixed(1) + '|' + currentTF + '|' + mode;
    if (res.signal !== 'WAIT' && key !== lastSignalKey) {
      lastSignalKey = key;
      if (alertArmed) notify(`XAUUSD ${res.signal} — ${currentTF}`, `Entry ${fmt(res.trade.entry)} · SL ${fmt(res.trade.sl)} · TP2 ${fmt(res.trade.tp2)} · ${res.confidence}%`);
    }
  }

  function updateLot(res) {
    const bal = parseFloat($('balanceInput').value) || 1000;
    const risk = parseFloat($('riskInput').value) || 1;
    const r = res || lastSignal;
    if (!r) return;
    const { lot, riskMoney } = E.lotSize(bal, risk, r.trade.slDist, 100);
    $('lotOut').textContent = lot.toFixed(2);
    $('lotRisk').textContent = `Risk $${riskMoney} · SL dist $${fmt(r.trade.slDist)}`;
  }

  function renderScanner() {
    const rows = Object.keys(D.TIMEFRAMES).map((tf) => {
      const res = E.analyze(store[tf], mode);
      if (!res) return '';
      const badge = res.signal === 'BUY' ? '<span class="badge buy">BUY ▲</span>' : res.signal === 'SELL' ? '<span class="badge sell">SELL ▼</span>' : '<span class="badge wait">WAIT</span>';
      return `<tr data-tf="${tf}" style="cursor:pointer" title="Click to view ${tf}">
        <td><b>${tf}</b></td><td>${fmt(res.price)}</td><td>${badge}</td>
        <td>${res.score > 0 ? '+' : ''}${res.score}</td>
        <td><div class="conf-bar"><div class="conf-fill" style="width:${res.confidence}%"></div></div></td>
        <td>${fmt(res.trade.entry)}</td><td style="color:#f87171">${fmt(res.trade.sl)}</td>
        <td style="color:#4ade80">${fmt(res.trade.tp2)}</td><td>${res.trade.rr}:1</td></tr>`;
    }).join('');
    $('scannerBody').innerHTML = rows;
    document.querySelectorAll('#scannerBody tr[data-tf]').forEach((tr) => tr.onclick = () => { currentTF = tr.dataset.tf; renderAll(); });

    // confluence summary
    const all = Object.keys(D.TIMEFRAMES).map((tf) => E.analyze(store[tf], mode)).filter(Boolean);
    const buys = all.filter((r) => r.signal === 'BUY').length;
    const sells = all.filter((r) => r.signal === 'SELL').length;
    const avgConf = Math.round(all.reduce((s, r) => s + r.confidence, 0) / (all.length || 1));
    $('confluenceBar').innerHTML = `
      <div class="conf-chip"><strong style="color:#4ade80">${buys}</strong>BUY timeframes</div>
      <div class="conf-chip"><strong style="color:#f87171">${sells}</strong>SELL timeframes</div>
      <div class="conf-chip"><strong style="color:var(--gold)">${avgConf}%</strong>Avg confidence</div>
      <div class="conf-chip"><strong>${buys >= 4 ? '🟢 Strong BUY' : sells >= 4 ? '🔴 Strong SELL' : '🟡 Mixed / Wait'}</strong>Overall confluence</div>`;
  }

  function renderChart() {
    const candles = store[currentTF];
    if (!candles) return;
    const res = E.analyze(candles, mode);
    const cl = candles.map((c) => c.close);
    C.drawChart($('chart'), candles, {
      count: 90,
      emaFast: E.emaSeries(cl, 9), emaSlow: E.emaSeries(cl, 21),
      bb: res ? res.indicators.bollinger : null,
      trade: res && res.signal !== 'WAIT' ? res.trade : null,
    });
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2] || last;
    const chg = last.close - prev.close, pct = (chg / prev.close) * 100;
    $('livePrice').textContent = fmt(last.close);
    const lc = $('liveChange');
    lc.textContent = `${chg >= 0 ? '▲' : '▼'} ${fmt(Math.abs(chg))} (${fmt(Math.abs(pct))}%)`;
    lc.className = 'tick-change ' + (chg >= 0 ? 'up' : 'down');
    $('ohlcInfo').textContent = `O ${fmt(last.open)}  H ${fmt(last.high)}  L ${fmt(last.low)}  C ${fmt(last.close)}`;
    $('feedSource').textContent = 'Feed: ' + D.getSource();
    if (res) renderSignal(res);
  }

  function renderNews() {
    const list = nextNews();
    $('newsList').innerHTML = list.map((n) => {
      const mins = Math.round((n.when - Date.now()) / 60000);
      const soon = mins < 60;
      return `<div class="news-item ${n.impact === 'high' ? 'high' : ''}">
        <div class="n-head"><span>${n.currency} · ${n.impact.toUpperCase()}</span><span>${n.when.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · in ${mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm'}</span></div>
        <div class="n-title">${soon ? '🔴 ' : ''}${n.name}</div>
        <div class="n-impact">${n.desc}</div></div>`;
    }).join('');
  }

  function renderSessions() {
    $('sessions').innerHTML = sessions().map((s) =>
      `<div class="session ${s.open ? 'open' : ''}"><div class="s-name">${s.name}</div><div class="s-time">${s.time}</div><div class="s-state ${s.open ? 'open' : 'closed'}">${s.open ? '● OPEN' : '○ CLOSED'}</div></div>`).join('');
    const openCount = sessions().filter((s) => s.open).length;
    $('sessionPill').textContent = openCount >= 2 ? '🟢 Sessions overlap — liquid' : '🟡 Thin session';
  }

  function renderJournal() {
    if (!journal.length) {
      $('journalBody').innerHTML = '<tr><td colspan="9" class="muted">នៅមិនទាន់មាន signal ដែលបាន save — ចុច Save to Journal នៅពេលមាន signal ច្បាស់។</td></tr>';
    } else {
      $('journalBody').innerHTML = journal.slice().reverse().map((j, idx) => {
        const realIdx = journal.length - 1 - idx;
        const badge = j.signal === 'BUY' ? '<span class="badge buy">BUY</span>' : '<span class="badge sell">SELL</span>';
        const result = j.result == null ? '<span class="muted">Open</span>' : j.result > 0 ? `<span style="color:#4ade80">+$${fmt(j.result)}</span>` : `<span style="color:#f87171">-$${fmt(Math.abs(j.result))}</span>`;
        return `<tr><td>${new Date(j.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td>${j.tf}</td><td>${badge}</td><td>${fmt(j.entry)}</td><td>${fmt(j.sl)}</td><td>${fmt(j.tp2)}</td>
          <td>${j.confidence}%</td><td>${result}</td>
          <td>${j.result == null ? `<button class="btn ghost small" data-close="${realIdx}">Close @ ${fmt(store[currentTF]?.[store[currentTF].length - 1]?.close || j.entry)}</button>` : ''}</td></tr>`;
      }).join('');
      document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => {
        const j = journal[+b.dataset.close];
        const price = store[currentTF][store[currentTF].length - 1].close;
        j.result = +(((j.signal === 'BUY' ? price - j.entry : j.entry - price)) * 100 * (j.lot || 0.01)).toFixed(2);
        localStorage.setItem('pulse_journal', JSON.stringify(journal));
        renderJournal(); toast('Trade closed · PnL $' + j.result);
      });
    }
    const closed = journal.filter((j) => j.result != null);
    const wins = closed.filter((j) => j.result > 0).length;
    $('journalStats').textContent = `${journal.length} signals · ${closed.length} closed · ${closed.length ? Math.round((wins / closed.length) * 100) : 0}% win`;
  }

  function renderBacktest() {
    const res = E.backtest(store[currentTF], mode);
    $('backtestResult').innerHTML = `
      <div class="bt-stat"><strong>${res.total}</strong><span>Trades</span></div>
      <div class="bt-stat"><strong style="color:#4ade80">${res.winRate}%</strong><span>Win Rate</span></div>
      <div class="bt-stat"><strong style="color:var(--gold)">${res.profitFactor}</strong><span>Profit Factor</span></div>
      <div class="bt-stat"><strong style="color:${res.netPnl >= 0 ? '#4ade80' : '#f87171'}">$${fmt(res.netPnl)}</strong><span>Net PnL (points)</span></div>
      <div class="bt-stat"><strong>${res.wins}W / ${res.losses}L</strong><span>Wins / Losses</span></div>`;
    toast(`Backtest ${currentTF} · ${mode}: ${res.winRate}% win rate over ${res.total} trades`);
  }

  function renderAll() { renderTFs(); renderChart(); renderScanner(); renderNews(); renderSessions(); renderJournal(); }

  /* ---------- events ---------- */
  document.querySelectorAll('.mode-btn').forEach((b) => b.onclick = () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
    renderAll();
  });
  $('scanAllBtn').onclick = () => { renderScanner(); toast('Scanned all 6 timeframes — see confluence summary below.'); };
  $('backtestBtn').onclick = renderBacktest;
  $('refreshBtn').onclick = () => { renderAll(); toast('Refreshed'); };
  $('soundBtn').onclick = () => { soundOn = !soundOn; $('soundBtn').textContent = soundOn ? '🔔 Sound: ON' : '🔕 Sound: OFF'; };
  $('balanceInput').oninput = () => updateLot();
  $('riskInput').oninput = () => updateLot();
  $('copySignalBtn').onclick = async () => {
    if (!lastSignal) return;
    const r = lastSignal;
    const txt = `XAUUSD ${r.signal} (${currentTF} · ${mode})\nEntry: ${fmt(r.trade.entry)}\nSL: ${fmt(r.trade.sl)}\nTP1: ${fmt(r.trade.tp1)} · TP2: ${fmt(r.trade.tp2)} · TP3: ${fmt(r.trade.tp3)}\nR:R ${r.trade.rr}:1 · Confidence ${r.confidence}%`;
    try { await navigator.clipboard.writeText(txt); toast('Signal copied to clipboard!'); }
    catch (e) { toast(txt); }
  };
  $('saveSignalBtn').onclick = () => {
    if (!lastSignal || lastSignal.signal === 'WAIT') { toast('WAIT — no clear signal to save yet.'); return; }
    const r = lastSignal;
    const bal = parseFloat($('balanceInput').value) || 1000;
    const risk = parseFloat($('riskInput').value) || 1;
    journal.push({ time: Date.now(), tf: currentTF, signal: r.signal, entry: r.trade.entry, sl: r.trade.sl, tp2: r.trade.tp2, confidence: r.confidence, lot: E.lotSize(bal, risk, r.trade.slDist, 100).lot, result: null });
    localStorage.setItem('pulse_journal', JSON.stringify(journal));
    renderJournal(); toast('Saved to Journal ✓');
  };
  $('alertBtn').onclick = () => { alertArmed = !alertArmed; $('alertBtn').textContent = alertArmed ? '⏰ Alert: ARMED' : '⏰ Alert me'; toast(alertArmed ? 'Alert armed — you will be notified on next BUY/SELL signal.' : 'Alert disarmed'); };
  $('clearJournalBtn').onclick = () => { journal = []; localStorage.removeItem('pulse_journal'); renderJournal(); };
  $('exportBtn').onclick = () => {
    const csv = 'Time,TF,Signal,Entry,SL,TP2,Confidence,Lot,Result\n' + journal.map((j) => [new Date(j.time).toISOString(), j.tf, j.signal, j.entry, j.sl, j.tp2, j.confidence, j.lot, j.result ?? ''].join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'xauusd-pulse-journal.csv'; a.click();
  };
  window.addEventListener('resize', () => renderChart());

  /* ---------- boot + live loop ---------- */
  (async function boot() {
    toast('XAUUSD PULSE PRO — connecting to live feed…');
    store = await D.init();
    renderAll();
    toast('Ready! Feed: ' + D.getSource());
    setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString(); }, 1000);
    // live tick every 2s on current TF + background tick others every 6s
    setInterval(() => {
      D.tickCandle(store[currentTF], D.TIMEFRAMES[currentTF].minutes);
      renderChart();
    }, 2000);
    setInterval(() => {
      Object.keys(store).forEach((tf) => { if (tf !== currentTF) D.tickCandle(store[tf], D.TIMEFRAMES[tf].minutes); });
      renderScanner(); renderSessions();
    }, 6000);
    setInterval(renderNews, 60000);
  })();
})();
