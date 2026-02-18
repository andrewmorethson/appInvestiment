export const DEFAULT_EXPERIMENTAL_CFG = {
  // Regime
  slopeLookback: 80,
  chopSlopeNorm: 0.05,
  bullSlopeNorm: 0.10,

  // Breakout / expansion
  breakoutLookback: 12,

  // Momentum / edge
  minMomentum: 0.001,
  edgeMinTrades: 30,

  // Probability model
  probLookAhead: 50,
  probMinOcc: 30,
  probRR: 2.0,

  // Backtest cost / exits (15m defaults)
  stopAtrMult: 1.8,
  rTarget: 2.5,
  stopMinPct: 0.001,
  feeRate: 0.001,
  slippageRate: 0.0006
};

export function mergeExperimentalCfg(base, overrides){
  return { ...(base || DEFAULT_EXPERIMENTAL_CFG), ...(overrides || {}) };
}

