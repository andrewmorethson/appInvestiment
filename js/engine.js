/**
 * engine.js
 * ------------------------------------------------------------
 * Núcleo de regras do paper-trading.
 * - Gera decisões a partir de séries de candles (score/sinal/razões)
 * - Abre/gerencia/fecha trades (simulação)
 * - Aplica travas (DD diário, loss streak, etc.)
 *
 * Observação:
 * - Taxas e imposto são centralizados no FeesService (fees.js)
 */
import { S } from './state.js';
import { now, uid, intervalToMs } from './utils.js';
import { EMA, SMA, RSI, ATR } from './indicators.js';
import { resolveTradeFeePct, calcFeeUsd, registerTradeFee, applyTaxOnProfit } from './fees.js';

export const PROFILE_PRESETS = {
  IA_AVANCADO: {
    name:'IA Avançado',
    riskPct: 0.7,
    maxDailyDD: 3.0,
    maxOpen: 4,
    atrPeriod:14, atrStop: 1.9, atrTarget: 2.4, atrTrail: 1.8, breakEvenR: 0.9,
    timeStopOn:true, timeStopCandles: 8,
    partialOn:true, partialAtR: 0.8, partialPct: 30,
    beAfterPartialOn:true,
    noRepeat:true, cooldownCandles:1,
    autoProfitOn:true, autoProfitPct:0.35,
    feeMode:'BNB', feePctCustom:0.10,
    execSpreadBps: 5,
    execSlippageBps: 3,
    execLatencyMs: 250,
    execLatencyBpsPerSec: 1.0,
    minRR: 1.15,
    edgeMinPct: 0.10,
    taxOn:true, taxPct:15, taxApplyCash:true
  }
};

// trade guard
export function tradeKey(signal, symbol, interval, klineCloseTs){
  return `${signal}|${symbol}|${interval}|${klineCloseTs||0}`;
}
export function canPassTradeGuard(key){ return !S.tradeGuard.has(key); }
export function markTradeGuard(key){
  S.tradeGuard.add(key);
  if (S.tradeGuard.size > 1500){
    const arr = Array.from(S.tradeGuard);
    for (let i=0;i<700;i++) S.tradeGuard.delete(arr[i]);
  }
}

export function ddPctCash(){
  return Math.max(0, (S.dayAnchorCash - S.cash) / Math.max(1e-9, S.dayAnchorCash) * 100);
}

export function computeEquity(){
  let eq = S.cash;
  for (const t of S.open){
    const p = (typeof t.lastPrice === 'number') ? t.lastPrice : null;
    if (typeof p === 'number'){
      const dir = t.side === 'BUY' ? 1 : -1;
      eq += dir * (p - t.entry) * t.qty;
    }
  }
  return eq;
}

export function canTradeNew(cfg){
  if (S.locked) return { ok:false, code:'LOCKED', reason: S.lockReason || 'Sistema travado' };
  const dd = ddPctCash();
  if (dd >= cfg.maxDailyDD) return { ok:false, code:'DD', reason: `Daily DD ${dd.toFixed(2)}% ≥ limite ${cfg.maxDailyDD}%` };
  if (S.open.length >= cfg.maxOpen) return { ok:false, code:'MAX_OPEN', reason: `Limite de trades abertos atingido (${cfg.maxOpen})` };
  return { ok:true, code:'OK' };
}

