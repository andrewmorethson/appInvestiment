import { buildDecision } from '../js/engine.js';
import { calcFeeUsd, resolveTradeFeePct } from '../js/fees.js';
import { buildMomentumDecision } from './momentumModel.js';
import { buildProbabilityDecision } from './probabilityModel.js';

function sliceSeries(series, endIndex){
  return {
    t: series.t.slice(0, endIndex + 1),
    o: series.o.slice(0, endIndex + 1),
    h: series.h.slice(0, endIndex + 1),
    l: series.l.slice(0, endIndex + 1),
    c: series.c.slice(0, endIndex + 1),
    v: series.v.slice(0, endIndex + 1)
  };
}

function selectDecision(modelType, symbol, data, history, localState){
  if (modelType === 'momentum') return buildMomentumDecision(symbol, data, localState);
  if (modelType === 'prob') return buildProbabilityDecision(symbol, data, history);
  return buildDecision(data, { atrPeriod: 14 });
}

export function runBacktest(symbol, modelType, candles){
  const len = candles?.c?.length || 0;
  if (len < 260){
    return { symbol, modelType, error: 'Candles insuficientes (min 260).' };
  }

  const feePct = resolveTradeFeePct({ feeMode: 'BNB', feePctCustom: 0.10 });
  const slippageRate = modelType === 'prob' ? 0.0008 : (modelType === 'momentum' ? 0.0006 : 0.0007);
  const history = [];
  const localState = {
    edgeEngine: {
      rollingExpectancy: () => {
        if (!history.length) return 0;
        const arr = history.slice(-50);
        const sum = arr.reduce((acc, x) => acc + Number(x.netUsd || 0), 0);
        return sum / arr.length;
      },
      samples: history.slice(-50)
    }
  };

  let equity = 100;
  let highWatermark = 100;
  let maxDD = 0;
  let open = null;
  const equityCurve = [{ x: 0, y: equity }];

  for (let i = 220; i < len; i++){
    const view = sliceSeries(candles, i);
    const close = Number(view.c[view.c.length - 1] || 0);
    const high = Number(view.h[view.h.length - 1] || close);
    const low = Number(view.l[view.l.length - 1] || close);

    if (!open){
      const dec = selectDecision(modelType, symbol, view, history, localState);
      if (dec?.signal === 'BUY'){
        const atr = Math.max(Number(dec.atr || 0), close * 0.003);
        const stopDist = Math.max(atr * 1.5, close * 0.004);
        const riskUsd = Math.max(0.5, equity * 0.01);
        const qty = riskUsd / Math.max(1e-9, stopDist);
        const entry = close;
        const stop = entry - stopDist;
        const target = entry + (stopDist * 2);
        const entryNotional = Math.abs(entry * qty);
        const entryFee = calcFeeUsd(entryNotional, feePct);
        const entrySlip = entryNotional * slippageRate;
        equity -= (entryFee + entrySlip);

        open = {
          entry,
          stop,
          target,
          qty,
          riskUsd,
          entryCosts: entryFee + entrySlip,
          regimeBull: !!dec.regimeBull || !!dec.bullRegime,
          breakoutFlag: !!dec.breakoutFlag,
          atrExp: !!dec.atrExp
        };
      }
    }

    if (open){
      let exitPrice = null;
      let exitReason = null;
      if (low <= open.stop){
        exitPrice = open.stop;
        exitReason = 'STOP';
      } else if (high >= open.target){
        exitPrice = open.target;
        exitReason = 'TARGET_2R';
      }

      if (exitPrice != null){
        const gross = (exitPrice - open.entry) * open.qty;
        const exitNotional = Math.abs(exitPrice * open.qty);
        const exitFee = calcFeeUsd(exitNotional, feePct);
        const exitSlip = exitNotional * slippageRate;
        const net = gross - (exitFee + exitSlip);
        equity += net;
        const netR = net / Math.max(1e-9, open.riskUsd);
        history.push({
          ts: Date.now() + i,
          netUsd: net,
          netR,
          exitReason,
          regimeBull: open.regimeBull,
          breakoutFlag: open.breakoutFlag,
          atrExp: open.atrExp
        });
        open = null;
      }
    }

    highWatermark = Math.max(highWatermark, equity);
    const dd = (highWatermark - equity) / Math.max(1e-9, highWatermark);
    maxDD = Math.max(maxDD, dd);
    equityCurve.push({ x: i, y: equity });
  }

  const wins = history.filter((t) => Number(t.netUsd || 0) > 0).length;
  const total = history.length;
  const winRate = total ? (wins / total) : 0;
  const netProfit = equity - 100;
  const expectancy = total ? history.reduce((acc, t) => acc + Number(t.netUsd || 0), 0) / total : 0;

  return {
    symbol,
    modelType,
    trades: total,
    netProfit,
    winRate,
    expectancy,
    maxDD,
    equityCurve,
    history
  };
}

export function drawEquityCurve(canvas, curve){
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0b1320';
  ctx.fillRect(0, 0, w, h);
  if (!Array.isArray(curve) || curve.length < 2) return;

  const ys = curve.map((p) => Number(p.y || 0));
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = Math.max(1e-9, maxY - minY);

  ctx.strokeStyle = '#64f0a8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < curve.length; i++){
    const x = (i / (curve.length - 1)) * (w - 20) + 10;
    const y = h - 10 - ((ys[i] - minY) / spanY) * (h - 20);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

