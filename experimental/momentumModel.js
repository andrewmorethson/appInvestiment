import { SMA } from '../js/indicators.js';

function pctChange(a, b){
  const x = Number(a || 0);
  const y = Number(b || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0) return 0;
  return (y - x) / x;
}

function buildAtrSeries(highs, lows, closes, period = 14){
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

export function buildMomentumDecision(symbol, data, localState){
  const closes = data?.c || [];
  const highs = data?.h || [];
  const lows = data?.l || [];
  const volumes = data?.v || [];
  const n = closes.length - 1;
  if (n < 220){
    return {
      model: 'MOMENTUM',
      symbol,
      signal: 'HOLD',
      reason: 'INSUFFICIENT_DATA',
      score: 0
    };
  }

  const price = Number(closes[n] || 0);
  const ma200 = SMA(closes, 200);
  const volMA20 = SMA(volumes, 20);
  const m200 = Number(ma200[n] || 0);
  const m200Prev = Number(ma200[Math.max(0, n - 5)] || 0);
  const slope = m200 - m200Prev;
  const regimeBull = price > m200 && slope > 0;

  const atrSeries = buildAtrSeries(highs, lows, closes, 14);
  const atrNow = Number(atrSeries[n] || 0);
  let atrAvg20 = 0;
  let atrCount = 0;
  for (let i = Math.max(0, n - 19); i <= n; i++){
    const v = Number(atrSeries[i]);
    if (Number.isFinite(v) && v > 0){
      atrAvg20 += v;
      atrCount += 1;
    }
  }
  atrAvg20 = atrCount ? (atrAvg20 / atrCount) : atrNow;
  const atrExp = atrNow > atrAvg20;

  const lookbackBreakout = highs.slice(Math.max(0, n - 20), n);
  const prevHigh = lookbackBreakout.length ? Math.max(...lookbackBreakout) : Number(highs[n - 1] || 0);
  const breakoutFlag = price > prevHigh;

  const volNow = Number(volumes[n] || 0);
  const volAvg = Number(volMA20[n] || volNow || 1);
  const volumeExp = volNow > (volAvg * 1.2);

  const mom30 = pctChange(closes[Math.max(0, n - 30)], price);
  const mom14 = pctChange(closes[Math.max(0, n - 14)], price);
  const mom7 = pctChange(closes[Math.max(0, n - 7)], price);
  const momentumScore = (mom30 * 0.5) + (mom14 * 0.3) + (mom7 * 0.2);

  const rollingNetExpectancy = Number(localState?.edgeEngine?.rollingExpectancy?.() ?? 0);
  const edgeGate = rollingNetExpectancy > 0 || (localState?.edgeEngine?.samples?.length || 0) < 10;

  let score = 0;
  if (regimeBull) score += 30;
  if (breakoutFlag) score += 25;
  if (atrExp) score += 15;
  if (volumeExp) score += 10;
  score += Math.max(0, Math.min(20, momentumScore * 400));

  const signal = (regimeBull && breakoutFlag && atrExp && volumeExp && edgeGate && momentumScore > 0) ? 'BUY' : 'HOLD';
  const confidence = Math.max(0, Math.min(1, score / 100));

  return {
    model: 'MOMENTUM',
    symbol,
    signal,
    score,
    confidence,
    regime: regimeBull ? 'BULL' : 'NON_BULL',
    regimeBull,
    breakoutFlag,
    atrExp,
    volumeExp,
    momentumScore,
    rollingNetExpectancy,
    atr: atrNow,
    slope200: slope,
    reason: signal === 'BUY' ? 'MOMENTUM_SETUP' : 'FILTER_BLOCK'
  };
}

