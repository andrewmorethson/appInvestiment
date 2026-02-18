import { EdgeEngine } from './edgeEngine.js';

export const experimentalState = {
  trades: [],
  equity: 100,
  highWatermark: 100,
  drawdown: 0,
  edgeEngine: new EdgeEngine(50),
  logs: [],
  scannerRows: [],
  comparatorRows: []
};

export function resetExperimentalState(initialEquity = 100){
  const eq = Math.max(10, Number(initialEquity || 100));
  experimentalState.trades = [];
  experimentalState.equity = eq;
  experimentalState.highWatermark = eq;
  experimentalState.drawdown = 0;
  experimentalState.edgeEngine = new EdgeEngine(50);
  experimentalState.logs = [];
  experimentalState.scannerRows = [];
  experimentalState.comparatorRows = [];
}
