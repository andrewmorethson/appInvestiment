export class EdgeEngine {
  constructor(windowSize = 50){
    this.windowSize = Math.max(5, Number(windowSize || 50));
    this.samples = [];
  }

  recordTrade(trade){
    if (!trade || !Number.isFinite(Number(trade.netUsd))) return;
    this.samples.push({
      ts: Number(trade.ts || Date.now()),
      netUsd: Number(trade.netUsd),
      netR: Number(trade.netR || 0),
      win: Number(trade.netUsd) > 0 ? 1 : 0
    });
    if (this.samples.length > this.windowSize){
      this.samples.splice(0, this.samples.length - this.windowSize);
    }
  }

  rollingExpectancy(){
    if (!this.samples.length) return null;
    const sum = this.samples.reduce((acc, s) => acc + s.netUsd, 0);
    return sum / this.samples.length;
  }

  rollingWinRate(){
    if (!this.samples.length) return null;
    const wins = this.samples.reduce((acc, s) => acc + (s.win ? 1 : 0), 0);
    return wins / this.samples.length;
  }
}

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