function resolveRiskFraction(cfg){
  const v = Number(cfg?.riskPct || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (cfg?.riskPctIsFraction) return v;
  return v / 100;
}

function calcPositionQty(entry, stop, riskUsd){
  const dist = Math.max(1e-9, Math.abs(entry-stop));
  return riskUsd / dist;
}

export function applyPnL(qty, side, entry, exitPrice){
  const dir = side === 'BUY' ? 1 : -1;
  return dir * (exitPrice - entry) * qty;
}



export function bookRealized(pnl, log){
  S.cash += pnl;
  if (pnl >= 0) S.grossWinUsd += pnl;
  else S.grossLossUsd += Math.abs(pnl);
  S.realizedUsd += pnl;

  const EPS = 1e-9;
  if (pnl > EPS){
    S.wins += 1;
    S.lossStreak = 0;
  } else if (pnl < -EPS){
    S.losses += 1;
    S.lossStreak += 1;
    if (S.lossStreak >= S.MAX_CONSECUTIVE_LOSSES){
      S.locked = true;
      S.lockType = 'LOSS';
      S.lockReason = `Bloqueado após ${S.MAX_CONSECUTIVE_LOSSES} Loss consecutivos.`;
      log?.(`🔒 TRAVA LOSS ativada: ${S.MAX_CONSECUTIVE_LOSSES} losses consecutivos.`);
    }
  } else {
    S.lossStreak = 0;
  }
}

export function openTradeFromIdea(idea, cfg, log, riskMult = 1.0){
  const entryExec = applyExecutionModel(idea.signal, idea.entry, cfg);
  const id = uid();
  const riskFrac = resolveRiskFraction(cfg);
  const riskUsd = S.cash * riskFrac * riskMult; // sobre saldo
  const qty = calcPositionQty(entryExec, idea.stop, riskUsd);

  // Taxa de entrada (Binance spot): cobrada na execução (market/taker). Subtrai do saldo imediatamente.
  const entryNotional = Math.abs(entryExec * qty);
  const feePctUsed = resolveTradeFeePct(cfg);
  const feeEntry = calcFeeUsd(entryNotional, feePctUsed);
  // Em modo realista, taxa entra na contabilidade imediatamente (cash reduz).
  registerTradeFee(S, feeEntry);

  const trade = {
    id,
    openedAt: now(),
    openedKlineTs: idea.klineCloseTs || now(),
    side: idea.signal,
    symbol: idea.symbol,
    interval: idea.interval,
    entry: entryExec,
    stop: idea.stop,
    target: idea.target,
    qty,
    riskUsd,
    riskUsdInitial: riskUsd,
    feePctUsed,
    atr: idea.atr,

    feeEntryUsdTotal: feeEntry,
    feeEntryUsdRemaining: feeEntry,
    feeExitUsdTotal: 0,
    feeUsdTotal: feeEntry,
    qtyInitial: qty,
    taxOnUsed: !!cfg.taxOn,
    taxPctUsed: Number(cfg.taxPct||0),
    taxApplyCashUsed: !!cfg.taxApplyCash,

    trailOn: cfg.atrTrail > 0,
    trailMult: cfg.atrTrail,
    movedBE:false,
    peak: entryExec,

    reasons: idea.reasons,
    riskMult,

    partialDone:false,
    lastPrice: entryExec,
    maxFavR: 0,
    maxAdvR: 0,
  };

  S.open.push(trade);
  if (S.riskCutActive && S.riskCutRemainingTrades > 0){
    S.riskCutRemainingTrades = Math.max(0, Number(S.riskCutRemainingTrades || 0) - 1);
  }
  log?.(`[AUDIT][OPEN] run=${S.runId || '-'} trade=${trade.id} side=${trade.side} symbol=${trade.symbol} interval=${trade.interval} score=${idea.score.toFixed(2)} riskx=${riskMult.toFixed(2)} fee_entry_usd=${feeEntry.toFixed(2)} fee_pct=${trade.feePctUsed.toFixed(3)} tax_on=${trade.taxOnUsed ? 'ON' : 'OFF'} | entry_mark=${idea.fmtPx(idea.entry)} entry_exec=${idea.fmtPx(entryExec)} stop=${idea.fmtPx(trade.stop)} target=${idea.fmtPx(trade.target)} qty=${trade.qty.toFixed(6)}`);
}

export function closeTrade(trade, exitPrice, reason, log, cfg){
  const qty = Number(trade.qty)||0;
  const px = applyExecutionModel(trade.side === 'BUY' ? 'SELL' : 'BUY', Number(exitPrice)||0, cfg || S.runtimeCfg || {});

  // taxa de saída (market/taker)
  const exitNotional = Math.abs(px * qty);
  const feeExit = calcFeeUsd(exitNotional, trade.feePctUsed);
  registerTradeFee(S, feeExit);
  trade.feeExitUsdTotal = (Number(trade.feeExitUsdTotal)||0) + feeExit;
  trade.feeUsdTotal = (Number(trade.feeUsdTotal)||0) + feeExit;

  // pnl bruto (sem taxas)
  const pnl = applyPnL(qty, trade.side, trade.entry, px);
  bookRealized(pnl, log);

  // imposto sobre lucro líquido (pnl - taxas)
  const feeEntryPart = Number(trade.feeEntryUsdRemaining)||0;
  trade.feeEntryUsdRemaining = 0;
  const taxable = pnl - feeEntryPart - feeExit;
  const taxUsd = applyTaxOnProfit(taxable, S, { taxOn: trade.taxOnUsed, taxPct: trade.taxPctUsed, taxApplyCash: trade.taxApplyCashUsed }, log);
  const netUsd = pnl - feeEntryPart - feeExit - Number(taxUsd || 0);
  const riskBase = Math.max(1e-9, Number(trade.riskUsdInitial || trade.riskUsd || 0));
  const realizedR = pnl / riskBase;
  const realizedNetR = netUsd / riskBase;
  const holdMin = Math.max(0, (Date.now() - Number(trade.openedAt || Date.now())) / 60_000);

  S.closedTradesNet.push({
    ts: Date.now(),
    symbol: trade.symbol,
    netUsd,
    netR: realizedNetR,
    win: netUsd > 0 ? 1 : 0
  });
  if (S.closedTradesNet.length > 1200){
    S.closedTradesNet.splice(0, S.closedTradesNet.length - 1200);
  }

  if (netUsd < -1e-9) S.netLossStreak = Number(S.netLossStreak || 0) + 1;
  else if (netUsd > 1e-9) S.netLossStreak = 0;

  const currentHighWatermark = Math.max(Number(S.highWatermarkCash || 0), Number(S.cash || 0));
  S.highWatermarkCash = currentHighWatermark;

  const cutOn = !!cfg?.lossStreakRiskCutOn;
  const cutAfter = Math.max(1, Number(cfg?.lossStreakCutAfter || 3));
  const cutTrades = Math.max(1, Number(cfg?.lossStreakCutTrades || 5));
  if (cutOn && Number(S.netLossStreak || 0) >= cutAfter && !S.riskCutActive){
    S.riskCutActive = true;
    S.riskCutRemainingTrades = cutTrades;
    S.riskCutAnchorHighWatermark = currentHighWatermark;
    log?.(`[RISK_CUT] ativado apos ${cutAfter} perdas consecutivas. fator=${Number(cfg?.lossStreakCutFactor || 0.5).toFixed(2)} trades=${cutTrades} hwm=${currentHighWatermark.toFixed(2)}`);
  }

  if (S.riskCutActive){
    const anchor = Number(S.riskCutAnchorHighWatermark || 0);
    const recoveredHwm = anchor > 0 && Number(S.cash || 0) >= anchor;
    const exhausted = Number(S.riskCutRemainingTrades || 0) <= 0;
    if (recoveredHwm || exhausted){
      S.riskCutActive = false;
      S.riskCutRemainingTrades = 0;
      S.riskCutAnchorHighWatermark = null;
      S.netLossStreak = 0;
      log?.(`[RISK_CUT] restaurado (${recoveredHwm ? 'novo high-watermark' : 'janela encerrada'}).`);
    }
  }

  S.open = S.open.filter(t => t.id !== trade.id);
  log?.(`[AUDIT][CLOSE] run=${S.runId || '-'} trade=${trade.id} side=${trade.side} symbol=${trade.symbol} interval=${trade.interval} reason=${reason} pnl_usd=${pnl.toFixed(2)} taxable_usd=${taxable.toFixed(2)} fee_exit_usd=${feeExit.toFixed(2)} fee_trade_total_usd=${(Number(trade.feeUsdTotal)||0).toFixed(2)} tax_usd=${Number(taxUsd||0).toFixed(2)} | exit_mark=${Number(exitPrice||0).toFixed(6)} exit_exec=${px.toFixed(6)}`);
  log?.(`[PROFILE][EXIT] run=${S.runId || '-'} profile=${S.runningProfile || '-'} trade=${trade.id} symbol=${trade.symbol} side=${trade.side} reason=${reason} r_realized=${realizedR.toFixed(2)} r_net=${realizedNetR.toFixed(2)} hold_min=${holdMin.toFixed(1)} mfe_r=${Number(trade.maxFavR||0).toFixed(2)} mae_r=${Number(trade.maxAdvR||0).toFixed(2)} win=${netUsd >= 0 ? 1 : 0}`);
  logProfileRollup(log);
}

export function computeRollingEdge(windowTrades){
  const n = Math.max(1, Number(windowTrades || 1));
  const hist = Array.isArray(S.closedTradesNet) ? S.closedTradesNet : [];
  if (!hist.length){
    return { count: 0, expectancyUsd: null, winRate: null };
  }
  const slice = hist.slice(-n);
  const count = slice.length;
  let sum = 0;
  let wins = 0;
  for (const x of slice){
    const net = Number(x?.netUsd || 0);
    if (net > 0) wins += 1;
    sum += net;
  }
  return {
    count,
    expectancyUsd: sum / Math.max(1, count),
    winRate: wins / Math.max(1, count)
  };
}

export function closePartial(trade, exitPrice, pct, reason, log, cfg){
  const pctClamped = Math.max(0.01, Math.min(0.90, pct));
  const preQty = Number(trade.qty)||0;
  const qtyClose = preQty * pctClamped;
  if (qtyClose <= 1e-12) return;

  const px = applyExecutionModel(trade.side === 'BUY' ? 'SELL' : 'BUY', Number(exitPrice)||0, cfg || S.runtimeCfg || {});

  // taxa de saída proporcional
  const exitNotional = Math.abs(px * qtyClose);
  const feeExit = calcFeeUsd(exitNotional, trade.feePctUsed);
  registerTradeFee(S, feeExit);
  trade.feeExitUsdTotal = (Number(trade.feeExitUsdTotal)||0) + feeExit;
  trade.feeUsdTotal = (Number(trade.feeUsdTotal)||0) + feeExit;

  // aloca parte da taxa de entrada proporcional ao que está sendo fechado
  const feeEntryRem = Number(trade.feeEntryUsdRemaining)||0;
  const feeEntryPart = feeEntryRem * (qtyClose / Math.max(1e-12, preQty));
  trade.feeEntryUsdRemaining = Math.max(0, feeEntryRem - feeEntryPart);

  const pnl = applyPnL(qtyClose, trade.side, trade.entry, px);
  bookRealized(pnl, log);

  const taxable = pnl - feeEntryPart - feeExit;
  const taxUsd = applyTaxOnProfit(taxable, S, { taxOn: trade.taxOnUsed, taxPct: trade.taxPctUsed, taxApplyCash: trade.taxApplyCashUsed }, log);

  trade.qty = preQty - qtyClose;
  trade.riskUsd = trade.riskUsd * (1 - pctClamped);

  log?.(`[AUDIT][PARTIAL] run=${S.runId || '-'} trade=${trade.id} side=${trade.side} symbol=${trade.symbol} interval=${trade.interval} close_pct=${Math.round(pctClamped*100)} reason=${reason} pnl_usd=${pnl.toFixed(2)} taxable_usd=${taxable.toFixed(2)} fee_exit_usd=${feeExit.toFixed(2)} fee_entry_alloc_usd=${feeEntryPart.toFixed(2)} fee_trade_total_usd=${(Number(trade.feeUsdTotal)||0).toFixed(2)} tax_usd=${Number(taxUsd||0).toFixed(2)} | exit_mark=${Number(exitPrice||0).toFixed(6)} exit_exec=${px.toFixed(6)} qty_left=${trade.qty.toFixed(6)}`);

  if (trade.qty <= 1e-10){
    S.open = S.open.filter(t => t.id !== trade.id);
    log(`CLOSE (tiny) ${trade.side} ${trade.symbol} | posição residual removida`);
  }
}

export function buildDecision(series, cfg){
  const closes = series.c;
  const highs = series.h;
  const lows = series.l;
  const n = closes.length - 1;
  const last = closes[n];

  const ema9 = EMA(closes, 9);
  const ema21 = EMA(closes, 21);
  const ma200 = SMA(closes, 200);
  const rsi14 = RSI(closes, 14);
  const atr = ATR(highs, lows, closes, cfg.atrPeriod);

  const e9 = ema9[n];
  const e21 = ema21[n];
  const m200 = ma200[n];

  const reasons = [];
  let score = 0;

  const hasM200 = (m200 != null);
  const bullRegime = hasM200 ? (last > m200) : false;
  const bearRegime = hasM200 ? (last < m200) : false;
  reasons.push(hasM200 ? (bullRegime ? "REGIME=BULL" : "REGIME=BEAR") : "MA200:insuf");

  let trendStrength = 0;
  if (e9 != null && e21 != null){
    trendStrength = Math.abs(e9 - e21) / Math.max(1e-9, last);
    reasons.push(e9 > e21 ? "EMA9>EMA21" : "EMA9<EMA21");
    reasons.push(`TS=${(trendStrength*100).toFixed(2)}%`);
    score += Math.min(4, 2.2 + (trendStrength / 0.002) * 1.8);
  } else {
    reasons.push("EMA:insuf");
    score += 1.0;
  }

  const atrPct = (typeof atr === 'number') ? (atr / Math.max(1e-9, last)) : 0;
  if (typeof atr === 'number'){
    reasons.push(`ATR%=${(atrPct*100).toFixed(2)}%`);
    const volN = Math.max(0, Math.min(1, (atrPct - 0.003) / (0.012 - 0.003)));
    score += volN * 2.0;
  } else {
    reasons.push("ATR:insuf");
    score += 0.4;
  }

  if (typeof rsi14 === 'number'){
    reasons.push(`RSI14=${rsi14.toFixed(1)}`);
    const okBand = (rsi14 >= 40 && rsi14 <= 75);
    score += okBand ? 1.8 : 0.8;
  } else {
    reasons.push("RSI:insuf");
    score += 0.8;
  }

  if (hasM200){
    const dist = Math.abs(last - m200) / Math.max(1e-9, last);
    const regPts = Math.min(2.0, 0.8 + dist * 8);
    score += regPts;
    reasons.push(`MA200D=${(dist*100).toFixed(2)}%`);
  }

  if (closes.length >= 6){
    const r5 = (closes[n] - closes[n-5]) / Math.max(1e-9, closes[n-5]);
    const pts = Math.min(1.0, Math.abs(r5) * 25);
    score += pts;
    reasons.push(`Mom5=${(r5*100).toFixed(2)}%`);
  }

  if (S.testMode){
    score = Math.min(10, score + 1.5);
    reasons.push("TEST:+1.5");
  }

  score = Math.max(0, Math.min(10, score));

  let signal = 'HOLD';
  const okTrend = trendStrength >= S.MIN_TREND_STRENGTH;
  const okVol = atrPct >= S.MIN_ATR_PCT;

  const okCore =
    (score >= S.SCORE_MIN) &&
    okTrend &&
    okVol &&
    hasM200 &&
    (e9 != null && e21 != null) &&
    (typeof rsi14 === 'number') &&
    (typeof atr === 'number');

  if (okCore){
    if (bullRegime) signal = 'BUY';
    else if (bearRegime) signal = 'SELL';
    else signal = 'HOLD';
  }

  if (!okTrend) reasons.push("FILTER:TrendWeak");
  if (!okVol) reasons.push("FILTER:LowVol");

  return {
    last, score, signal, reasons,
    atr: (typeof atr === 'number' ? atr : null),
    rsi14, ema9:e9, ema21:e21, ma200:m200,
    trendStrength, atrPct,
    bullRegime, bearRegime
  };
}

export function progressPct(trade, price){
  const stop = trade.stop;
  const entry = trade.entry;
  const target = trade.target;
  const EPS = 1e-9;

  if (trade.side === 'BUY'){
    if (price <= entry){
      const denom = Math.max(EPS, (entry - stop));
      const p = -100 * ((entry - price) / denom);
      return Math.max(-100, Math.min(100, p));
    } else {
      const denom = Math.max(EPS, (target - entry));
      const p = 100 * ((price - entry) / denom);
      return Math.max(-100, Math.min(100, p));
    }
  } else {
    if (price >= entry){
      const denom = Math.max(EPS, (stop - entry));
      const p = -100 * ((price - entry) / denom);
      return Math.max(-100, Math.min(100, p));
    } else {
      const denom = Math.max(EPS, (entry - target));
      const p = 100 * ((entry - price) / denom);
      return Math.max(-100, Math.min(100, p));
    }
  }
}

export function applyExecutionModel(actionSide, markPrice, cfg){
  const px = Number(markPrice)||0;
  if (!Number.isFinite(px) || px <= 0) return 0;

  const spreadBps = Math.max(0, Number(cfg?.execSpreadBps||0));
  const slippageBps = Math.max(0, Number(cfg?.execSlippageBps||0));
  const latencyMs = Math.max(0, Number(cfg?.execLatencyMs||0));
  const latencyBpsPerSec = Math.max(0, Number(cfg?.execLatencyBpsPerSec||0));
  const latencyBps = (latencyMs / 1000) * latencyBpsPerSec;
  const adverseBps = spreadBps / 2 + slippageBps + latencyBps;
  const shift = adverseBps / 10_000;

  if (actionSide === 'BUY') return px * (1 + shift);
  return px * (1 - shift);
}

function logProfileRollup(log){
  const wins = Number(S.wins || 0);
  const losses = Number(S.losses || 0);
  const n = wins + losses;
  if (!n) return;
  const winRate = (wins / n) * 100;
  const avgWin = wins > 0 ? Number(S.grossWinUsd || 0) / wins : 0;
  const avgLoss = losses > 0 ? Number(S.grossLossUsd || 0) / losses : 0;
  const pf = Number(S.grossLossUsd || 0) > 0 ? Number(S.grossWinUsd || 0) / Number(S.grossLossUsd || 1) : 0;
  log?.(`[PROFILE][ROLLUP] run=${S.runId || '-'} profile=${S.runningProfile || '-'} trades=${n} win_rate_pct=${winRate.toFixed(1)} avg_win_usd=${avgWin.toFixed(2)} avg_loss_usd=${avgLoss.toFixed(2)} pf=${pf.toFixed(2)} realized_usd=${Number(S.realizedUsd||0).toFixed(2)} fees_usd=${Number(S.feePaidUsd||0).toFixed(2)} tax_reserved_usd=${Number(S.taxReservedUsd||0).toFixed(2)} tax_paid_usd=${Number(S.taxPaidUsd||0).toFixed(2)}`);
}

export function updateOpenTradesForSymbol(symbol, lastPrice, cfg, currentKlineTs, log, fmtPx){
  const barMs = intervalToMs(cfg.interval);

  for (const t of [...S.open]){
    if (t.symbol !== symbol) continue;

    const price = lastPrice;
    t.lastPrice = price;
    t.fmtPx = fmtPx;

    // peak
    if (t.side === 'BUY') t.peak = Math.max(t.peak, price);
    else t.peak = Math.min(t.peak, price);

    // R
    const denom = Math.max(1e-9, Math.abs(t.entry - t.stop));
    const r = Math.abs(price - t.entry) / denom;
    const signedR = t.side === 'BUY'
      ? ((price - t.entry) / denom)
      : ((t.entry - price) / denom);
    t.maxFavR = Math.max(Number(t.maxFavR || 0), Math.max(0, signedR));
    t.maxAdvR = Math.max(Number(t.maxAdvR || 0), Math.max(0, -signedR));

    // parcial
    if (cfg.partialOn && !t.partialDone && r >= cfg.partialAtR){
      closePartial(t, price, cfg.partialPct, `R>=${cfg.partialAtR.toFixed(1)}`, log, cfg);
      t.partialDone = true;

      if (cfg.beAfterPartialOn){
        t.stop = t.entry;
        t.movedBE = true;
        log?.(`BE após parcial: stop -> entry (${t.side} ${t.symbol})`);
      }
    }

    // BE
    if (!t.movedBE && cfg.breakEvenR > 0 && r >= cfg.breakEvenR){
      t.stop = t.entry;
      t.movedBE = true;
      log?.(`BE: stop -> entry (${t.side} ${t.symbol})`);
    }

    // trailing
    if (t.trailOn && t.atr && t.trailMult > 0){
      const trailDist = t.atr * t.trailMult;
      if (t.side === 'BUY'){
        const newStop = t.peak - trailDist;
        if (newStop > t.stop) t.stop = newStop;
      } else {
        const newStop = t.peak + trailDist;
        if (newStop < t.stop) t.stop = newStop;
      }
    }

    // time stop
    if (cfg.timeStopOn && typeof currentKlineTs === 'number' && typeof t.openedKlineTs === 'number'){
      const bars = Math.floor((currentKlineTs - t.openedKlineTs) / Math.max(1, barMs));
      if (bars >= cfg.timeStopCandles){
        closeTrade(t, price, `TIME_STOP ${bars}c>=${cfg.timeStopCandles}c`, log, cfg);
        continue;
      }
    }

    // auto profit %
    if (cfg.autoProfitOn){
      const pnl = applyPnL(t.qty, t.side, t.entry, price);
      const notional = Math.max(1e-9, Math.abs(t.entry * t.qty));
      const pct = (pnl / notional) * 100;
      if (pct >= cfg.autoProfitPct){
        closeTrade(t, price, `AUTO PROFIT >= ${cfg.autoProfitPct.toFixed(2)}%`, log, cfg);
        continue;
      }
    }

    // stop/target
    if (t.side === 'BUY'){
      if (price <= t.stop) closeTrade(t, t.stop, 'STOP', log, cfg);
      else if (price >= t.target) closeTrade(t, t.target, 'TARGET', log, cfg);
    } else {
      if (price >= t.stop) closeTrade(t, t.stop, 'STOP', log, cfg);
      else if (price <= t.target) closeTrade(t, t.target, 'TARGET', log, cfg);
    }
  }
}
