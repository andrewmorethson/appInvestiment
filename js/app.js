/**
 * app.js
 * ------------------------------------------------------------
 * Entry-point do Guardian Quant Standalone (Paper Trading).
 * - Faz o wiring entre UI (ui.js), regras (engine.js) e dados (binance.js)
 * - Orquestra o loop (tick) e controla start/stop/reset
 *
 * Notas de performance:
 * - tick() executa por longos períodos: UI é renderizada via rafDebounce
 * - Fetch de klines roda em paralelo com limite de concorrência (pLimit)
 */
import { S } from './state.js';
import { fmtPx, intervalToMs, fmtUSD, pLimit, rafDebounce } from './utils.js';
import { fetchKlines, parseKlines, fetch24hTickers } from './binance.js';
import { resolveTradeFeePct } from './fees.js';
import { EMA, SMA } from './indicators.js';
import { createAuditClient } from './audit.js';
import { PRESETS, applyPreset } from './presets.js';
import {
  tradeKey, canPassTradeGuard, markTradeGuard,
  ddPctCash, canTradeNew,
  closeTrade,
  openTradeFromIdea, updateOpenTradesForSymbol,
  buildDecision, applyPnL, computeRollingEdge
} from './engine.js';
import { getEl, logFactory, updateUI, renderPending, renderOpen, renderFocusDeck, bestOfDayLabel } from './ui.js';

// DOM
const el = getEl();
const baseLog = logFactory(el, S);
const auditClient = createAuditClient({ state: S, getCfg: () => (S.runtimeCfg || getCfg()) });
const log = (msg) => {
  baseLog(msg);
  auditClient.capture(msg);
};

// UI: agrupa renders para no máximo 1x por frame
const scheduleRepaint = rafDebounce(() => repaint());
const PRESET_STORAGE_KEY = 'guardian_quant_selected_preset';

const INTERVAL_PRESETS = {
  '5m': {
    name: 'Preset 5m (Institutional)',
    interval: '5m',
    loopSec: 8,
    limit: 300,
    mode: 'AUTO',
    riskPct: 0.40,
    maxDailyDD: 2.6,
    maxOpen: 2,
    noRepeat: true,
    cooldownCandles: 2,
    atrPeriod: 14,
    atrStop: 2.1,
    atrTarget: 2.8,
    atrTrail: 1.9,
    breakEvenR: 1.0,
    timeStopOn: true,
    timeStopCandles: 10,
    partialOn: true,
    partialAtR: 0.9,
    partialPct: 35,
    beAfterPartialOn: true,
    autoProfitOn: true,
    autoProfitPct: 0.35,
    universeMode: 'TOPN',
    topN: 3,
    bestRefreshMin: 8,
    feeMode: 'BNB',
    feePctCustom: 0.10,
    execSpreadBps: 6,
    execSlippageBps: 5,
    execLatencyMs: 350,
    execLatencyBpsPerSec: 1.2,
    mtfConfirmOn: true,
    mtfConfirmInterval: '15m',
    mtfMinTrendStrength: 0.0009,
    corrFilterOn: true,
    corrLookback: 40,
    corrMin: 0.74,
    corrMaxOpenSameSide: 2,
    edgeMinPct: 0.22,
    minRR: 1.35,
    taxOn: true,
    taxPct: 15,
    taxApplyCash: true,
    auditOn: true,
    auditFlushSec: 8,
  },
  '15m': {
    name: 'Preset 15m (Institutional)',
    interval: '15m',
    loopSec: 15,
    limit: 300,
    mode: 'AUTO',
    riskPct: 0.60,
    maxDailyDD: 2.6,
    maxOpen: 3,
    noRepeat: true,
    cooldownCandles: 3,
    atrPeriod: 14,
    atrStop: 2.3,
    atrTarget: 3.3,
    atrTrail: 2.1,
    breakEvenR: 1.2,
    timeStopOn: true,
    timeStopCandles: 14,
    partialOn: true,
    partialAtR: 1.1,
    partialPct: 30,
    beAfterPartialOn: true,
    autoProfitOn: true,
    autoProfitPct: 0.50,
    universeMode: 'TOPN',
    topN: 4,
    bestRefreshMin: 12,
    feeMode: 'BNB',
    feePctCustom: 0.10,
    execSpreadBps: 4,
    execSlippageBps: 3,
    execLatencyMs: 250,
    execLatencyBpsPerSec: 1.0,
    mtfConfirmOn: true,
    mtfConfirmInterval: '30m',
    mtfMinTrendStrength: 0.0008,
    corrFilterOn: true,
    corrLookback: 40,
    corrMin: 0.72,
    corrMaxOpenSameSide: 3,
    edgeMinPct: 0.20,
    minRR: 1.40,
    taxOn: true,
    taxPct: 15,
    taxApplyCash: true,
    auditOn: true,
    auditFlushSec: 8,
  },
  '30m': {
    name: 'Preset 30m (Institutional)',
    interval: '30m',
    loopSec: 25,
    limit: 300,
    mode: 'AUTO',
    riskPct: 0.75,
    maxDailyDD: 2.4,
    maxOpen: 3,
    noRepeat: true,
    cooldownCandles: 4,
    atrPeriod: 14,
    atrStop: 2.6,
    atrTarget: 4.0,
    atrTrail: 2.3,
    breakEvenR: 1.35,
    timeStopOn: true,
    timeStopCandles: 18,
    partialOn: true,
    partialAtR: 1.4,
    partialPct: 25,
    beAfterPartialOn: true,
    autoProfitOn: true,
    autoProfitPct: 0.65,
    universeMode: 'TOPN',
    topN: 4,
    bestRefreshMin: 18,
    feeMode: 'BNB',
    feePctCustom: 0.10,
    execSpreadBps: 3,
    execSlippageBps: 2,
    execLatencyMs: 200,
    execLatencyBpsPerSec: 0.8,
    mtfConfirmOn: true,
    mtfConfirmInterval: '1h',
    mtfMinTrendStrength: 0.0007,
    corrFilterOn: true,
    corrLookback: 40,
    corrMin: 0.70,
    corrMaxOpenSameSide: 3,
    edgeMinPct: 0.24,
    minRR: 1.50,
    taxOn: true,
    taxPct: 15,
    taxApplyCash: true,
    auditOn: true,
    auditFlushSec: 8,
  }
};

const PARAM_TOOLTIPS = {
  cfgInitialCash: 'Capital inicial da simulação. Com robô parado e sem posições, aplicar altera caixa e base de P/L.',
  cfgMode: 'AUTO executa sem confirmação; ASK cria pendências e permite aprovação manual.',
  cfgInterval: 'Granularidade dos candles usados no sinal. Menor intervalo = mais sinais e mais ruído.',
  cfgLoopSec: 'Frequência de atualização do robô. Menor loop consome mais API e reage mais rápido.',
  cfgLimit: 'Quantidade de candles usados nos indicadores. Mais histórico melhora contexto e aumenta custo.',
  cfgUniverseMode: 'Define universo operado: único símbolo, lista customizada ou Top N do best-of-day.',
  cfgTopN: 'Quantidade de símbolos no modo Top N. Mais símbolos = mais oportunidades e mais risco operacional.',
  cfgBestRefreshMin: 'Intervalo de atualização do ranking best-of-day.',
  cfgRiskPct: 'Percentual do caixa arriscado por trade. Impacta tamanho da posição.',
  cfgMaxOpen: 'Máximo de trades simultâneos.',
  cfgMaxDailyDD: 'Queda diária máxima do caixa para travar novas entradas.',
  cfgNoRepeat: 'Evita abrir o mesmo sinal no mesmo candle.',
  cfgCooldownCandles: 'Candles de espera por símbolo após entrada/saída.',
  cfgAtrPeriod: 'Janela do ATR para volatilidade.',
  cfgAtrStop: 'Distância do stop em múltiplos de ATR.',
  cfgAtrTarget: 'Distância do alvo em múltiplos de ATR.',
  cfgAtrTrail: 'Trailing stop em múltiplos de ATR.',
  cfgBreakEvenR: 'Move stop para entrada ao atingir este múltiplo de R.',
  cfgTimeStopOn: 'Ativa saída por tempo máximo de permanência.',
  cfgTimeStopCandles: 'Quantidade máxima de candles por trade.',
  cfgPartialOn: 'Ativa realização parcial de posição.',
  cfgPartialAtR: 'R mínimo para executar parcial.',
  cfgPartialPct: 'Percentual da posição encerrado na parcial.',
  cfgBEAfterPartialOn: 'Após parcial, move stop para preço de entrada.',
  cfgAutoProfitOn: 'Ativa fechamento automático por lucro percentual.',
  cfgAutoProfitPct: 'Lucro percentual mínimo para auto-close.',
  cfgFeeMode: 'Modelo de taxa Binance usado na simulação.',
  cfgFeePctCustom: 'Taxa custom em % quando Fee Mode = CUSTOM.',
  cfgExecSpreadBps: 'Custo estimado de spread em basis points.',
  cfgExecSlippageBps: 'Custo estimado de slippage em basis points.',
  cfgExecLatencyMs: 'Latência média de execução usada no modelo adverso.',
  cfgExecLatencyBpsPerSec: 'Impacto de preço por segundo de latência (bps/s).',
  cfgEdgeMinPct: 'Margem mínima extra acima de taxa+execução para aceitar o trade.',
  cfgTaxOn: 'Ativa cálculo de imposto sobre lucro líquido.',
  cfgTaxPct: 'Alíquota simulada de imposto.',
  cfgTaxApplyCash: 'Quando ON, debita imposto do caixa na hora.',
  cfgAuditOn: 'Quando ON, envia logs [AUDIT] para endpoint remoto.',
  cfgAuditFlushSec: 'Intervalo de envio em lote da auditoria.',
  cfgAuditEndpoint: 'URL completa da Edge Function de auditoria.',
  cfgAuditToken: 'Token secreto exigido pelo audit-proxy (header x-audit-token).'
};

