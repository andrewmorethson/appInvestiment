/**
 * state.js
 * ------------------------------------------------------------
 * Estado compartilhado (single source of truth) do app.
 * - Evite espalhar estados paralelos em módulos distintos.
 * - Preferir mutações controladas em engine.js e leitura em ui.js.
 */
// Shared state (single source of truth)
export const S = {
  // TOP50 (fixo) - USDT majors
  TOP50_USDT: [
    "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","TRXUSDT","AVAXUSDT","LINKUSDT",
    "DOTUSDT","MATICUSDT","TONUSDT","SHIBUSDT","BCHUSDT","LTCUSDT","UNIUSDT","ATOMUSDT","ETCUSDT","FILUSDT",
    "APTUSDT","ARBUSDT","OPUSDT","NEARUSDT","INJUSDT","ICPUSDT","XLMUSDT","HBARUSDT","IMXUSDT","AAVEUSDT",
    "EGLDUSDT","SUIUSDT","FTMUSDT","GALAUSDT","PEPEUSDT","RNDRUSDT","RUNEUSDT","STXUSDT","MKRUSDT","LDOUSDT",
    "KASUSDT","TIAUSDT","SEIUSDT","JUPUSDT","WIFUSDT","BONKUSDT","FLOKIUSDT","PYTHUSDT","ARUSDT","THETAUSDT"
  ],

  // constants
  MAX_CONSECUTIVE_LOSSES: 2,
  SCORE_MIN: 7.0,
  SCORE_AUTO_ON_ASK: 9.0,
  MIN_TREND_STRENGTH: 0.0006,
  MIN_ATR_PCT: 0.003,

  // runtime state
  profile: 'IA_AVANCADO',
  selectedPresetId: 'NONE',
  selectedPresetName: 'Sem preset extra',
  intervalPreset: '5m',
  minRR: 1.15,
  mtfConfirmOn: true,
  mtfConfirmInterval: '15m',
  mtfMinTrendStrength: 0.0009,
  corrFilterOn: true,
  corrLookback: 40,
  corrMin: 0.72,
  corrMaxOpenSameSide: 3,
  settings: {
    auditTokenDefault: 'Y3pNf8qL2vRm7Kx1sD4tH9wQe6uAaJ5nB0cXzP3mVgT7yRk2Fh8sLw4dQ9uN1eC',
  },
  runningProfile: null,
  runtimeCfg: null,
  runId: null,
  testMode: false,
  running: false,
  timer: null,
  ticking: false,
  tickSkipped: 0,

  // focus + minimize
  focus: false,
  minimized: false,

  // focus widgets
  focusTab: 'TRADES',
  logLines: [],

  // cash-based DD
  initialCash: 100,
  pendingInitialCash: null,
  dayAnchorCash: 100,
  dayPeakCash: 100,
  cash: 100,
  grossWinUsd: 0,
  grossLossUsd: 0,
  realizedUsd: 0,
  feePaidUsd: 0,
  taxReservedUsd: 0,
  taxPaidUsd: 0,
  wins: 0,
  losses: 0,
  lossStreak: 0,
  netLossStreak: 0,

  // preset guards / rolling stats
  highWatermarkCash: 100,
  tradesWeekKey: null,
  tradesThisWeek: 0,
  dayTurnoverUsd: 0,
  turnoverDayKey: null,
  closedTradesNet: [],
  riskCutActive: false,
  riskCutRemainingTrades: 0,
  riskCutAnchorHighWatermark: null,
  killSwitchUntilTs: 0,
  killSwitchReason: '',
  lastRollingExpectancyUsd: null,
  lastRollingWinRate: null,

  locked: false,
  lockReason: '',
  lockType: null, // 'DD' | 'LOSS' | null

  lastTickTs: 0,
  lastSymbol: null,
  lastPrice: null,
  lastSignal: '—',
  lastScore: 0,
  lastReasons: [],

  pending: [],
  open: [],

  tradeGuard: new Set(),
  cooldownBySymbol: new Map(),

  bestOfDay: [],
  bestUpdatedAt: 0,
  bestErr: null,
  mtfCache: new Map(),
  retCache: new Map(),

  _dayKey: null
};
