/**
 * presets.js
 * ------------------------------------------------------------
 * Presets de crescimento por fase.
 * Observacao: riskPct aqui e fracao (0.03 = 3% do equity).
 */

export const PRESETS = {
  GROWTH_100: {
    id: 'GROWTH_100',
    name: 'GROWTH-100 (100 -> 300)',
    market: 'SPOT',
    profile: 'TREND_FOLLOWING',
    riskPct: 0.03,
    maxTradesPerWeek: 6,
    maxDD: 0.12,
    minNetRTarget: 2.5,
    trendOnly: true,
    regimeChopBlock: true,
    slippageRate: 0.0006,
    trendSlopeMin: 0,
    atrExpansionMinRatio: 1.0,
    minTrendStrengthGate: 0.0007,
    minMaSeparationPct: 0.0014,
    minAtrPctGate: 0.003,
    maxTurnoverPerDayPct: 2.8,
    cooldownCandles: 2
  },
  SCALE_300: {
    id: 'SCALE_300',
    name: 'SCALE-300 (300 -> 700)',
    market: 'SPOT',
    profile: 'TREND_FOLLOWING_FILTERED',
    riskPct: 0.02,
    maxTradesPerWeek: 5,
    maxDD: 0.10,
    trendOnly: true,
    regimeChopBlock: true,
    edgeGating: true,
    edgeWindowTrades: 50,
    minRollingExpectancyUsd: 0,
    slippageRate: 0.0007,
    trendSlopeMin: 0.0003,
    atrExpansionMinRatio: 1.03,
    minTrendStrengthGate: 0.0009,
    minMaSeparationPct: 0.0018,
    minAtrPctGate: 0.0032,
    maxTurnoverPerDayPct: 2.2,
    cooldownCandles: 3,
    lossStreakRiskCutOn: true,
    lossStreakCutAfter: 3,
    lossStreakCutFactor: 0.5,
    lossStreakCutTrades: 5
  },
  CONSOLID_700: {
    id: 'CONSOLID_700',
    name: 'CONSOLID-700 (700 -> 1000)',
    market: 'SPOT',
    profile: 'TREND_FOLLOWING_ULTRA',
    riskPct: 0.015,
    maxTradesPerWeek: 4,
    maxDD: 0.08,
    trendOnly: true,
    regimeChopBlock: true,
    edgeGating: true,
    edgeWindowTrades: 80,
    minRollingExpectancyUsd: 0,
    minRollingWinRate: 0.48,
    requirePullbackEntry: true,
    slippageRate: 0.0008,
    trendSlopeMin: 0.0005,
    atrExpansionMinRatio: 1.06,
    minTrendStrengthGate: 0.0011,
    minMaSeparationPct: 0.0022,
    minAtrPctGate: 0.0035,
    maxTurnoverPerDayPct: 1.8,
    cooldownCandles: 4,
    lossStreakRiskCutOn: true,
    lossStreakCutAfter: 3,
    lossStreakCutFactor: 0.5,
    lossStreakCutTrades: 5,
    maxSlippagePct: 0.001,
    killSwitchCandles: 8
  }
};

export function applyPreset(cfg, presetId){
  const id = String(presetId || 'NONE');
  if (!id || id === 'NONE') return { ...cfg, selectedPresetId: 'NONE' };
  const preset = PRESETS[id];
  if (!preset) return { ...cfg, selectedPresetId: 'NONE' };
  return {
    ...cfg,
    ...preset,
    riskPctIsFraction: true,
    selectedPresetId: preset.id,
    selectedPresetName: preset.name
  };
}