// --------- preset helpers ----------
function setInput(id, value){
  const x = document.getElementById(id);
  if (!x) return;
  x.value = String(value);
}
function readBoolSelect(id){
  const v = (document.getElementById(id)?.value || 'OFF');
  return v === 'ON';
}
function readInitialCashInput(){
  const raw = Number(document.getElementById('cfgInitialCash')?.value || S.initialCash || 100);
  if (!Number.isFinite(raw)) return Number(S.initialCash || 100);
  return Math.max(10, Math.min(10_000_000, raw));
}
function applyInitialCashInput(silent = false){
  const nextCash = readInitialCashInput();
  setInput('cfgInitialCash', nextCash);

  const hasExposure = (S.open.length > 0) || (S.pending.length > 0);
  if (S.running || hasExposure){
    S.pendingInitialCash = nextCash;
    if (!silent){
      log(`Saldo inicial pendente: ${fmtUSD(nextCash)}. Aplicação no caixa exige robô parado e sem posições abertas/pendentes.`);
    }
    return;
  }

  S.initialCash = nextCash;
  S.pendingInitialCash = null;
  S.cash = nextCash;
  S.dayAnchorCash = nextCash;
  S.dayPeakCash = nextCash;
  S.highWatermarkCash = nextCash;
  S._dayKey = null;
  if (!silent){
    log(`Saldo inicial aplicado: ${fmtUSD(nextCash)}.`);
  }
  repaint();
}

