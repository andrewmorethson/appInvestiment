import { SMA } from '../js/indicators.js';
import { DEFAULT_EXPERIMENTAL_CFG, mergeExperimentalCfg } from './experimentalConfig.js';

function pctChange(a, b){
  const x = Number(a || 0);
  const y = Number(b || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0) return 0;
  return (y - x) / x;
}

export function calculateMomentumScore(closes){
  const n = (closes?.length || 0) - 1;
  if (n < 60) return null;
  const price = Number(closes[n] || 0);
  const mom30 = pctChange(closes[Math.max(0, n - 30)], price);
  const mom14 = pctChange(closes[Math.max(0, n - 14)], price);
  const mom7 = pctChange(closes[Math.max(0, n - 7)], price);
  return (mom30 * 0.5) + (mom14 * 0.3) + (mom7 * 0.2);
}

export function buildAtrSeries(highs, lows, closes, period = 14){
  const p = Math.max(2, Number(period || 14));
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

function meanLast(arr, n, endIdx){
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, endIdx - n + 1); i <= endIdx; i++){
    const v = Number(arr[i]);
    if (Number.isFinite(v)){
      sum += v;
      count += 1;
    }
  }
  return count ? (sum / count) : 0;
}

export function detectRegime(data, cfg = {}){
  const k = mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, cfg);
  const closes = data?.c || [];
  const highs = data?.h || [];
  const lows = data?.l || [];
  const n = closes.length - 1;
  const slopeLookback = Math.max(10, Number(k.slopeLookback || 80));
  if (n < Math.max(200 + slopeLookback, 220)){
    return { regime: 'CHOP', slopeNorm: 0, ma200: null, atr: null };
  }

  const ma200 = SMA(closes, 200);
  const atrSeries = buildAtrSeries(highs, lows, closes, 14);
  const mNow = Number(ma200[n] || 0);
  const mPrev = Number(ma200[n - slopeLookback] || mNow);
  const atrNow = Math.max(1e-9, Number(atrSeries[n] || 0));
  const slope = mNow - mPrev;
  const slopeNorm = slope / atrNow;
  const price = Number(closes[n] || 0);

  let regime = 'NON_BULL';
  if (Math.abs(slopeNorm) < Number(k.chopSlopeNorm || 0.05)) regime = 'CHOP';
  else if (price > mNow && slopeNorm > Number(k.bullSlopeNorm || 0.10)) regime = 'BULL';

  return { regime, slopeNorm, ma200: mNow, atr: atrNow, slopeLookback };
}

export function breakoutSignal(data, cfg = {}){
  const k = mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, cfg);
  const closes = data?.c || [];
  const highs = data?.h || [];
  const lows = data?.l || [];
  const volumes = data?.v || [];
  const n = closes.length - 1;
  if (n < 60){
    return { breakout: false, atrExp: false, volExp: false, expCount: 0, atrNow: null };
  }
  const atrSeries = buildAtrSeries(highs, lows, closes, 14);
  const atrNow = Number(atrSeries[n] || 0);
  const atrMean20 = meanLast(atrSeries, 20, n);
  const atrExp = atrNow > atrMean20;
  const volNow = Number(volumes[n] || 0);
  const volMean20 = meanLast(volumes, 20, n);
  const volExp = volNow > volMean20;
  const lookback = Math.max(5, Number(k.breakoutLookback || 12));
  const start = Math.max(0, n - lookback);
  const priorWindow = highs.slice(start, n);
  const breakoutHigh = priorWindow.length ? Math.max(...priorWindow.map(Number)) : Number(highs[n] || 0);
  const breakout = Number(highs[n] || 0) >= Number(breakoutHigh || 0);
  const expansionsCount = Number(atrExp ? 1 : 0) + Number(volExp ? 1 : 0);
  const breakoutPass = breakout && expansionsCount >= 1;
  return { breakout: breakoutPass, atrExp, volExp, expCount: expansionsCount, atrNow };
}

