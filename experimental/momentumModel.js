import { SMA } from '../js/indicators.js';

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
  const closes = data?.c || [];
  const highs = data?.h || [];
  const lows = data?.l || [];
  const n = closes.length - 1;
  const slopeLookback = Math.max(10, Number(cfg.slopeLookback || 80));
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
  if (Math.abs(slopeNorm) < 0.15) regime = 'CHOP';
  else if (price > mNow && slopeNorm > 0.15) regime = 'BULL';

  return { regime, slopeNorm, ma200: mNow, atr: atrNow, slopeLookback };
}

export function buildMomentumDecision(symbol, data, localState){
  const closes = data?.c || [];
  const highs = data?.h || [];
  const lows = data?.l || [];
  const volumes = data?.v || [];
  const n = closes.length - 1;
  if (n < 320){
    return { model: 'MOMENTUM', symbol, signal: 'HOLD', reason: 'INSUFFICIENT_DATA', score: 0 };
  }

  const regimeInfo = detectRegime(data, { slopeLookback: 80 });
  const regime = regimeInfo.regime;
  const slopeNorm = Number(regimeInfo.slopeNorm || 0);

  const atrSeries = buildAtrSeries(highs, lows, closes, 14);
  const atrNow = Number(atrSeries[n] || 0);
  const atrMean20 = meanLast(atrSeries, 20, n);
  const atrExp = atrNow > atrMean20;

  const volNow = Number(volumes[n] || 0);
  const volMean20 = meanLast(volumes, 20, n);
  const volExp = volNow > volMean20;

  const breakoutHigh = Math.max(...highs.slice(Math.max(0, n - 11), n + 1));
  const breakout = Number(highs[n] || 0) >= Number(breakoutHigh || 0);
  const expansionsCount = Number(atrExp ? 1 : 0) + Number(volExp ? 1 : 0);
  const breakoutPass = breakout && expansionsCount >= 1;

  const momentumScore = calculateMomentumScore(closes);

  const edgeEngine = localState?.edgeEngine;
  const cfg = localState?.cfg || {};
  const edgeMinTrades = Math.max(1, Number(cfg.edgeMinTrades || 30));
  const tradesCount = Number(edgeEngine?.tradesCount || 0);
  const rollingNetExpectancy = Number(edgeEngine?.rollingExpectancy?.() ?? 0);
  const edgeOk = (tradesCount < edgeMinTrades) || (rollingNetExpectancy > 0);

  let score = 0;
  if (regime === 'BULL') score += 35;
  if (breakout) score += 20;
  if (atrExp) score += 10;
  if (volExp) score += 10;
  if (momentumScore != null){
    score += Math.max(0, Math.min(25, momentumScore * 350));
  }
  score += edgeOk ? 5 : 0;

  let blockReason = 'NONE';
  if (regime === 'CHOP') blockReason = 'REGIME_CHOP';
  else if (regime !== 'BULL') blockReason = 'REGIME_NON_BULL';
  else if (!breakoutPass) blockReason = 'BREAKOUT_2OF3_FAIL';
  else if (!edgeOk) blockReason = 'EDGE_NEGATIVE';
  else if (momentumScore == null) blockReason = 'MOMENTUM_NA';
  else if (momentumScore <= 0) blockReason = 'MOMENTUM_WEAK';

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
    breakoutFlag: breakoutPass,
    breakout,
    atrExp,
    volExp,
    momentumScore,
    rollingNetExpectancy,
    edgeTradesCount: tradesCount,
    edgeMinTrades,
    edgeOk,
    atr: atrNow,
    reason: signal === 'BUY' ? 'MOMENTUM_SETUP' : blockReason
  };
}
