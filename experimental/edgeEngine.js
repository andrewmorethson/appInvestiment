export class EdgeEngine {
  constructor(windowSize = 50){
    this.windowSize = Math.max(5, Number(windowSize || 50));
    this.samples = [];
    this.tradesCount = 0;
    this.netExpectancy = 0;
  }

  addTrade({ netPnL }){
    const v = Number(netPnL);
    if (!Number.isFinite(v)) return;
    this.samples.push(v);
    this.tradesCount += 1;
    if (this.samples.length > this.windowSize){
      this.samples.splice(0, this.samples.length - this.windowSize);
    }
    const sum = this.samples.reduce((acc, x) => acc + x, 0);
    this.netExpectancy = sum / Math.max(1, this.samples.length);
  }

  rollingExpectancy(){
    return Number(this.netExpectancy || 0);
  }

  rollingWinRate(){
    if (!this.samples.length) return 0;
    const wins = this.samples.reduce((acc, x) => acc + (x > 0 ? 1 : 0), 0);
    return wins / this.samples.length;
  }
}