function applyIntervalPreset(presetKey, silent = false){
  if (S.running){
    if (!silent){
      log('Preset não alterado: pare o robô para aplicar mudanças de configuração.');
    }
    return;
  }
  const key = String(presetKey || '').trim();
  const p = INTERVAL_PRESETS[key];
  if (!p) return;

  S.intervalPreset = key;
  S.minRR = Number(p.minRR || 1.15);

  setInput('cfgInterval', p.interval);
  setInput('cfgLoopSec', p.loopSec);
  setInput('cfgLimit', p.limit);
  setInput('cfgMode', p.mode);

  setInput('cfgRiskPct', p.riskPct);
  setInput('cfgMaxDailyDD', p.maxDailyDD);
  setInput('cfgMaxOpen', p.maxOpen);
  setInput('cfgNoRepeat', p.noRepeat ? 'ON' : 'OFF');
  setInput('cfgCooldownCandles', p.cooldownCandles);

  setInput('cfgAtrPeriod', p.atrPeriod);
  setInput('cfgAtrStop', p.atrStop);
  setInput('cfgAtrTarget', p.atrTarget);
  setInput('cfgAtrTrail', p.atrTrail);
  setInput('cfgBreakEvenR', p.breakEvenR);

  setInput('cfgTimeStopOn', p.timeStopOn ? 'ON' : 'OFF');
  setInput('cfgTimeStopCandles', p.timeStopCandles);
  setInput('cfgPartialOn', p.partialOn ? 'ON' : 'OFF');
  setInput('cfgPartialAtR', p.partialAtR);
  setInput('cfgPartialPct', p.partialPct);
  setInput('cfgBEAfterPartialOn', p.beAfterPartialOn ? 'ON' : 'OFF');
  setInput('cfgAutoProfitOn', p.autoProfitOn ? 'ON' : 'OFF');
  setInput('cfgAutoProfitPct', p.autoProfitPct);

  setInput('cfgUniverseMode', p.universeMode);
  setInput('cfgTopN', p.topN);
  setInput('cfgBestRefreshMin', p.bestRefreshMin);

  setInput('cfgFeeMode', p.feeMode);
  setInput('cfgFeePctCustom', p.feePctCustom);
  setInput('cfgExecSpreadBps', p.execSpreadBps);
  setInput('cfgExecSlippageBps', p.execSlippageBps);
  setInput('cfgExecLatencyMs', p.execLatencyMs);
  setInput('cfgExecLatencyBpsPerSec', p.execLatencyBpsPerSec);
  setInput('cfgEdgeMinPct', p.edgeMinPct);
  S.mtfConfirmOn = !!p.mtfConfirmOn;
  S.mtfConfirmInterval = String(p.mtfConfirmInterval || p.interval || '15m');
  S.mtfMinTrendStrength = Math.max(0, Number(p.mtfMinTrendStrength || 0.0008));
  S.corrFilterOn = !!p.corrFilterOn;
  S.corrLookback = Math.max(20, Number(p.corrLookback || 40));
  S.corrMin = Math.max(0, Math.min(0.99, Number(p.corrMin || 0.72)));
  S.corrMaxOpenSameSide = Math.max(1, Math.min(20, Number(p.corrMaxOpenSameSide || 3)));

  setInput('cfgTaxOn', p.taxOn ? 'ON' : 'OFF');
  setInput('cfgTaxPct', p.taxPct);
  setInput('cfgTaxApplyCash', p.taxApplyCash ? 'ON' : 'OFF');
  setInput('cfgAuditOn', p.auditOn ? 'ON' : 'OFF');
  setInput('cfgAuditFlushSec', p.auditFlushSec);

  if (el.profileSeg){
    el.profileSeg.querySelectorAll('.segbtn').forEach((b) => {
      const on = b.getAttribute('data-intpreset') === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (el.profileHint){
    el.profileHint.textContent = `Ativo: ${p.name} · minRR ${S.minRR.toFixed(2)} · edge ${Number(p.edgeMinPct).toFixed(2)}% · MTF ${S.mtfConfirmInterval} · corr>=${S.corrMin.toFixed(2)}`;
  }
  renderPresetComparison();

  if (!silent){
    log(`[PRESET] Aplicado ${p.name} (${key})`);
  }
  repaint();
}

function loadSelectedPresetId(){
  try{
    const saved = localStorage.getItem(PRESET_STORAGE_KEY);
    if (saved && PRESETS[saved]) return saved;
  } catch(_e){
    // ignore storage issues
  }
  return 'NONE';
}

function persistSelectedPresetId(id){
  try{
    localStorage.setItem(PRESET_STORAGE_KEY, id || 'NONE');
  } catch(_e){
    // ignore storage issues
  }
}

function applySelectedPresetId(id, silent = false){
  const nextId = (id && PRESETS[id]) ? id : 'NONE';
  S.selectedPresetId = nextId;
  S.selectedPresetName = nextId === 'NONE' ? 'Sem preset extra' : PRESETS[nextId].name;
  persistSelectedPresetId(nextId);
  const node = document.getElementById('cfgStrategyPreset');
  if (node && node.value !== nextId) node.value = nextId;
  if (!silent){
    log(`[PRESET_STRATEGY] ${S.selectedPresetName} (${nextId})`);
  }
  repaint();
}

function initStrategyPresetSelector(){
  const node = document.getElementById('cfgStrategyPreset');
  if (!node) return;
  node.innerHTML = [
    `<option value="NONE">Sem preset extra</option>`,
    ...Object.values(PRESETS).map((p) => `<option value="${p.id}">${p.name}</option>`)
  ].join('');
  node.value = S.selectedPresetId || 'NONE';
}

function applyParamTooltips(){
  for (const [id, text] of Object.entries(PARAM_TOOLTIPS)){
    const node = document.getElementById(id);
    if (!node) continue;
    node.title = text;
    const label = node.closest('label');
    if (label) label.title = text;
  }
}

function renderPresetComparison(){
  const host = document.getElementById('presetCompare');
  if (!host) return;
  const active = String(S.intervalPreset || '5m');
  const order = ['5m','15m','30m'];
  host.innerHTML = order.map((k) => {
    const p = INTERVAL_PRESETS[k];
    const activeCls = k === active ? ' active' : '';
    const pressed = k === active ? 'true' : 'false';
    return `
      <button type="button" class="presetCard presetCardBtn${activeCls}" data-intpreset="${k}" aria-pressed="${pressed}">
        <div class="head"><b>${p.name}</b><span class="tag info">${k}</span></div>
        <div class="small">Risco ${p.riskPct.toFixed(2)}% · DD ${p.maxDailyDD.toFixed(1)}% · Open ${p.maxOpen}</div>
        <div class="small">ATR S/T ${p.atrStop.toFixed(1)}/${p.atrTarget.toFixed(1)} · Trail ${p.atrTrail.toFixed(1)}</div>
        <div class="small">minRR ${p.minRR.toFixed(2)} · edge ${p.edgeMinPct.toFixed(2)}% · autoProfit ${p.autoProfitPct.toFixed(2)}%</div>
        <div class="small">Exec ${p.execSpreadBps}bps + ${p.execSlippageBps}bps · loop ${p.loopSec}s · topN ${p.topN}</div>
        <div class="small">MTF ${p.mtfConfirmInterval} · corr ${p.corrMin.toFixed(2)} · cap lado ${p.corrMaxOpenSameSide}</div>
      </button>
    `;
  }).join('');
}

function getIsoWeekKey(tsMs = Date.now()){
  const d = new Date(tsMs);
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function refreshWeeklyCounter(nowTs = Date.now()){
  const key = getIsoWeekKey(nowTs);
  if (S.tradesWeekKey !== key){
    S.tradesWeekKey = key;
    S.tradesThisWeek = 0;
  }
}

function refreshTurnoverDay(nowTs = Date.now()){
  const d = new Date(nowTs);
  const dayKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  if (S.turnoverDayKey !== dayKey){
    S.turnoverDayKey = dayKey;
    S.dayTurnoverUsd = 0;
  }
}

function refreshHighWatermarkCash(){
  const cur = Number(S.cash || 0);
  S.highWatermarkCash = Math.max(Number(S.highWatermarkCash || cur), cur);
}

function getDrawdownFromHigh(){
  const high = Math.max(1e-9, Number(S.highWatermarkCash || S.cash || 1));
  const cur = Number(S.cash || 0);
  return Math.max(0, (high - cur) / high);
}

function estimateAtrSeries(highs, lows, closes, p = 14){
  const out = new Array(closes.length).fill(null);
  if (!Array.isArray(closes) || closes.length < p + 1) return out;
  const trs = [];
  for (let i = 1; i < closes.length; i++){
    const h = Number(highs[i] || 0);
    const l = Number(lows[i] || 0);
    const pc = Number(closes[i - 1] || 0);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let sum = 0;
  for (let i = 0; i < p; i++) sum += trs[i];
  let atr = sum / p;
  out[p] = atr;
  for (let i = p; i < trs.length; i++){
    atr = ((atr * (p - 1)) + trs[i]) / p;
    out[i + 1] = atr;
  }
  return out;
}

function normalizeRiskPctForDisplay(cfg){
  if (cfg?.riskPctIsFraction) return Number(cfg.riskPct || 0) * 100;
  return Number(cfg?.riskPct || 0);
}

function computeDynamicRiskMultiplier(cfg){
  if (!S.riskCutActive || !cfg?.lossStreakRiskCutOn) return 1;
  const cut = Number(cfg.lossStreakCutFactor || 0.5);
  return Math.max(0.1, Math.min(1, cut));
}

function evaluateTrendGate(dec, series, cfg){
  if (!cfg.trendOnly) return { ok: true };
  const n = series.c.length - 1;
  if (n < 220 || !Number.isFinite(dec.ma200) || !Number.isFinite(dec.atr)){
    return { ok: false, reason: 'TREND_GATE_INSUF' };
  }
  const ma200 = SMA(series.c, 200);
  const mNow = ma200[n];
  const mPrev = ma200[Math.max(0, n - 5)];
  const slope = (Number.isFinite(mNow) && Number.isFinite(mPrev))
    ? (mNow - mPrev) / Math.max(1e-9, Math.abs(mPrev))
    : -1;
  const atrSeries = estimateAtrSeries(series.h, series.l, series.c, cfg.atrPeriod || 14);
  const atrNow = atrSeries[n];
  if (!Number.isFinite(atrNow)){
    return { ok: false, reason: 'TREND_GATE_ATR_INSUF' };
  }
  let atrSum = 0;
  let atrCount = 0;
  for (let i = Math.max(0, n - 19); i <= n; i++){
    if (Number.isFinite(atrSeries[i])){
      atrSum += atrSeries[i];
      atrCount += 1;
    }
  }
  const atrAvg20 = atrCount ? atrSum / atrCount : atrNow;
  const atrRatio = atrNow / Math.max(1e-9, atrAvg20);

  const slopeMin = Number(cfg.trendSlopeMin ?? 0);
  const atrMinRatio = Number(cfg.atrExpansionMinRatio ?? 1.0);
  const priceAbove = Number(dec.last || 0) > Number(dec.ma200 || 0);
  if (!priceAbove) return { ok: false, reason: 'TREND_GATE_MA200' };
  if (!(slope > slopeMin)) return { ok: false, reason: 'TREND_GATE_SLOPE', slope, slopeMin };
  if (!(atrRatio > atrMinRatio)) return { ok: false, reason: 'TREND_GATE_ATR_EXP', atrRatio, atrMinRatio };
  return { ok: true, slope, atrRatio };
}

function evaluateChopGate(dec, series, cfg){
  if (!cfg.regimeChopBlock) return { ok: true };
  const n = series.c.length - 1;
  if (n < 60) return { ok: false, reason: 'CHOP_BLOCK_INSUF' };
  const ma20 = SMA(series.c, 20);
  const ma50 = SMA(series.c, 50);
  const m20 = ma20[n];
  const m50 = ma50[n];
  const price = Number(dec.last || 0);
  const atrPct = Number(dec.atrPct || 0);
  const trendStrength = Number(dec.trendStrength || 0);
  const maSep = (Number.isFinite(m20) && Number.isFinite(m50))
    ? Math.abs(m20 - m50) / Math.max(1e-9, price)
    : 0;
  const minTrend = Number(cfg.minTrendStrengthGate ?? 0.0007);
  const minSep = Number(cfg.minMaSeparationPct ?? 0.0014);
  const minAtrPct = Number(cfg.minAtrPctGate ?? 0.003);

  if (trendStrength < minTrend) return { ok: false, reason: 'CHOP_BLOCK_TREND', trendStrength, minTrend };
  if (maSep < minSep) return { ok: false, reason: 'CHOP_BLOCK_MA_SEP', maSep, minSep };
  if (atrPct < minAtrPct) return { ok: false, reason: 'CHOP_BLOCK_ATR', atrPct, minAtrPct };
  return { ok: true, trendStrength, maSep, atrPct };
}

function evaluatePullbackGate(dec, series, cfg){
  if (!cfg.requirePullbackEntry) return { ok: true };
  const n = series.c.length - 1;
  if (n < 55 || !Number.isFinite(dec.atr)) return { ok: false, reason: 'PULLBACK_INSUF' };
  const ma20 = SMA(series.c, 20);
  const ma50 = SMA(series.c, 50);
  const m20 = ma20[n];
  const m50 = ma50[n];
  const recentHigh = Math.max(...series.h.slice(Math.max(0, n - 10), n + 1));
  const zoneByHigh = recentHigh - (0.5 * dec.atr);
  const zoneByMa = Number.isFinite(m20) && Number.isFinite(m50) ? Math.max(m20, m50) : m20;
  const zone = Number.isFinite(zoneByMa) ? Math.max(zoneByMa, zoneByHigh) : zoneByHigh;
  const touchedPullback = Number(series.l[n] || 0) <= zone;
  const bullBody = Number(series.c[n] || 0) > Number(series.o[n] || 0);
  const accel = (Number(series.c[n] || 0) - Number(series.o[n] || 0)) > (0.2 * Number(dec.atr || 0));
  const confirmed = bullBody && accel && (Number(series.c[n] || 0) > Number(series.c[n - 1] || 0));
  if (!touchedPullback) return { ok: false, reason: 'PULLBACK_NOT_TOUCHED' };
  if (!confirmed) return { ok: false, reason: 'PULLBACK_NO_CONFIRM' };
  return { ok: true };
}

function evaluateEdgeGates(cfg){
  if (!cfg.edgeGating) return { ok: true };
  const roll = computeRollingEdge(cfg.edgeWindowTrades || 50);
  S.lastRollingExpectancyUsd = roll.expectancyUsd;
  S.lastRollingWinRate = roll.winRate;
  if (!roll.count || !Number.isFinite(roll.expectancyUsd)){
    return { ok: false, reason: 'EDGE_INSUF', roll };
  }
  const minExp = Number(cfg.minRollingExpectancyUsd || 0);
  if (roll.expectancyUsd <= minExp){
    return { ok: false, reason: 'EDGE_EXPECTANCY', roll, minExp };
  }
  if (Number.isFinite(Number(cfg.minRollingWinRate))){
    const minWr = Number(cfg.minRollingWinRate);
    if (!Number.isFinite(roll.winRate) || roll.winRate < minWr){
      return { ok: false, reason: 'EDGE_WINRATE', roll, minWr };
    }
  }
  return { ok: true, roll };
}

function estimateEntrySlippageUsd(entry, qty, cfg){
  const px = Number(entry || 0);
  const q = Number(qty || 0);
  const notional = Math.abs(px * q);
  const slipRate = Number(cfg.slippageRate || 0);
  return notional * Math.max(0, slipRate);
}

function evaluateSlippageKillSwitch(entry, qty, cfg){
  if (!cfg.maxSlippagePct && !cfg.maxSlippageUsd) return { ok: true };
  const px = Number(entry || 0);
  const q = Number(qty || 0);
  const notional = Math.abs(px * q);
  const slipUsd = estimateEntrySlippageUsd(px, q, cfg);
  const slipPct = slipUsd / Math.max(1e-9, notional);
  const maxSlipPct = Number(cfg.maxSlippagePct || Infinity);
  const maxSlipUsd = Number(cfg.maxSlippageUsd || Infinity);
  if (slipPct > maxSlipPct || slipUsd > maxSlipUsd){
    const barMs = intervalToMs(cfg.interval || '5m');
    const candles = Math.max(1, Number(cfg.killSwitchCandles || 6));
    S.killSwitchUntilTs = Date.now() + (barMs * candles);
    S.killSwitchReason = `KILL_SWITCH_SLIPPAGE pct=${(slipPct * 100).toFixed(3)} usd=${slipUsd.toFixed(2)}`;
    return { ok: false, reason: S.killSwitchReason };
  }
  return { ok: true, slipPct, slipUsd };
}

// --------- symbols/universe ----------
function fillSymbols(){
  el.cfgSymbolSingle.innerHTML = '';
  for (const sym of S.TOP50_USDT){
    const opt = document.createElement('option');
    opt.value = sym;
    opt.textContent = sym;
    el.cfgSymbolSingle.appendChild(opt);
  }
  el.cfgSymbolSingle.value = 'BTCUSDT';

  el.cfgSymbolCustom.innerHTML = '';
  for (const sym of S.TOP50_USDT){
    const opt = document.createElement('option');
    opt.value = sym;
    opt.textContent = sym;
    el.cfgSymbolCustom.appendChild(opt);
  }
  const defaults = new Set(["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","AVAXUSDT"]);
  for (const opt of el.cfgSymbolCustom.options){
    if (defaults.has(opt.value)) opt.selected = true;
  }
}

function getUniverseSymbols(){
  const mode = document.getElementById('cfgUniverseMode').value;
  if (mode === 'SINGLE'){
    const s = document.getElementById('cfgSymbolSingle').value;
    return [s].filter(Boolean);
  }
  if (mode === 'CUSTOM'){
    const sel = document.getElementById('cfgSymbolCustom');
    const out = [];
    for (const opt of sel.options){
      if (opt.selected) out.push(opt.value);
    }
    return out.length ? out : [document.getElementById('cfgSymbolSingle').value];
  }
  const n = Math.max(1, Math.min(20, Number(document.getElementById('cfgTopN').value || 6)));
  const list = S.bestOfDay.slice(0, n).map(x => x.symbol);
  return list.length ? list : [document.getElementById('cfgSymbolSingle').value];
}

// --------- config ----------
function getCfg(){
  const interval = document.getElementById('cfgInterval').value;
  const loopSec = Math.max(2, Number(document.getElementById('cfgLoopSec').value||10));
  const limit = Math.max(60, Math.min(1000, Number(document.getElementById('cfgLimit').value||300)));
  const mode = document.getElementById('cfgMode').value;

  const riskPct = Math.max(0.1, Math.min(2, Number(document.getElementById('cfgRiskPct').value||1.0)));
  const maxOpen = Math.max(1, Math.min(20, Number(document.getElementById('cfgMaxOpen').value||20)));
  const maxDailyDD = Math.max(0.3, Math.min(99, Number(document.getElementById('cfgMaxDailyDD').value||1.8)));

  const noRepeat = ((document.getElementById('cfgNoRepeat')?.value || 'ON') === 'ON');
  const cooldownCandles = Math.max(0, Math.min(200, Number(document.getElementById('cfgCooldownCandles')?.value || 3)));

  const atrPeriod = Math.max(7, Math.min(50, Number(document.getElementById('cfgAtrPeriod').value||14)));
  const atrStop = Math.max(0.2, Math.min(12, Number(document.getElementById('cfgAtrStop').value||2.6)));
  const atrTarget = Math.max(0.5, Math.min(20, Number(document.getElementById('cfgAtrTarget').value||3.2)));
  const atrTrail = Math.max(0, Math.min(20, Number(document.getElementById('cfgAtrTrail').value||2.4)));
  const breakEvenR = Math.max(0, Math.min(10, Number(document.getElementById('cfgBreakEvenR').value||1.5)));

  const timeStopOn = readBoolSelect('cfgTimeStopOn');
  const timeStopCandles = Math.max(1, Math.min(200, Number(document.getElementById('cfgTimeStopCandles')?.value || 18)));

  const partialOn = readBoolSelect('cfgPartialOn');
  const partialAtR = Math.max(0.1, Math.min(10, Number(document.getElementById('cfgPartialAtR')?.value || 1.2)));
  const partialPct = Math.max(1, Math.min(90, Number(document.getElementById('cfgPartialPct')?.value || 35))) / 100;

  const beAfterPartialOn = readBoolSelect('cfgBEAfterPartialOn');

  const autoProfitOn = readBoolSelect('cfgAutoProfitOn');
  const autoProfitPct = Math.max(0.01, Math.min(20, Number(document.getElementById('cfgAutoProfitPct')?.value || 0.45)));

  const bestRefreshMin = Math.max(1, Math.min(60, Number(document.getElementById('cfgBestRefreshMin')?.value || 10)));
  const universeMode = document.getElementById('cfgUniverseMode').value;
  const topN = Math.max(1, Math.min(20, Number(document.getElementById('cfgTopN')?.value || 6)));
  const autoMinimize = ((document.getElementById('cfgAutoMinimize')?.value || 'ON') === 'ON');

  // Taxas (Binance spot) — padrão: 0.10% (taker). Com BNB: 0.075%.
  const feeMode = (document.getElementById('cfgFeeMode')?.value || 'STANDARD');
  const feePctCustom = Math.max(0, Math.min(1, Number(document.getElementById('cfgFeePctCustom')?.value || 0.10)));
  const execSpreadBps = Math.max(0, Math.min(100, Number(document.getElementById('cfgExecSpreadBps')?.value || 4)));
  const execSlippageBps = Math.max(0, Math.min(200, Number(document.getElementById('cfgExecSlippageBps')?.value || 2)));
  const execLatencyMs = Math.max(0, Math.min(10_000, Number(document.getElementById('cfgExecLatencyMs')?.value || 200)));
  const execLatencyBpsPerSec = Math.max(0, Math.min(50, Number(document.getElementById('cfgExecLatencyBpsPerSec')?.value || 1)));
// Edge mínimo (%) acima do custo de taxas (ida+volta).
// Ex.: taxas 0.10% + 0.10% = 0.20%. Com edgeMinPct=0.10 => exige >= 0.30% de movimento esperado até o target.
const edgeMinPct = Math.max(0, Math.min(5, Number(document.getElementById('cfgEdgeMinPct')?.value || 0.10)));

  // Imposto (simulação): reserva/abatimento do saldo com base no lucro líquido (após taxas)
  const taxOn = readBoolSelect('cfgTaxOn');
  const taxPct = Math.max(0, Math.min(50, Number(document.getElementById('cfgTaxPct')?.value || 15)));
  const taxApplyCash = ((document.getElementById('cfgTaxApplyCash')?.value || 'ON') === 'ON');
  const auditOn = readBoolSelect('cfgAuditOn');
  const auditFlushSec = Math.max(2, Math.min(120, Number(document.getElementById('cfgAuditFlushSec')?.value || 8)));
  const auditEndpoint = (document.getElementById('cfgAuditEndpoint')?.value || 'https://kpobkwxoydnkeazbzzqo.supabase.co/functions/v1/audit-proxy').trim();
  const auditToken = (document.getElementById('cfgAuditToken')?.value || S.settings?.auditTokenDefault || '').trim();
  const minRR = Math.max(1.0, Number(S.minRR || 1.15));
  const mtfConfirmOn = !!S.mtfConfirmOn;
  const mtfConfirmInterval = String(S.mtfConfirmInterval || interval || '15m');
  const mtfMinTrendStrength = Math.max(0, Number(S.mtfMinTrendStrength || 0.0008));
  const corrFilterOn = !!S.corrFilterOn;
  const corrLookback = Math.max(20, Math.min(200, Number(S.corrLookback || 40)));
  const corrMin = Math.max(0, Math.min(0.99, Number(S.corrMin || 0.72)));
  const corrMaxOpenSameSide = Math.max(1, Math.min(20, Number(S.corrMaxOpenSameSide || 3)));

  const rawCfg = {
    interval, loopSec, limit, mode,
    riskPct, maxOpen, maxDailyDD,
    noRepeat, cooldownCandles,
    atrPeriod, atrStop, atrTarget, atrTrail, breakEvenR,
    timeStopOn, timeStopCandles,
    partialOn, partialAtR, partialPct, beAfterPartialOn,
    autoProfitOn, autoProfitPct,
    bestRefreshMin,
    universeMode, topN,
    autoMinimize,
    feeMode, feePctCustom,
    execSpreadBps, execSlippageBps, execLatencyMs, execLatencyBpsPerSec,
    minRR,
    edgeMinPct,
    mtfConfirmOn, mtfConfirmInterval, mtfMinTrendStrength,
    corrFilterOn, corrLookback, corrMin, corrMaxOpenSameSide,
    fetchConcurrency: 5,
    taxOn, taxPct, taxApplyCash,
    auditOn, auditFlushSec, auditEndpoint, auditToken,
    profile: S.profile,
    preset: S.intervalPreset,
    symbols: getUniverseSymbols()
  };
  const cfgWithPreset = applyPreset(rawCfg, S.selectedPresetId);
  return cfgWithPreset;
}

function resolveRuntimeSymbols(cfg){
  if (!cfg || !Array.isArray(cfg.symbols)) return [];
  if (cfg.universeMode !== 'TOPN'){
    return cfg.symbols.filter(Boolean);
  }
  const n = Math.max(1, Math.min(20, Number(cfg.topN || cfg.symbols.length || 6)));
  const dyn = S.bestOfDay.slice(0, n).map((x) => x.symbol).filter(Boolean);
  return dyn.length ? dyn : cfg.symbols.filter(Boolean);
}

function getActiveCfg(){
  if (!S.runtimeCfg) return getCfg();
  const cfg = { ...S.runtimeCfg };
  cfg.symbols = resolveRuntimeSymbols(cfg);
  return cfg;
}

// --------- focus mode ----------
function setFocus(on, reason=''){
  S.focus = !!on;
  document.body.classList.toggle('focusMode', S.focus);
  el.btnFocus.textContent = `Modo Foco: ${S.focus ? 'ON' : 'OFF'}`;
  if (el.btnFocusHeader) el.btnFocusHeader.textContent = `Modo Foco: ${S.focus ? 'ON' : 'OFF'}`;

  // Ensure the focus controls panel is visible/hidden even if CSS is overridden
  try{
    const panel = document.querySelector('.focusControlsPanel');
    if (panel) panel.style.display = S.focus ? 'flex' : 'none';
  }catch(e){ /* ignore */ }

  // ✅ Política do MVP:
  // - Sem botão de minimizar/maximizar.
  // - Foco OFF: controles sempre visíveis.
  // - Foco ON : controles recolhem com transição (CSS) e o painel da esquerda vira "Focus Deck".
  if (reason) log(reason);
  updateUI(el, getActiveCfg, {
    bestOfDayLabel
  });
  renderFocusDeck(el, getActiveCfg, {
    closeTradeByIdMarket,
    closeProfitOnlyMarket,
    closeAllOpenMarket,
    acceptPending,
    rejectPending
  });
}

// --------- best-of-day ----------
async function refreshBestOfDayIfNeeded(cfg, force=false){
  const due = (Date.now() - S.bestUpdatedAt) >= (cfg.bestRefreshMin * 60_000);
  if (!force && !due) return;

  try{
    const tickers = await fetch24hTickers();
    const map = new Map();
    for (const t of tickers){
      map.set(String(t.symbol), Number(t.priceChangePercent));
    }
    const list = [];
    for (const sym of S.TOP50_USDT){
      const pct = map.get(sym);
      if (Number.isFinite(pct)) list.push({symbol:sym, pct});
    }
    list.sort((a,b) => Math.abs(b.pct) - Math.abs(a.pct));
    S.bestOfDay = list;
    S.bestUpdatedAt = Date.now();
    S.bestErr = null;

    const top = list.slice(0, Math.max(1, Math.min(20, cfg.topN)));
    log(`Best-of-day atualizado. Top: ${top.map(x => `${x.symbol}(${x.pct.toFixed(1)}%)`).join(', ')}`);
  } catch(e){
    S.bestErr = e?.message || String(e);
    log(`Erro best-of-day: ${S.bestErr}`);
  }
}

// --------- pending ----------
function addPending(idea){
  const key = tradeKey(idea.signal, idea.symbol, idea.interval, idea.klineCloseTs);
  if (S.pending.some(p => p.key === key)) return;
  S.pending.unshift({ ...idea, id: (Math.random().toString(16).slice(2)+'-'+Math.random().toString(16).slice(2)), createdAt: Date.now(), key });
  if (S.pending.length > 30) S.pending.pop();
  log(`ASK: ${idea.signal} ${idea.symbol} score ${idea.score.toFixed(2)} (pendente)`);
}

function acceptPending(id){
  const cfg = S.runtimeCfg || getCfg();
  const p = S.pending.find(x => x.id === id);
  if (!p) return;

  const gate = canTradeNew(cfg);
  if (!gate.ok){ log(`❌ Aceite recusado: ${gate.reason}`); return; }

  if (cfg.noRepeat && !canPassTradeGuard(p.key)){
    log(`🛑 Aceite bloqueado (repetido): ${p.key}`);
    return;
  }

  openTradeFromIdea({...p, fmtPx}, cfg, log, p.riskMult ?? 1.0);
  markTradeGuard(p.key);

  if (cfg.cooldownCandles > 0 && p.klineCloseTs){
    const barMs = intervalToMs(cfg.interval);
    S.cooldownBySymbol.set(p.symbol, p.klineCloseTs + cfg.cooldownCandles*barMs);
  }

  S.pending = S.pending.filter(x => x.id !== id);
  repaint();
}

function rejectPending(id){
  const p = S.pending.find(x => x.id === id);
  if (p) log(`ASK rejeitado: ${p.signal} ${p.symbol} score ${p.score.toFixed(2)}`);
  S.pending = S.pending.filter(x => x.id !== id);
  repaint();
}

// --------- close helpers ----------
function closeTradeByIdMarket(id){
  // Usa o mesmo fechamento do engine para manter consistência contábil
  // (taxas, imposto, streak e locks) entre saída automática e manual.
  const t = S.open.find(x => x.id === id);
  if (!t) return;
  const price = (typeof t.lastPrice === 'number') ? t.lastPrice : null;
  if (typeof price !== 'number') { log('❌ Sem preço atual para fechar em market.'); return; }
  closeTrade(t, price, 'MANUAL_MARKET', log, (S.runtimeCfg || getCfg()));
  repaint();
}

function closeAllOpenMarket(){
  const ids = S.open.map(x => x.id);
  if (!ids.length) { log('Nenhuma operação aberta para fechar.'); return; }
  for (const id of ids) closeTradeByIdMarket(id);
  log('Fechar tudo (market) concluído.');
}

function closeProfitOnlyMarket(){
  let n=0;
  for (const t of [...S.open]){
    const price = (typeof t.lastPrice === 'number') ? t.lastPrice : null;
    if (typeof price !== 'number') continue;
    const pnl = applyPnL(t.qty, t.side, t.entry, price);
    if (pnl > 0){
      closeTradeByIdMarket(t.id);
      n++;
    }
  }
  if (!n) log('Nenhuma operação com lucro para fechar.');
  else log(`Fechadas ${n} operações com lucro.`);
}

function closeLossOnlyMarket(){
  let n=0;
  for (const t of [...S.open]){
    const price = (typeof t.lastPrice === 'number') ? t.lastPrice : null;
    if (typeof price !== 'number') continue;
    const pnl = applyPnL(t.qty, t.side, t.entry, price);
    if (pnl < 0){
      closeTradeByIdMarket(t.id);
      n++;
    }
  }
  if (!n) log('Nenhuma operação com prejuízo para fechar.');
  else log(`Fechadas ${n} operações com prejuízo.`);
}

function buildReturnsVector(closes, lookback){
  const out = [];
  const n = closes.length;
  if (!Array.isArray(closes) || n < 3) return out;
  const len = Math.max(5, Math.min(lookback, n - 1));
  const start = n - len;
  for (let i = Math.max(1, start); i < n; i++){
    const prev = Number(closes[i - 1] || 0);
    const cur = Number(closes[i] || 0);
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0) continue;
    out.push((cur - prev) / prev);
  }
  return out;
}

function pearsonCorr(a, b){
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++){
    sx += a[i];
    sy += b[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++){
    const vx = a[i] - mx;
    const vy = b[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  if (!Number.isFinite(den) || den <= 1e-12) return null;
  return num / den;
}

function updateReturnCache(symbol, interval, closes, lookback){
  const vec = buildReturnsVector(closes, lookback);
  if (!vec.length) return;
  S.retCache.set(`${symbol}|${interval}`, { vec, ts: Date.now() });
}

async function getMtfSnapshot(symbol, cfg){
  if (!cfg.mtfConfirmOn || !cfg.mtfConfirmInterval) return null;
  const interval = String(cfg.mtfConfirmInterval);
  const key = `${symbol}|${interval}`;
  const barMs = intervalToMs(interval);
  const ttlMs = Math.max(20_000, Math.floor(barMs / 3));
  const cached = S.mtfCache.get(key);
  if (cached && (Date.now() - cached.ts) < ttlMs) return cached.snap;

  const kl = await fetchKlines(symbol, interval, Math.max(220, cfg.limit || 300));
  const s = parseKlines(kl);
  const c = s.c;
  const n = c.length - 1;
  if (n < 1) return null;

  const ema9 = EMA(c, 9);
  const ema21 = EMA(c, 21);
  const ma200 = SMA(c, 200);
  const last = c[n];
  const e9 = ema9[n];
  const e21 = ema21[n];
  const m200 = ma200[n];
  const hasM200 = Number.isFinite(m200);
  const trendStrength = (Number.isFinite(e9) && Number.isFinite(e21))
    ? Math.abs(e9 - e21) / Math.max(1e-9, last)
    : 0;
  const bullRegime = hasM200 ? last > m200 : false;
  const bearRegime = hasM200 ? last < m200 : false;
  const ok = hasM200 && Number.isFinite(e9) && Number.isFinite(e21) && (trendStrength >= cfg.mtfMinTrendStrength);
  const snap = { interval, last, e9, e21, m200, trendStrength, bullRegime, bearRegime, ok };
  S.mtfCache.set(key, { ts: Date.now(), snap });
  return snap;
}

function checkCorrelationGate(signal, symbol, cfg, series){
  if (!cfg.corrFilterOn) return { ok: true, sameSideOpen: 0, highCorrCount: 0, maxCorr: null };
  const sameSideSymbols = Array.from(new Set(
    S.open.filter((t) => t.side === signal).map((t) => String(t.symbol))
  )).filter((sym) => sym !== symbol);
  const sameSideOpen = sameSideSymbols.length;
  if (sameSideOpen < cfg.corrMaxOpenSameSide){
    return { ok: true, sameSideOpen, highCorrCount: 0, maxCorr: null };
  }

  const curVec = buildReturnsVector(series.c, cfg.corrLookback);
  if (curVec.length < 10) return { ok: true, sameSideOpen, highCorrCount: 0, maxCorr: null };

  let highCorrCount = 0;
  let maxCorr = null;
  for (const openSym of sameSideSymbols){
    const key = `${openSym}|${series.interval || cfg.interval}`;
    const rv = S.retCache.get(key)?.vec;
    if (!rv || rv.length < 10) continue;
    const c = pearsonCorr(curVec, rv);
    if (c == null) continue;
    maxCorr = (maxCorr == null) ? c : Math.max(maxCorr, c);
    if (c >= cfg.corrMin) highCorrCount += 1;
  }
  if (highCorrCount > 0){
    return { ok: false, sameSideOpen, highCorrCount, maxCorr };
  }
  return { ok: true, sameSideOpen, highCorrCount, maxCorr };
}

// --------- tick ----------

async function tickSymbol(symbol, cfg){
  const runPreset = S.runningProfile || S.intervalPreset || '-';
  const kl = await fetchKlines(symbol, cfg.interval, cfg.limit);
  const series = parseKlines(kl);
  series.interval = cfg.interval;
  updateReturnCache(symbol, cfg.interval, series.c, cfg.corrLookback);
  const currentKlineTs = series.t[series.t.length - 1] || Date.now();
  const dec = buildDecision(series, cfg);

  S.lastTickTs = Date.now();
  S.lastSymbol = symbol;
  S.lastPrice = dec.last;
  S.lastSignal = dec.signal;
  S.lastScore = dec.score;
  S.lastReasons = dec.reasons;

  updateOpenTradesForSymbol(symbol, dec.last, cfg, currentKlineTs, log, fmtPx);
  el.tickLabel.textContent = `Ultimo tick: ${new Date(S.lastTickTs).toLocaleTimeString('pt-BR',{hour12:false})}`;
  el.lastTickSmall.textContent = el.tickLabel.textContent;

  if (S.locked) return;
  if (Number(S.killSwitchUntilTs || 0) > Date.now()) return;

  const gate = canTradeNew(cfg);
  if (!gate.ok){
    if (gate.code === 'DD'){
      S.locked = true;
      S.lockType = 'DD';
      S.lockReason = gate.reason;
      log(`[GATE][BASE_DD] ${gate.reason}`);
    }
    return;
  }

  refreshWeeklyCounter();
  if (Number.isFinite(Number(cfg.maxTradesPerWeek)) && Number(cfg.maxTradesPerWeek) > 0){
    if (Number(S.tradesThisWeek || 0) >= Number(cfg.maxTradesPerWeek)){
      log(`[GATE][WEEKLY_LIMIT] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} used=${S.tradesThisWeek} max=${cfg.maxTradesPerWeek}`);
      return;
    }
  }

  refreshHighWatermarkCash();
  const ddFromHigh = getDrawdownFromHigh();
  if (Number.isFinite(Number(cfg.maxDD)) && ddFromHigh >= Number(cfg.maxDD)){
    S.locked = true;
    S.lockType = 'DD';
    S.lockReason = `DD ${(ddFromHigh * 100).toFixed(2)}% >= limite ${(Number(cfg.maxDD) * 100).toFixed(2)}%`;
    log(`[GATE][DD_BREAKER] ${S.lockReason}`);
    return;
  }

  refreshTurnoverDay();
  if (Number.isFinite(Number(cfg.maxTurnoverPerDayPct)) && Number(cfg.maxTurnoverPerDayPct) > 0){
    const turnoverCapUsd = Number(S.cash || 0) * (Number(cfg.maxTurnoverPerDayPct) / 100);
    if (Number(S.dayTurnoverUsd || 0) >= turnoverCapUsd){
      log(`[GATE][TURNOVER] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} turnover_usd=${Number(S.dayTurnoverUsd || 0).toFixed(2)} cap_usd=${turnoverCapUsd.toFixed(2)}`);
      return;
    }
  }

  const nextAllowed = S.cooldownBySymbol.get(symbol);
  if (cfg.cooldownCandles > 0 && typeof nextAllowed === 'number' && currentKlineTs < nextAllowed){
    return;
  }

  if (dec.signal === 'HOLD' || !dec.atr || dec.score < S.SCORE_MIN) return;
  if (cfg.trendOnly && dec.signal !== 'BUY') return;

  const trendGate = evaluateTrendGate(dec, series, cfg);
  if (!trendGate.ok){
    log(`[GATE][TREND] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} reason=${trendGate.reason}`);
    return;
  }
  const chopGate = evaluateChopGate(dec, series, cfg);
  if (!chopGate.ok){
    log(`[GATE][CHOP] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} reason=${chopGate.reason}`);
    return;
  }

  let mtf = null;
  if (dec.signal === 'BUY' && cfg.mtfConfirmOn){
    try{
      mtf = await getMtfSnapshot(symbol, cfg);
    } catch (e){
      log(`[PROFILE][SKIP_MTF] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} reason=mtf_fetch_error err=${e?.message || String(e)}`);
      return;
    }
    const mtfOk = !!(mtf && mtf.ok && mtf.bullRegime && Number.isFinite(mtf.e9) && Number.isFinite(mtf.e21) && (mtf.e9 > mtf.e21));
    if (!mtfOk){
      log(`[PROFILE][SKIP_MTF] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} mtf=${cfg.mtfConfirmInterval} trend=${Number(mtf?.trendStrength || 0).toFixed(4)} bull=${mtf?.bullRegime ? 1 : 0}`);
      return;
    }
  }

  const corrGate = checkCorrelationGate(dec.signal, symbol, cfg, series);
  if (!corrGate.ok){
    log(`[PROFILE][SKIP_CORR] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} side=${dec.signal} same_side_open=${corrGate.sameSideOpen} high_corr=${corrGate.highCorrCount} corr_max=${Number(corrGate.maxCorr || 0).toFixed(2)} corr_min=${Number(cfg.corrMin || 0).toFixed(2)}`);
    return;
  }

  const pullbackGate = evaluatePullbackGate(dec, series, cfg);
  if (!pullbackGate.ok){
    log(`[GATE][PULLBACK] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} reason=${pullbackGate.reason}`);
    return;
  }

  let riskMult = 1.0;
  if (dec.bullRegime && dec.ema9 != null && dec.ema21 != null && dec.ema9 < dec.ema21) riskMult = 0.5;
  if (dec.bearRegime && dec.ema9 != null && dec.ema21 != null && dec.ema9 > dec.ema21) riskMult = 0.5;
  riskMult *= getProfitProtectionFactor();
  riskMult *= computeDynamicRiskMultiplier(cfg);

  const entry = dec.last;
  const stopDist = dec.atr * cfg.atrStop;
  const targetDist = dec.atr * cfg.atrTarget;
  const stop = dec.signal === 'BUY' ? (entry - stopDist) : (entry + stopDist);
  const target = dec.signal === 'BUY' ? (entry + targetDist) : (entry - targetDist);
  const rr = Math.abs(target - entry) / Math.max(1e-9, Math.abs(entry - stop));

  const minGrossR = Number(cfg.minRR || 0);
  if (rr < minGrossR){
    if (S.testMode || dec.score >= 8.5){
      log(`[PROFILE][SKIP_RR] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} rr=${rr.toFixed(2)} min_rr=${minGrossR.toFixed(2)}`);
    }
    return;
  }

  const feePct = resolveTradeFeePct(cfg);
  const roundTripFeePct = Math.max(0, Number(feePct || 0)) * 2;
  const execCostPctOneWay = (Math.max(0, cfg.execSpreadBps || 0) / 2 + Math.max(0, cfg.execSlippageBps || 0) + ((Math.max(0, cfg.execLatencyMs || 0) / 1000) * Math.max(0, cfg.execLatencyBpsPerSec || 0))) / 100;
  const execCostPctRoundTrip = execCostPctOneWay * 2;
  const expectedMovePct = Math.abs(target - entry) / Math.max(1e-9, entry) * 100;
  const stopMovePct = Math.abs(entry - stop) / Math.max(1e-9, entry) * 100;
  const minMovePct = roundTripFeePct + execCostPctRoundTrip + (Number(cfg.edgeMinPct || 0) || 0);
  if (expectedMovePct < minMovePct){
    if (S.testMode || dec.score >= 8.5){
      log(`[PROFILE][SKIP_EDGE] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} move_pct=${expectedMovePct.toFixed(2)} min_pct=${minMovePct.toFixed(2)} fees_pct=${roundTripFeePct.toFixed(2)} exec_pct_rt=${execCostPctRoundTrip.toFixed(2)} edge_pct=${Number(cfg.edgeMinPct || 0).toFixed(2)}`);
    }
    return;
  }

  const minNetR = Number(cfg.minNetRTarget || 0);
  if (minNetR > 0){
    const netMovePct = expectedMovePct - roundTripFeePct - execCostPctRoundTrip;
    const netR = netMovePct / Math.max(1e-9, stopMovePct);
    if (netR < minNetR){
      log(`[GATE][NET_R] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} net_r=${netR.toFixed(2)} min_net_r=${minNetR.toFixed(2)}`);
      return;
    }
  }

  const edgeGate = evaluateEdgeGates(cfg);
  if (!edgeGate.ok){
    log(`[GATE][EDGE] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} reason=${edgeGate.reason}`);
    return;
  }

  const riskFrac = cfg.riskPctIsFraction ? Number(cfg.riskPct || 0) : (Number(cfg.riskPct || 0) / 100);
  const riskUsdEst = S.cash * riskFrac * riskMult;
  const qtyEst = riskUsdEst / Math.max(1e-9, Math.abs(entry - stop));
  const slipGate = evaluateSlippageKillSwitch(entry, qtyEst, cfg);
  if (!slipGate.ok){
    log(`[GATE][KILL_SWITCH] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} reason=${slipGate.reason}`);
    return;
  }

  const winUsd = Math.abs(target - entry) * qtyEst;
  const lossUsd = Math.abs(entry - stop) * qtyEst;
  const pWin = (S.wins + S.losses) >= 30 ? (S.wins / Math.max(1, S.wins + S.losses)) : 0.52;
  const avgWin = S.wins > 0 ? (S.grossWinUsd / Math.max(1, S.wins)) : winUsd;
  const avgLoss = S.losses > 0 ? (S.grossLossUsd / Math.max(1, S.losses)) : lossUsd;
  const feeRoundTripUsd = Math.abs(entry * qtyEst) * ((roundTripFeePct + execCostPctRoundTrip) / 100);
  const taxEstUsd = (cfg.taxOn ? Math.max(0, (pWin * avgWin - (1 - pWin) * avgLoss)) * (cfg.taxPct / 100) : 0);
  const evNetUsd = (pWin * avgWin) - ((1 - pWin) * avgLoss) - feeRoundTripUsd - taxEstUsd;
  if (evNetUsd <= 0){
    if (S.testMode || dec.score >= 8.5){
      log(`[PROFILE][SKIP_EV] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} ev_net_usd=${evNetUsd.toFixed(2)} pwin=${pWin.toFixed(2)} avg_win=${avgWin.toFixed(2)} avg_loss=${avgLoss.toFixed(2)} fees_exec_usd=${feeRoundTripUsd.toFixed(2)} tax_est_usd=${taxEstUsd.toFixed(2)}`);
    }
    return;
  }

  const idea = {
    signal: dec.signal,
    score: dec.score,
    symbol,
    interval: cfg.interval,
    entry,
    stop,
    target,
    atr: dec.atr,
    reasons: [
      ...dec.reasons,
      `RISKx=${riskMult.toFixed(2)}`,
      `CORRMAX=${corrGate.maxCorr == null ? 'NA' : corrGate.maxCorr.toFixed(2)}`,
      (dec.signal === 'BUY' && mtf) ? `MTF(${cfg.mtfConfirmInterval})=${mtf.bullRegime ? 'BULL' : 'NA'}` : 'MTF=NA'
    ],
    riskMult,
    klineCloseTs: currentKlineTs,
    fmtPx
  };

  log(`[AUDIT][ENTRY_CTX] run=${S.runId || '-'} preset=${runPreset} symbol=${symbol} side=${dec.signal} score=${dec.score.toFixed(2)} rr=${rr.toFixed(2)} ev_net_usd=${evNetUsd.toFixed(2)} move_pct=${expectedMovePct.toFixed(2)} min_move_pct=${minMovePct.toFixed(2)} fee_rt_pct=${roundTripFeePct.toFixed(2)} exec_rt_pct=${execCostPctRoundTrip.toFixed(2)} corr_max=${corrGate.maxCorr == null ? 'NA' : corrGate.maxCorr.toFixed(2)} mtf=${mtf ? cfg.mtfConfirmInterval : 'OFF'} mtf_trend=${mtf ? Number(mtf.trendStrength || 0).toFixed(4) : 'NA'} mtf_bull=${mtf?.bullRegime ? 1 : 0}`);

  const key = tradeKey(idea.signal, idea.symbol, idea.interval, idea.klineCloseTs);
  if (cfg.noRepeat && !canPassTradeGuard(key)) return;

  if (cfg.mode === 'AUTO'){
    openTradeFromIdea(idea, cfg, log, riskMult);
    markTradeGuard(key);
    S.tradesThisWeek = Number(S.tradesThisWeek || 0) + 1;
    S.dayTurnoverUsd = Number(S.dayTurnoverUsd || 0) + Math.abs(entry * qtyEst);
  } else {
    if (dec.score >= S.SCORE_AUTO_ON_ASK){
      openTradeFromIdea(idea, cfg, log, riskMult);
      markTradeGuard(key);
      S.tradesThisWeek = Number(S.tradesThisWeek || 0) + 1;
      S.dayTurnoverUsd = Number(S.dayTurnoverUsd || 0) + Math.abs(entry * qtyEst);
    } else {
      addPending(idea);
      markTradeGuard(key);
    }
  }

  if (cfg.cooldownCandles > 0){
    const barMs = intervalToMs(cfg.interval);
    S.cooldownBySymbol.set(symbol, currentKlineTs + cfg.cooldownCandles * barMs);
  }
}


async function tick(){
  if (S.ticking){
    S.tickSkipped = Number(S.tickSkipped || 0) + 1;
    return;
  }
  S.ticking = true;
  const t0 = Date.now();
  let cfg = null;
  try{
    cfg = getActiveCfg();

  // day anchor CASH
  const d = new Date();
  const dayKey = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  if (S._dayKey !== dayKey){
    S._dayKey = dayKey;
    S.dayAnchorCash = S.cash;
    S.dayPeakCash = S.cash;
    log(`Novo dia: anchor (cash) = ${fmtUSD(S.dayAnchorCash)}`);
  }
  S.dayPeakCash = Math.max(Number(S.dayPeakCash||S.cash), Number(S.cash||0));
  refreshWeeklyCounter();
  refreshTurnoverDay();
  refreshHighWatermarkCash();

  await refreshBestOfDayIfNeeded(cfg);

  const symbols = cfg.symbols.filter(Boolean);
  el.chipUniverse.textContent = `Universe: ${cfg.universeMode} · ${symbols.length} moedas`;
  el.chipBest.textContent = `Best-of-day: ${symbols.join(', ') || '—'}`;

  // Fetch/compute em paralelo com limite de concorrência (evita rate-limit)
  const limit = pLimit(cfg.fetchConcurrency || 5);
  await Promise.all(symbols.map(sym => limit(async () => {
    try{
      await tickSymbol(sym, cfg);
    } catch(e){
      log(`Erro tick ${sym}: ${e?.message || String(e)}`);
    }
  })));


  // DD lock by CASH
  const dd = ddPctCash();
  if (!S.locked && dd >= cfg.maxDailyDD){
    S.locked = true;
    S.lockType = 'DD';
    S.lockReason = `Daily DD ${dd.toFixed(2)}% >= limite ${cfg.maxDailyDD}%`;
    log(`[GATE][DAILY_DD] ${S.lockReason}`);
  }
  if (!S.locked && Number.isFinite(Number(cfg.maxDD))){
    const ddGlobal = getDrawdownFromHigh();
    if (ddGlobal >= Number(cfg.maxDD)){
      S.locked = true;
      S.lockType = 'DD';
      S.lockReason = `DD ${(ddGlobal * 100).toFixed(2)}% >= limite ${(Number(cfg.maxDD) * 100).toFixed(2)}%`;
      log(`[GATE][DD_BREAKER] ${S.lockReason}`);
    }
  }

  // Atualiza labels de tick apenas 1x por ciclo (evita reflows por símbolo)
  if (S.lastTickTs){
    const label = `Último tick: ${new Date(S.lastTickTs).toLocaleTimeString('pt-BR',{hour12:false})}`;
    el.tickLabel.textContent = label;
    el.lastTickSmall.textContent = label;
  }

  scheduleRepaint();
  } finally {
    S.ticking = false;
    const elapsedMs = Date.now() - t0;
    if (cfg && elapsedMs > (Number(cfg.loopSec || 0) * 1000)){
      log(`[AUDIT][TICK_SLOW] run=${S.runId || '-'} elapsed_ms=${elapsedMs} loop_ms=${Math.round(Number(cfg.loopSec || 0) * 1000)} skipped=${Number(S.tickSkipped || 0)}`);
    }
  }
}

function getProfitProtectionFactor(){
  const dayProfit = Math.max(0, Number(S.cash||0) - Number(S.dayAnchorCash||0));
  if (dayProfit <= 0) return 1;
  const giveback = Math.max(0, Number(S.dayPeakCash||0) - Number(S.cash||0));
  const ratio = giveback / Math.max(1e-9, dayProfit);
  if (ratio >= 0.35){
    return 0.5;
  }
  return 1;
}

// --------- repaint ----------
function repaint(){
  updateUI(el, getActiveCfg, {
    bestOfDayLabel
  });
  renderFocusDeck(el, getActiveCfg, {
    closeTradeByIdMarket,
    closeProfitOnlyMarket,
    closeAllOpenMarket,
    acceptPending,
    rejectPending
  });
}

// --------- controls ----------
function start(){
  if (S.running) return;
  refreshWeeklyCounter();
  refreshTurnoverDay();
  refreshHighWatermarkCash();

  if (S.pendingInitialCash != null && S.open.length === 0 && S.pending.length === 0){
    const pendingCash = Number(S.pendingInitialCash);
    if (Number.isFinite(pendingCash) && pendingCash > 0){
      S.initialCash = pendingCash;
      S.cash = pendingCash;
      S.dayAnchorCash = pendingCash;
      S.dayPeakCash = pendingCash;
      S.highWatermarkCash = pendingCash;
      S.pendingInitialCash = null;
      log(`Saldo inicial pendente aplicado no start: ${fmtUSD(pendingCash)}.`);
    }
  }

  S.runtimeCfg = getCfg();
  S.runningProfile = S.intervalPreset;
  S.runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  S.running = true;
  S.ticking = false;
  S.tickSkipped = 0;
  auditClient.start();

  // ✅ AUTO FOCUS ON START
  setFocus(true, 'Modo Foco: ON (auto ao ligar o robô)');

  const startSymbols = resolveRuntimeSymbols(S.runtimeCfg);
  log(`[AUDIT][RUN_START] run=${S.runId} mode=${S.runtimeCfg.mode} preset=${S.runningProfile || '-'} strategy=${S.runtimeCfg.selectedPresetId || 'NONE'} interval=${S.runtimeCfg.interval} symbols=${startSymbols.length} risk_pct=${normalizeRiskPctForDisplay(S.runtimeCfg).toFixed(2)} dd_limit_pct=${S.runtimeCfg.maxDailyDD.toFixed(2)} loop_sec=${S.runtimeCfg.loopSec}`);
  tick();
  S.timer = setInterval(tick, S.runtimeCfg.loopSec*1000);
  scheduleRepaint();
}

function stop(){
  if (!S.running) return;
  const presetAtStop = S.runningProfile;
  const cfgAtStop = S.runtimeCfg;
  S.running = false;
  if (S.timer) clearInterval(S.timer);
  S.timer = null;

  // ✅ AUTO FOCUS OFF ON STOP
  setFocus(false, 'Modo Foco: OFF (auto ao parar o robô)');

  log(`[AUDIT][RUN_STOP] run=${S.runId || '-'} preset=${presetAtStop || '-'} reason=manual_stop`);
  // Flush com a mesma cfg/endpoint do run ativo para evitar desvio por edição de UI.
  S.runtimeCfg = cfgAtStop;
  auditClient.flushNow();
  S.runtimeCfg = null;
  S.runningProfile = null;
  S.ticking = false;
  repaint();
}

function resetAll(){
  stop();
  const startCash = (S.pendingInitialCash != null) ? Number(S.pendingInitialCash) : readInitialCashInput();
  S.initialCash = startCash;
  S.pendingInitialCash = null;
  setInput('cfgInitialCash', startCash);
  S.cash = startCash;
  S.dayAnchorCash = startCash;
  S.grossWinUsd = 0;
  S.grossLossUsd = 0;
  S.realizedUsd = 0;
  S.feePaidUsd = 0;
  S.taxReservedUsd = 0;
  S.taxPaidUsd = 0;
  S.wins = 0;
  S.losses = 0;
  S.lossStreak = 0;
  S.netLossStreak = 0;
  S.highWatermarkCash = startCash;
  S.tradesWeekKey = null;
  S.tradesThisWeek = 0;
  S.turnoverDayKey = null;
  S.dayTurnoverUsd = 0;
  S.closedTradesNet = [];
  S.riskCutActive = false;
  S.riskCutRemainingTrades = 0;
  S.riskCutAnchorHighWatermark = null;
  S.killSwitchUntilTs = 0;
  S.killSwitchReason = '';
  S.lastRollingExpectancyUsd = null;
  S.lastRollingWinRate = null;

  S.locked = false;
  S.lockReason = '';
  S.lockType = null;

  S.pending = [];
  S.open = [];

  S.lastSymbol = null;
  S.lastPrice = null;
  S.lastSignal = '—';
  S.lastScore = 0;
  S.lastReasons = [];

  S._dayKey = null;
  S.dayPeakCash = startCash;
  S.runId = null;

  S.tradeGuard.clear();
  S.cooldownBySymbol.clear();
  S.mtfCache.clear();
  S.retCache.clear();
  S.ticking = false;
  S.tickSkipped = 0;

  el.logs.innerHTML = '';
  log(`Reset geral completo. Saldo inicial: ${fmtUSD(startCash)}.`);
  auditClient.flushNow();
  repaint();
}

function unlockAllSafety(){
  const prevType = S.lockType || (S.locked ? 'UNKNOWN' : null);
  S.locked = false;
  S.lockType = null;
  S.lossStreak = 0;
  S.netLossStreak = 0;
  S.riskCutActive = false;
  S.riskCutRemainingTrades = 0;
  S.riskCutAnchorHighWatermark = null;
  S.killSwitchUntilTs = 0;
  S.killSwitchReason = '';
  S.lockReason = '';
  S.dayAnchorCash = S.cash;
  log(`Desbloqueio manual (${prevType || 'SEM_BLOQUEIO'}): loss streak zerado e novo anchor (cash) = ${fmtUSD(S.dayAnchorCash)}`);
  repaint();
}

function toggleTestMode(){
  S.testMode = !S.testMode;
  log(`Modo Teste: ${S.testMode ? 'ON' : 'OFF'}`);
  repaint();
}

// (removido) toggleCollapse: não existe botão de minimizar/maximizar controles

function toggleFocus(){
  setFocus(!S.focus, `Modo Foco: ${!S.focus ? 'ON' : 'OFF'}`);
  repaint();
}

// --------- binds ----------
if (el.btnStart) el.btnStart.addEventListener('click', start);
if (el.btnStop) el.btnStop.addEventListener('click', stop);
if (el.btnOnce) el.btnOnce.addEventListener('click', tick);
if (el.btnReset) el.btnReset.addEventListener('click', resetAll);
if (el.btnUnlock) el.btnUnlock.addEventListener('click', unlockAllSafety);
if (el.btnTestMode) el.btnTestMode.addEventListener('click', toggleTestMode);
if (el.btnFocus) el.btnFocus.addEventListener('click', toggleFocus);
const cfgInitialCash = document.getElementById('cfgInitialCash');
if (cfgInitialCash){
  cfgInitialCash.addEventListener('change', () => applyInitialCashInput(false));
}
const cfgStrategyPreset = document.getElementById('cfgStrategyPreset');
if (cfgStrategyPreset){
  cfgStrategyPreset.addEventListener('change', (ev) => {
    applySelectedPresetId(String(ev?.target?.value || 'NONE'));
  });
}
// duplicated core controls inside Focus Widgets
// Focus Widgets: NÃO use listeners diretos aqui.
// Motivo: os botões do Focus Deck podem ser re-renderizados (IDs iguais reaparecem)
// e, além disso, já temos delegação abaixo. Listeners diretos + delegação
// geram duplo disparo (ex.: Modo Teste liga e desliga no mesmo clique).

// Fallback (delegação): se o painel do Modo Foco for re-renderizado/recriado,
// os listeners diretos podem se perder. Este handler garante que os botões
// principais do Focus Widgets continuem funcionando e sincronizados.
document.addEventListener('click', (ev) => {
  const btn = ev.target?.closest?.('button');
  if (!btn || !btn.id) return;
  switch (btn.id) {
    case 'btnFocusStart': start(); break;
    case 'btnFocusStop': stop(); break;
    case 'btnFocusOnce': tick(); break;
    case 'btnFocusReset': resetAll(); break;
    case 'btnFocusTestMode': toggleTestMode(); break;
    default: return;
  }
});

// (removido) botão de minimizar/maximizar controles

// Focus Deck tabs (só no modo foco)
if (el.focusTabs){
  el.focusTabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-tab]');
    if (!btn) return;
    const tab = btn.getAttribute('data-tab') || 'TRADES';
    S.focusTab = tab;
    el.focusTabs.querySelectorAll('button').forEach(b=>b.classList.toggle('active', b === btn));
    renderFocusDeck(el, getActiveCfg, {
      closeTradeByIdMarket,
      closeProfitOnlyMarket,
      closeAllOpenMarket,
      acceptPending,
      rejectPending
    });
  });
}

if (el.btnCloseAll) el.btnCloseAll.addEventListener('click', closeAllOpenMarket);
if (el.btnCloseProfit) el.btnCloseProfit.addEventListener('click', closeProfitOnlyMarket);

// focus panel buttons were removed from the wallet; guard bindings
if (el.btnFocusCloseProfit) el.btnFocusCloseProfit.addEventListener('click', closeProfitOnlyMarket);
if (el.btnFocusCloseLoss) el.btnFocusCloseLoss.addEventListener('click', closeLossOnlyMarket);
if (el.btnFocusCloseAll) el.btnFocusCloseAll.addEventListener('click', closeAllOpenMarket);
if (el.btnFocusUnlockDD) el.btnFocusUnlockDD.addEventListener('click', unlockAllSafety);
if (el.btnFocusOff) el.btnFocusOff.addEventListener('click', () => setFocus(false, 'Modo Foco: OFF (painel foco)'));

// header toggle inside Focus Deck
if (el.btnFocusHeader) el.btnFocusHeader.addEventListener('click', () => setFocus(!S.focus, 'Toggle from focus header'));
window.addEventListener('beforeunload', () => { auditClient.flushNow(); });

if (el.profileSeg){
  el.profileSeg.querySelectorAll('button[data-intpreset]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
  });
}
document.addEventListener('click', (ev) => {
  const btn = ev.target?.closest?.('#profileSeg button[data-intpreset]');
  if (!btn) return;
  const preset = btn.getAttribute('data-intpreset');
  if (preset) applyIntervalPreset(preset);
});
document.addEventListener('click', (ev) => {
  const btn = ev.target?.closest?.('#presetCompare button[data-intpreset]');
  if (!btn) return;
  const preset = btn.getAttribute('data-intpreset');
  if (preset) applyIntervalPreset(preset);
});

// init
fillSymbols();
S.selectedPresetId = loadSelectedPresetId();
S.selectedPresetName = S.selectedPresetId === 'NONE' ? 'Sem preset extra' : (PRESETS[S.selectedPresetId]?.name || 'Sem preset extra');
initStrategyPresetSelector();
setInput('cfgInitialCash', Number(S.initialCash || 100));
applyParamTooltips();
applyIntervalPreset(S.intervalPreset || '5m', true);
applySelectedPresetId(S.selectedPresetId, true);
log('App pronto. Clique em "Ligar Robô" ou "Rodar 1x".');
// ensure header toggle reflects current state on load
setFocus(S.focus, 'init: sync focus button');
repaint();

// console helpers
window.guardian = {
  tick,
  applyPreset: (k) => applyIntervalPreset(k),
  applyStrategyPreset: (k) => applySelectedPresetId(k),
  listStrategyPresets: () => Object.keys(PRESETS),
  getCfg,
  setFocus,
  refreshBest: async () => { await refreshBestOfDayIfNeeded(getCfg(), true); repaint(); },
  getState: () => JSON.parse(JSON.stringify({
    running:S.running,
    preset:S.intervalPreset,
    cash:S.cash,
    dayAnchorCash:S.dayAnchorCash,
    wins:S.wins,
    losses:S.losses,
    open:S.open.length,
    pending:S.pending.length,
    locked:S.locked,
    lockReason:S.lockReason,
    bestTop: S.bestOfDay.slice(0,10)
  })),
};

