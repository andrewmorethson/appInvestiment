import { buildDecision } from '../js/engine.js';
import { buildMomentumDecision } from './momentumModel.js';
import { buildProbabilityDecision } from './probabilityModel.js';

function scoreToConfidence(scoreDecision){
  if (!scoreDecision) return 0;
  if (scoreDecision.signal !== 'BUY') return 0;
  return Math.max(0, Math.min(1, Number(scoreDecision.score || 0) / 10));
}

function pickBest(scoreDecision, momentumDecision, probDecision){
  const scoreConf = scoreToConfidence(scoreDecision);
  const momConf = momentumDecision.signal === 'BUY' ? Number(momentumDecision.confidence || 0) : 0;
  const probConf = probDecision.signal === 'BUY' ? Number(probDecision.probability || 0) : 0;
  const ranked = [
    { name: 'Score Model', conf: scoreConf },
    { name: 'Momentum Model', conf: momConf },
    { name: 'Prob Model', conf: probConf }
  ].sort((a, b) => b.conf - a.conf);
  if (ranked[0].conf <= 0) return 'Nenhum';
  return ranked[0].name;
}

export function compareModels(symbol, data, localState){
  const cfg = localState?.cfg || {};
  const scoreDecision = buildDecision(data, { atrPeriod: 14 });
  const probDecision = buildProbabilityDecision(symbol, data, cfg);
  const momentumDecision = buildMomentumDecision(symbol, data, localState, probDecision);
  const best = pickBest(scoreDecision, momentumDecision, probDecision);
  return {
    symbol,
    scoreDecision,
    momentumDecision,
    probDecision,
    best
  };
}
