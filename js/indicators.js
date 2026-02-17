export const SMA = (arr, p) => {
  const out = new Array(arr.length).fill(null);
  if (arr.length < p) return out;
  let sum = 0;
  for (let i=0;i<arr.length;i++){
    sum += arr[i];
    if (i>=p) sum -= arr[i-p];
    if (i>=p-1) out[i]=sum/p;
  }
  return out;
};

export const EMA = (arr, p) => {
  const out = new Array(arr.length).fill(null);
  if (arr.length < p) return out;
  const k = 2/(p+1);
  let sum=0;
  for (let i=0;i<p;i++) sum += arr[i];
  let ema = sum/p;
  out[p-1]=ema;
  for (let i=p;i<arr.length;i++){
    ema = arr[i]*k + ema*(1-k);
    out[i]=ema;
  }
  return out;
};

export function RSI(closes, p=14){
  if (closes.length < p+1) return null;
  let gains=0, losses=0;
  for (let i=1;i<=p;i++){
    const d = closes[i]-closes[i-1];
    if (d>=0) gains += d; else losses += Math.abs(d);
  }
  let avgG = gains/p, avgL = losses/p;
  for (let i=p+1;i<closes.length;i++){
    const d = closes[i]-closes[i-1];
    const g = d>0? d:0;
    const l = d<0? Math.abs(d):0;
    avgG = (avgG*(p-1) + g)/p;
    avgL = (avgL*(p-1) + l)/p;
  }
  if (avgL === 0) return 100;
  const rs = avgG/avgL;
  return 100 - (100/(1+rs));
}

export function ATR(highs, lows, closes, p=14){
  if (closes.length < p+1) return null;
  const trs=[];
  for (let i=1;i<closes.length;i++){
    const h = highs[i], l=lows[i], pc=closes[i-1];
    const tr = Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc));
    trs.push(tr);
  }
  if (trs.length < p) return null;
  let sum=0;
  for (let i=0;i<p;i++) sum += trs[i];
  let atr = sum/p;
  for (let i=p;i<trs.length;i++){
    atr = (atr*(p-1) + trs[i])/p;
  }
  return atr;
}