export function nearBreakout(data, lookback = 12, nearPct = 0.002){
  const highs = data?.h || [];
  const n = highs.length - 1;
  if (n < 1){
    return { nearBreakout: false, distToBreakoutPct: 1, maxHigh: null, highNow: null };
  }
  const lb = Math.max(2, Number(lookback || 12));
  const start = Math.max(0, n - (lb - 1));
  const window = highs.slice(start, n + 1).map(Number);
  const maxHigh = window.length ? Math.max(...window) : Number(highs[n] || 0);
  const highNow = Number(highs[n] || 0);
  if (!Number.isFinite(maxHigh) || maxHigh <= 0){
    return { nearBreakout: false, distToBreakoutPct: 1, maxHigh: null, highNow };
  }
  const distToBreakoutPct = Math.max(0, (maxHigh - highNow) / maxHigh);
  const nearBreakoutFlag = highNow >= (maxHigh * (1 - Math.max(0, Number(nearPct || 0.002))));
  return { nearBreakout: nearBreakoutFlag, distToBreakoutPct, maxHigh, highNow };
}

export function scanRank(rows){
  return [...(rows || [])].sort((a, b) => {
    const da = Number.isFinite(Number(a?.distToBreakoutPct)) ? Number(a.distToBreakoutPct) : Number.POSITIVE_INFINITY;
    const db = Number.isFinite(Number(b?.distToBreakoutPct)) ? Number(b.distToBreakoutPct) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    const am = Number.isFinite(Number(a?.momentumScore)) ? Number(a.momentumScore) : Number.NEGATIVE_INFINITY;
    const bm = Number.isFinite(Number(b?.momentumScore)) ? Number(b.momentumScore) : Number.NEGATIVE_INFINITY;
    return bm - am;
  });
}

export function buildMomentumDecision(symbol, data, localState, probDecision = null){
  const k = mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, localState?.cfg || {});
  const closes = data?.c || [];
  const n = closes.length - 1;
  if (n < 320){
    return { model: 'MOMENTUM', symbol, signal: 'HOLD', reason: 'INSUFFICIENT_DATA', score: 0 };
  }

  const regimeInfo = detectRegime(data, k);
  const regime = regimeInfo.regime;
  const slopeNorm = Number(regimeInfo.slopeNorm || 0);
  const bo = breakoutSignal(data, k);

  const momentumScore = calculateMomentumScore(closes);

  const edgeEngine = localState?.edgeEngine;
  const cfg = localState?.cfg || {};
  const edgeMinTrades = Math.max(1, Number(cfg.edgeMinTrades || 30));
  const tradesCount = Number(edgeEngine?.tradesCount || 0);
  const rollingNetExpectancy = Number(edgeEngine?.rollingExpectancy?.() ?? 0);
  const edgeOk = (tradesCount < edgeMinTrades) || (rollingNetExpectancy > 0);

  const prob2R = probDecision?.prob2R ?? probDecision?.probability ?? null;
  const probOk = (prob2R != null) && Number(prob2R) >= 0.55;

  let score = 0;
  if (regime === 'BULL') score += 35;
  if (bo.breakout) score += 20;
  if (bo.atrExp) score += 10;
  if (bo.volExp) score += 10;
  if (momentumScore != null){
    score += Math.max(0, Math.min(25, momentumScore * 350));
  }
  score += edgeOk ? 5 : 0;
  if (regime === 'NON_BULL' && probOk) score += 5;

  let blockReason = 'NONE';
  if (regime === 'CHOP') blockReason = 'REGIME_CHOP';
  else if (!bo.breakout) blockReason = 'BREAKOUT_2OF3_FAIL';
  else if (!edgeOk) blockReason = 'EDGE_NEGATIVE';
  else if (momentumScore == null) blockReason = 'MOMENTUM_NA';
  else if (momentumScore < Number(k.minMomentum || 0.001)) blockReason = 'MOMENTUM_WEAK';
  else if (regime === 'NON_BULL' && !probOk) blockReason = 'NON_BULL_REQUIRES_PROB';

  const signal = blockReason === 'NONE' ? 'BUY' : 'HOLD';

  return {
    model: 'MOMENTUM',
    symbol,
    signal,
    score,
    confidence: Math.max(0, Math.min(1, score / 100)),
    regime,
    regimeBull: regime === 'BULL',
    slopeNorm,
    breakoutFlag: bo.breakout,
    breakout: bo.breakout,
    atrExp: bo.atrExp,
    volExp: bo.volExp,
    expCount: bo.expCount,
    momentumScore,
    prob2R,
    probOk,
    rollingNetExpectancy,
    edgeTradesCount: tradesCount,
    edgeMinTrades,
    edgeOk,
    atr: bo.atrNow,
    reason: signal === 'BUY' ? 'MOMENTUM_SETUP' : blockReason
  };
}
