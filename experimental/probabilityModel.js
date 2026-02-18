import { buildAtrSeries, detectRegime } from './momentumModel.js';

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

function triggerAtIndex(data, atrSeries, i){
  const sub = {
    c: data.c.slice(0, i + 1),
    h: data.h.slice(0, i + 1),
    l: data.l.slice(0, i + 1)
  };
  const regimeInfo = detectRegime(sub, { slopeLookback: 80 });
  const regime = regimeInfo.regime;

  const atrNow = Number(atrSeries[i] || 0);
  const atrMean20 = meanLast(atrSeries, 20, i);
  const atrExp = atrNow > atrMean20;

  const volNow = Number(data.v[i] || 0);
  const volMean20 = meanLast(data.v, 20, i);
  const volExp = volNow > volMean20;

  const breakoutHigh = Math.max(...data.h.slice(Math.max(0, i - 11), i + 1));
  const breakout = Number(data.h[i] || 0) >= Number(breakoutHigh || 0);
  const breakoutFlag = breakout && ((atrExp ? 1 : 0) + (volExp ? 1 : 0) >= 1);

  return { regime, breakoutFlag, atrExp, volExp, atrNow };
}

function estimateProb2R(data){
  const n = data.c.length - 1;
  if (n < 320) return { prob: null, occurrences: 0, wins: 0 };

  const atrSeries = buildAtrSeries(data.h, data.l, data.c, 14);
  let occurrences = 0;
  let wins = 0;

  for (let i = 220; i <= n - 50; i++){
    const t = triggerAtIndex(data, atrSeries, i);
    if (!(t.regime === 'BULL' && t.breakoutFlag)) continue;
    occurrences += 1;

    const entry = Number(data.c[i] || 0);
    const stopDist = Math.max(1.2 * Number(t.atrNow || 0), 0.001 * entry);
    const stop = entry - stopDist;
    const tp = entry + (2 * stopDist);

    let reachedTp = false;
    for (let j = i + 1; j <= Math.min(n, i + 50); j++){
      const c = Number(data.c[j] || 0);
      if (c >= tp){
        reachedTp = true;
        break;
      }
      if (c <= stop){
        reachedTp = false;
        break;
      }
    }
    if (reachedTp) wins += 1;
  }

  if (occurrences < 20) return { prob: null, occurrences, wins };
  return { prob: wins / occurrences, occurrences, wins };
}

export function buildProbabilityDecision(symbol, data){
  const closes = data?.c || [];
  const n = closes.length - 1;
  if (n < 320){
    return { model: 'PROBABILITY', symbol, signal: 'HOLD', probability: null, reason: 'INSUFFICIENT_DATA' };
  }

  const atrSeries = buildAtrSeries(data.h, data.l, data.c, 14);
  const now = triggerAtIndex(data, atrSeries, n);
  const est = estimateProb2R(data);

  let reason = 'PROBABILITY_BLOCK';
  let signal = 'HOLD';
  if (now.regime !== 'BULL') reason = 'REGIME_NOT_BULL';
  else if (!now.breakoutFlag) reason = 'BREAKOUT_FAIL';
  else if (est.prob == null) reason = 'PROB_INSUFFICIENT_OCCURRENCES';
  else if (est.prob < 0.55) reason = 'PROB_BELOW_55';
  else {
    reason = 'PROBABILITY_EDGE';
    signal = 'BUY';
  }

  return {
    model: 'PROBABILITY',
    symbol,
    signal,
    probability: est.prob,
    regime: now.regime,
    regimeBull: now.regime === 'BULL',
    breakoutFlag: now.breakoutFlag,
    atrExp: now.atrExp,
    volExp: now.volExp,
    sampleSize: est.occurrences,
    wins2R: est.wins,
    prob2R: est.prob,
    reason
  };
}
