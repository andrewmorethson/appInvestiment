import { runBacktest } from './visualBacktest.js';
import { DEFAULT_EXPERIMENTAL_CFG, mergeExperimentalCfg } from './experimentalConfig.js';

function cartesian(grid){
  const keys = Object.keys(grid || {});
  const out = [];
  const walk = (idx, cur) => {
    if (idx >= keys.length){
      out.push({ ...cur });
      return;
    }
    const k = keys[idx];
    const vals = Array.isArray(grid[k]) ? grid[k] : [grid[k]];
    for (const v of vals){
      cur[k] = v;
      walk(idx + 1, cur);
    }
  };
  walk(0, {});
  return out;
}

export function defaultGrid(){
  return {
    stopAtrMult: [1.2, 1.5, 1.8, 2.1],
    rTarget: [2.0, 2.5, 3.0],
    breakoutLookback: [10, 12, 15],
    chopSlopeNorm: [0.03, 0.05, 0.08],
    bullSlopeNorm: [0.08, 0.10, 0.12]
  };
}

export function runGridSearch(symbol, data, grid, modelType, opts = {}){
  const combos = cartesian(grid || defaultGrid());
  const results = [];
  const edgeEngineFactory = opts?.edgeEngineFactory || (() => null);

  for (const params of combos){
    const cfg = mergeExperimentalCfg(DEFAULT_EXPERIMENTAL_CFG, params);
    const run = runBacktest(symbol, modelType || 'momentum', data, {
      cfg,
      edgeEngine: edgeEngineFactory()
    });
    const rejected = (run.trades < 6) || (run.maxDD > 0.12);
    results.push({
      params,
      trades: Number(run.trades || 0),
      netProfit: Number(run.netProfit || 0),
      expectancy: Number(run.expectancy || 0),
      maxDD: Number(run.maxDD || 0),
      rejected
    });
  }

  const valid = results.filter((r) => !r.rejected).sort((a, b) => {
    if (b.expectancy !== a.expectancy) return b.expectancy - a.expectancy;
    if (b.netProfit !== a.netProfit) return b.netProfit - a.netProfit;
    return a.maxDD - b.maxDD;
  });

  const allSorted = [...valid, ...results.filter((r) => r.rejected)];
  return {
    best: valid[0] || null,
    top10: allSorted.slice(0, 10),
    totalCombos: combos.length,
    validCount: valid.length
  };
}

