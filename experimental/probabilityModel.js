import { buildAtrSeries, breakoutSignal, detectRegime } from './momentumModel.js';
import { DEFAULT_EXPERIMENTAL_CFG, mergeExperimentalCfg } from './experimentalConfig.js';

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

function triggerAtIndex(data, atrSeries, i, cfg){
  const sub = {
    c: data.c.slice(0, i + 1),
    h: data.h.slice(0, i + 1),
    l: data.l.slice(0, i + 1),
    v: data.v.slice(0, i + 1)
  };
  const regimeInfo = detectRegime(sub, cfg);
  const regime = regimeInfo.regime;
  const bo = breakoutSignal(sub, cfg);
  const atrNow = Number(atrSeries[i] || bo.atrNow || 0);
  return { regime, breakoutFlag: bo.breakout, atrExp: bo.atrExp, volExp: bo.volExp, atrNow };
}

function estimateProb2R(data, cfg){
  const k = mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, cfg);
  const n = data.c.length - 1;
  if (n < 320) return { prob: null, occurrences: 0, wins: 0 };

  const atrSeries = buildAtrSeries(data.h, data.l, data.c, 14);
  let occurrences = 0;
  let wins = 0;

  const lookAhead = Math.max(10, Number(k.probLookAhead || 50));
  const probRR = Math.max(1, Number(k.probRR || 2.0));
  const stopMinPct = Math.max(0, Number(k.stopMinPct || 0.001));
  const stopAtrMult = Math.max(0.5, Number(k.stopAtrMult || 1.8));
  for (let i = 220; i <= n - lookAhead - 1; i++){
    const t = triggerAtIndex(data, atrSeries, i, k);
    if (t.regime === 'CHOP' || !t.breakoutFlag) continue;
    occurrences += 1;

    const entry = Number(data.c[i] || 0);
    const stopDist = Math.max(stopAtrMult * Number(t.atrNow || 0), stopMinPct * entry);
    const stop = entry - stopDist;
    const tp = entry + (probRR * stopDist);

    let reachedTp = false;
    for (let j = i + 1; j <= Math.min(n, i + lookAhead); j++){
      const hj = Number(data.h[j] || data.c[j] || 0);
      const lj = Number(data.l[j] || data.c[j] || 0);
      if (hj >= tp){
        reachedTp = true;
        break;
      }
      if (lj <= stop){
        reachedTp = false;
        break;
      }
    }
    if (reachedTp) wins += 1;
  }

  if (occurrences < Number(k.probMinOcc || 30)) return { prob: null, occurrences, wins };
  return { prob: wins / occurrences, occurrences, wins };
}

export function buildProbabilityDecision(symbol, data, cfg = {}, opts = {}){
  const k = mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, cfg);
  const noGates = Boolean(opts?.noGates);
  const fastMode = Boolean(opts?.fastMode);
  const closes = data?.c || [];
  const n = closes.length - 1;
  if (fastMode){
    return {
      model: 'PROBABILITY',
      symbol,
      signal: noGates ? 'BUY' : 'HOLD',
      probability: null,
      prob2R: null,
      occ: null,
      succ: null,
      sampleSize: null,
      wins2R: null,
      reason: noGates ? 'NO_GATES_TEST_MODE' : 'FAST_MODE_DISABLED'
    };
  }
  if (n < 320){
    if (noGates){
      return { model: 'PROBABILITY', symbol, signal: 'BUY', probability: null, prob2R: null, occ: null, succ: null, reason: 'NO_GATES_TEST_MODE' };
    }
    return { model: 'PROBABILITY', symbol, signal: 'HOLD', probability: null, reason: 'INSUFFICIENT_DATA' };
  }

  const atrSeries = buildAtrSeries(data.h, data.l, data.c, 14);
  const now = triggerAtIndex(data, atrSeries, n, k);
  const est = estimateProb2R(data, k);

  let reason = 'PROBABILITY_BLOCK';
  let signal = 'HOLD';
  if (noGates){
    reason = 'NO_GATES_TEST_MODE';
    signal = 'BUY';
  } else if (now.regime === 'CHOP') reason = 'REGIME_CHOP';
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
    regimeBull: now.regime !== 'CHOP',
    breakoutFlag: now.breakoutFlag,
    atrExp: now.atrExp,
    volExp: now.volExp,
    sampleSize: est.occurrences,
    wins2R: est.wins,
    occ: est.occurrences,
    succ: est.wins,
    prob2R: est.prob,
    reason
  };
}
