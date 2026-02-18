import { SMA } from '../js/indicators.js';

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

export function buildProbabilityDecision(symbol, data, history){
  const closes = data?.c || [];
  const highs = data?.h || [];
  const lows = data?.l || [];
  const n = closes.length - 1;
  if (n < 220){
    return { model: 'PROBABILITY', symbol, signal: 'HOLD', probability: 0, reason: 'INSUFFICIENT_DATA' };
  }

  const ma200 = SMA(closes, 200);
  const m200 = Number(ma200[n] || 0);
  const m200Prev = Number(ma200[Math.max(0, n - 5)] || 0);
  const regimeBull = Number(closes[n] || 0) > m200 && m200 > m200Prev;

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

  const prevHigh = Math.max(...highs.slice(Math.max(0, n - 20), n));
  const breakoutFlag = Number(closes[n] || 0) > Number(prevHigh || 0);

  const hist = Array.isArray(history) ? history : [];
  const cond = hist.filter((t) => t?.regimeBull && t?.breakoutFlag && t?.atrExp);
  const wins = cond.filter((t) => Number(t?.netR || 0) >= 2).length;
  const total = cond.length;
  const probability = (wins + 1) / (total + 2); // Laplace smoothing

  const signal = (regimeBull && breakoutFlag && atrExp && probability > 0.55) ? 'BUY' : 'HOLD';

  return {
    model: 'PROBABILITY',
    symbol,
    signal,
    probability,
    regimeBull,
    breakoutFlag,
    atrExp,
    sampleSize: total,
    reason: signal === 'BUY' ? 'PROBABILITY_EDGE' : 'PROBABILITY_BLOCK'
  };
}

