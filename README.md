# XAUUSD PULSE PRO — Desktop Signal Scanner for Gold

**Desktop app ស្កេន Signal XAUUSD (មាស) ដែលខ្លាំងជាង K-SNR Scanner — FREE ពេញមួយជីវិត មិនត្រូវការ KEY មិនត្រូវការ Login ទាល់តែសោះ។**

Built with Electron (Windows / macOS / Linux) + vanilla JS — ដំណើរការលឿន ស្រាល offline បាន។

---

## 🚀 របៀបដំណើរការ (Run)

### 1. បើកជា Desktop App (ណែនាំ)

```bash
npm install
npm start
```

### 2. បើកជា Web (មើល preview រហ័ស)

```bash
npm run web        # បើក http://localhost:5173
```

### 3. Build ជា .exe / .dmg / .AppImage

```bash
npm run build:win    # Windows .exe (NSIS installer)
npm run build:mac    # macOS .dmg
npm run build:linux  # Linux .AppImage
# ឬ build ទាំងអស់: npm run build
```

> ត្រូវដាក់ icon នៅ `build/icon.png` (512×512), `build/icon.ico`, `build/icon.icns` មុនពេល build សម្រាប់ production — ប្រសិនបើមិនមាន Electron នឹងប្រើ icon default។

### 4. Test engine

```bash
npm test
```

---

## ✨ មុខងារដែលធ្វើឱ្យវាខ្លាំងជាង K-SNR Scanner

| មុខងារ | K-SNR Scanner (ksnrscanner.com) | XAUUSD PULSE PRO ✅ |
|---|---|---|
| តម្លៃ | ត្រូវទិញ KEY | **FREE ពេញមួយជីវិត** |
| Login | ត្រូវ Login | **មិនត្រូវ Login** |
| ការប្រើប្រាស់ | Web browser | **Desktop App (Win/Mac/Linux) + Web** |
| Live price | TradingView widget | **Live feed ពិត (Stooq / Yahoo / Gold-API) + fallback simulator** |
| Signal Engine | រូបភាព Chart scan (ត្រូវ KEY) | **9-indicator confluence engine រត់ផ្ទាល់លើ candles** |
| Timeframes | M1–D1 (ដាច់ៗ) | **M1 M5 M15 H1 H4 D1 — Scanner ស្កេនទាំងអស់ព្រមគ្នា + Confluence score** |
| Indicators | មិនបង្ហាញ | **EMA 9/21/50/200 · RSI · MACD · Bollinger · Stochastic · ATR · VWAP · S/R · Momentum — បង្ហាញ vote គ្រប់មួយ** |
| Entry/SL/TP | មាន | **Entry · SL · TP1/TP2/TP3 · R:R — គណនាពី ATR + Swing (Scalping/Swing mode)** |
| Confidence | មិនមាន | **Confidence % + Gauge + ហេតុផលវិភាគជាភាសាខ្មែរ** |
| Backtest | មិនមាន | **Backtest Engine — Win Rate / Profit Factor / Net PnL** |
| Risk Calculator | មាន | **Lot calculator (XAUUSD 100 oz/lot) + Risk %** |
| Journal | ត្រូវ Login | **Local journal — Save/Close/PnL/Export CSV (មិនត្រូវ server)** |
| Alert | VIP | **Sound + Desktop Notification (Electron native) — FREE** |
| News | មាន | **High-impact calendar (CPI/NFP/FOMC/PPI) + countdown + impact guide ជាខ្មែរ** |
| Sessions | មាន | **Sydney/Tokyo/London/New York open/closed realtime** |
| Offline | មិនបាន | **ដំណើរការបាន offline (simulator fallback)** |
| ភាសា | ខ្មែរ/អង់គ្លេស | **ខ្មែរ + English UI** |

---

## 🧠 Signal Engine — របៀបធ្វើការ

រាល់ 2 វិនាទី engine វិភាគ candles ចុងក្រោយ:

1. **EMA Trend Stack** (9/21/50) — ទិសដៅមេ
2. **RSI 14** — momentum + overbought/oversold
3. **MACD 12/26/9** — trend change
4. **Bollinger Bands 20/2** — position + stretch
5. **Stochastic 14** — short-term momentum
6. **VWAP** — institutional bias
7. **Support/Resistance** — swing zones (50 candles)
8. **Momentum 10** — speed of move
9. **ATR 14** — volatility → ទទឹង SL/TP

Weighted votes → **Score -100 … +100** → `≥ +35 = BUY`, `≤ -35 = SELL`, else `WAIT`.
SL = `1.5×ATR` (Scalping) ឬ `2.2×ATR` (Swing) · TP1 = 1.5R · TP2 = 2.5R · TP3 = 4R.

## 📁 រចនាសម្ព័ន្ធ

```
electron/main.js       — BrowserWindow, menu, native notifications
electron/preload.js    — secure bridge (contextIsolation)
renderer/index.html    — UI (ខ្មែរ/English)
renderer/styles.css    — dark pro-trading theme
renderer/js/engine.js  — indicators + signal + backtest + lot (pure, tested)
renderer/js/data.js    — live feed (Stooq/Yahoo/Gold-API) + simulator
renderer/js/chart.js   — canvas candlestick chart (no libs)
renderer/js/app.js     — UI controller, scanner, journal, alerts
tests/engine.test.js   — unit tests (npm test)
```

## ⚠️ Disclaimer

XAUUSD PULSE PRO គឺជាឧបករណ៍ជំនួយការវិភាគ មិនមែនជាដំបូន្មានហិរញ្ញវត្ថុ ឬការធានាប្រាក់ចំណេញទេ។ ការជួញដូរ Forex/មាសមានហានិភ័យខ្ពស់ — គ្រប់គ្រងហានិភ័យ ≤ 1–2% ក្នុងមួយ Trade ជានិច្ច។ អ្នកទទួលខុសត្រូវទាំងស្រុងលើការសម្រេចចិត្តរបស់អ្នក។

## License
MIT
