/**
 * ui.js
 * ------------------------------------------------------------
 * Camada de apresentação (DOM) do Guardian Quant.
 * - Renderiza KPIs, listas (pending/open), logs e Modo Foco (widgets)
 * - Não contém regras de trade: apenas leitura do estado S e cfg atual
 *
 * Dica:
 * - Evite chamar updateUI em loops internos (por símbolo). Use um repaint por ciclo.
 */
import { S } from './state.js';
import { fmtUSD, fmtPct, fmtPx, ts } from './utils.js';
import { computeEquity, ddPctCash, applyPnL, progressPct, applyExecutionModel } from './engine.js';
import { computeFeesSnapshot, calcFeeUsd, resolveTradeFeePct } from './fees.js';

export function getEl(){
  const $ = (id) => document.getElementById(id);
  return {
    dot: $('dot'), runLabel: $('runLabel'), tickLabel: $('tickLabel'), statusLabel:$('statusLabel'),
    btnStart: $('btnStart'), btnStop: $('btnStop'), btnOnce: $('btnOnce'), btnReset: $('btnReset'),
    btnUnlock: $('btnUnlock'), btnTestMode: $('btnTestMode'), btnFocus:$('btnFocus'),
    controlsCard: $('controlsCard'),

    lockBanner: $('lockBanner'), lockReason: $('lockReason'),
    lockModal: $('lockModal'), lockModalTitle: $('lockModalTitle'), lockModalBody: $('lockModalBody'),
    lockModalClose: $('lockModalClose'), lockModalGoControls: $('lockModalGoControls'),
    kCash: $('kCash'), kEquity: $('kEquity'), kPL: $('kPL'), kDD: $('kDD'),
    kRealized: $('kRealized'), kGrossWin: $('kGrossWin'), kGrossLoss: $('kGrossLoss'), kUnrealized: $('kUnrealized'),
    kGrossUsd: $('kGrossUsd'),
    kFees: $('kFees'), kTaxRes: $('kTaxRes'), kTaxPaid: $('kTaxPaid'), kNet: $('kNet'),
    kOffSpread: $('kOffSpread'), kPixFeeBrl: $('kPixFeeBrl'), kNetAfterOff: $('kNetAfterOff'),
    kWL: $('kWL'), kStreak: $('kStreak'), kOpen: $('kOpen'), kLock: $('kLock'),
    kSym: $('kSym'), kPrice: $('kPrice'), kSignal: $('kSignal'), kScore:$('kScore'), kReasons: $('kReasons'),
    kBestList: $('kBestList'),
    profileLabel: $('profileLabel'), profileHint: $('profileHint'), profileSeg: $('profileSeg'),
    logs: $('logs'), lastTickSmall: $('lastTickSmall'),
    chipUniverse: $('chipUniverse'), chipBest: $('chipBest'),
    cfgLockHint: $('cfgLockHint'),
    
    cfgSymbolSingle: $('cfgSymbolSingle'), cfgSymbolCustom: $('cfgSymbolCustom'),

    // focus deck
    focusDeck: $('focusDeck'),
    focusTabs: $('focusTabs'),
    focusContent: $('focusContent'),
    focusDeckHint: $('focusDeckHint'),
    btnFocusHeader: $('btnFocusHeader'),
    // focus controls (now in Focus Deck)
    // focus deck duplicated controls
    btnFocusStart: $('btnFocusStart'),
    btnFocusStop: $('btnFocusStop'),
    btnFocusOnce: $('btnFocusOnce'),
    btnFocusReset: $('btnFocusReset'),
    btnFocusTestMode: $('btnFocusTestMode'),
    btnFocusCloseProfit: $('btnFocusCloseProfit'),
    btnFocusCloseLoss: $('btnFocusCloseLoss'),
    btnFocusCloseAll: $('btnFocusCloseAll'),
    btnFocusUnlockDD: $('btnFocusUnlockDD'),
    btnFocusOff: $('btnFocusOff'),
  };
}

function setConfigInputsDisabled(el, disabled){
  if (!el) return;
  if (!el._cfgNodes){
    el._cfgNodes = Array.from(document.querySelectorAll(
      '#controlsBody input, #controlsBody select, #controlsBody button[data-intpreset]'
    ));
  }
  for (const node of el._cfgNodes){
    node.disabled = !!disabled;
  }
}

export function logFactory(el, S){
  return function log(msg){
    const line = `[${ts(Date.now())}] ${msg}`;
    if (S && Array.isArray(S.logLines)){
      S.logLines.push(line);
      if (S.logLines.length > 800) S.logLines.splice(0, S.logLines.length - 800);
    }
    const div = document.createElement('div');
    div.textContent = line;
    el.logs.prepend(div);
  };
}

export function bestOfDayLabel(cfg){
  const top = S.bestOfDay.slice(0, Math.max(1, Math.min(20, cfg.topN)));
  if (!top.length) return '—';
  return top.map(x => `${x.symbol}(${x.pct.toFixed(1)}%)`).join(', ');
}

export function renderPending(el, acceptPending, rejectPending){
  el.askList.innerHTML = '';
  if (!S.pending.length){
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.innerHTML = `<div class="head"><div><b>Nenhuma opção pendente.</b><div class="small">No modo ASK, score ∈ [7,9) aparece aqui.</div></div></div>`;
    el.askList.appendChild(empty);
    return;
  }

  for (const p of S.pending){
    const div = document.createElement('div');
    div.className = 'item';
    const tagClass = p.signal === 'BUY' ? 'buy' : 'sell';
    div.innerHTML = `
      <div class="head">
        <div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <span class="tag ask">ASK</span>
            <span class="tag ${tagClass}">${p.signal}</span>
            <span class="small">${p.symbol} · ${p.interval} · score <b>${p.score.toFixed(2)}</b> · <b class="mono">${(p.riskMult ?? 1).toFixed(2)}x</b></span>
          </div>
          <div class="small" style="margin-top:6px">Entry: <b class="mono">${fmtPx(p.entry)}</b> · Stop: <b class="mono">${fmtPx(p.stop)}</b> · Target: <b class="mono">${fmtPx(p.target)}</b> · ATR: <b class="mono">${fmtPx(p.atr)}</b></div>
          <div class="small mono" style="margin-top:6px; opacity:.9">Motivos: ${p.reasons.join(' | ')}</div>
        </div>
        <div class="btns">
          <button class="secondary" data-act="reject" data-id="${p.id}">Rejeitar</button>
          <button data-act="accept" data-id="${p.id}">Aceitar</button>
        </div>
      </div>
    `;
    el.askList.appendChild(div);
  }

  el.askList.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      if (act === 'accept') acceptPending(id);
      else rejectPending(id);
    });
  });
}

export function renderOpen(el, closeTradeByIdMarket, getCfg){
  const cfg = getCfg();
  el.openList.innerHTML = '';
  if (!S.open.length){
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.innerHTML = `<div class="head"><div><b>Nenhuma operação aberta.</b><div class="small">Trades em andamento aparecem aqui.</div></div></div>`;
    el.openList.appendChild(empty);
    return;
  }

  const copy = [...S.open];
  copy.sort((a,b) => {
    const pa = (typeof a.lastPrice === 'number') ? a.lastPrice : a.entry;
    const pb = (typeof b.lastPrice === 'number') ? b.lastPrice : b.entry;
    return Math.abs(a.target - pa) - Math.abs(b.target - pb);
  });

  for (const t of copy){
    const price = (typeof t.lastPrice === 'number') ? t.lastPrice : null;
    const dir = t.side === 'BUY' ? 1 : -1;
    const upnl = (typeof price === 'number') ? dir * (price - t.entry) * t.qty : 0;
      const pnlColor = upnl >= 0 ? 'rgba(34,197,94,.95)' : 'rgba(239,68,68,.95)';

    const rr = Math.abs(t.target - t.entry) / Math.max(1e-9, Math.abs(t.entry - t.stop));
    const tagClass = t.side === 'BUY' ? 'buy' : 'sell';

    const prog = (typeof price === 'number') ? progressPct(t, price) : 0;

      // barra centrada: 0 no meio, vai para direita (positivo) ou esquerda (negativo)
      const leftW  = prog < 0 ? Math.min(50, (-prog/100) * 50) : 0;
      const rightW = prog > 0 ? Math.min(50, ( prog/100) * 50) : 0;

    let pct = 0;
    if (typeof price === 'number'){
      const pnl = applyPnL(t.qty, t.side, t.entry, price);
      const notional = Math.max(1e-9, Math.abs(t.entry * t.qty));
      pct = (pnl / notional) * 100;
    }
    let closeNetUsd = 0;
    let closeBtnClass = 'closeBtn closeNeutral';
    if (typeof price === 'number'){
      const closeSide = t.side === 'BUY' ? 'SELL' : 'BUY';
      const closeExec = applyExecutionModel(closeSide, price, cfg);
      const grossNow = applyPnL(t.qty, t.side, t.entry, closeExec);
      const feePct = Number.isFinite(Number(t.feePctUsed)) ? Number(t.feePctUsed) : resolveTradeFeePct(cfg);
      const feeExit = calcFeeUsd(Math.abs(closeExec * t.qty), feePct);
      const feeEntryRem = Math.max(0, Number(t.feeEntryUsdRemaining || 0));
      const taxable = grossNow - feeEntryRem - feeExit;
      // Regra solicitada: considerar IR fixo de 15% no fechamento para classificar o botão.
      const taxNow = taxable > 0 ? taxable * 0.15 : 0;
      closeNetUsd = grossNow - feeEntryRem - feeExit - taxNow;
      if (closeNetUsd > 0.005) closeBtnClass = 'closeBtn closeProfit';
      else if (closeNetUsd < -0.005) closeBtnClass = 'closeBtn closeLoss';
    }
    const closeLabel = `Fechar ${fmtUSD(closeNetUsd)}`;
    const closeTitle = 'Estimativa líquida no fechamento agora (inclui taxa Binance e IR 15%).';

    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="head">
        <div style="flex:1; min-width:280px">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <span class="tag ${tagClass}">${t.side}</span>
            <span class="small">${t.symbol} · ${t.interval} · qty <b class="mono">${t.qty.toFixed(6)}</b></span>
            <span class="small">R/R <b class="mono">${rr.toFixed(2)}</b></span>
            <span class="small">uPnL <b class="mono" style="color:${pnlColor}">${fmtUSD(upnl)}</b></span>
            <span class="small">uPnL% <b class="mono" style="color:${pnlColor}">${pct.toFixed(2)}%</b></span>
            <span class="small">RISKx <b class="mono">${(t.riskMult ?? 1).toFixed(2)}</b></span>
            ${t.partialDone ? `<span class="tag ok">partial OK</span>` : ``}
            ${S.locked ? `<span class="tag lock">locked</span>` : ``}
          </div>

          <div class="small" style="margin-top:6px">
            Entry: <b class="mono">${fmtPx(t.entry)}</b> · Stop: <b class="mono">${fmtPx(t.stop)}</b> · Target: <b class="mono">${fmtPx(t.target)}</b>
            ${typeof price === 'number' ? ` · Last: <b class="mono">${fmtPx(price)}</b>` : ``}
          </div>

          <div class="pwrap">
            <div class="pbar">
              <div class="fillL" style="width:${leftW}%"></div>
              <div class="fillR" style="width:${rightW}%"></div>
              <div class="mid"></div>
            </div>
            <div class="pmeta">
              <span>-100 <span class="small">(stop)</span></span>
              <span><b class="mono">${prog.toFixed(0)}</b></span>
              <span>+100 <span class="small">(target)</span></span>
            </div>
          </div>

          <div class="small" style="margin-top:6px">
            Trailing: <b>${t.trailOn ? 'ON' : 'OFF'}</b> · BE: <b>${t.movedBE ? 'OK' : '—'}</b> · Risk: <b class="mono">${fmtUSD(t.riskUsd)}</b>
          </div>
        </div>

        <div style="display:flex; gap:10px; align-items:center; justify-content:flex-end;">
          <button class="${closeBtnClass}" data-act="close" data-id="${t.id}" title="${closeTitle}">${closeLabel}</button>
          <div class="tag">aberta ${ts(t.openedAt)}</div>
        </div>
      </div>
    `;
    el.openList.appendChild(div);
  }

  el.openList.querySelectorAll('button[data-act="close"]').forEach(btn => {
    btn.addEventListener('click', () => closeTradeByIdMarket(btn.getAttribute('data-id')));
  });
}

export function updateUI(el, getCfg, renderFns){
  const cfg = getCfg();
  const equity = computeEquity();
  const baseCash = Number(S.initialCash || 100);
  const pl = equity - baseCash;
  const dd = ddPctCash();

  el.kCash.textContent = fmtUSD(S.cash);
  el.kEquity.textContent = fmtUSD(equity);
  el.kPL.textContent = fmtUSD(pl);

  const unrealized = equity - S.cash;
  el.kRealized.textContent = fmtUSD(S.realizedUsd);
  el.kGrossWin.textContent = fmtUSD(S.grossWinUsd);
  el.kGrossLoss.textContent = fmtUSD(S.grossLossUsd);
  el.kUnrealized.textContent = fmtUSD(unrealized);

  // ===== Taxas / Impostos (FeesService) =====
  const feesSnap = computeFeesSnapshot(S, cfg);
  const { feesUsd: fees, taxReservedUsd: taxRes, taxPaidUsd: taxPaid, grossUsd, netUsd, offSpreadUsd, pixFeeBrl, netAfterOff } = feesSnap;

  if (el.kGrossUsd) el.kGrossUsd.textContent = fmtUSD(grossUsd);
  if (el.kFees) el.kFees.textContent = fmtUSD(-fees);
  if (el.kTaxRes) el.kTaxRes.textContent = fmtUSD(-taxRes);
  if (el.kTaxPaid) el.kTaxPaid.textContent = fmtUSD(-taxPaid);
  if (el.kNet) el.kNet.textContent = fmtUSD(netUsd);

  if (el.kOffSpread) el.kOffSpread.textContent = fmtUSD(-offSpreadUsd);
  if (el.kPixFeeBrl) el.kPixFeeBrl.textContent = pixFeeBrl.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2});
  if (el.kNetAfterOff) el.kNetAfterOff.textContent = fmtUSD(netAfterOff);

  el.kDD.textContent = fmtPct(dd);
  el.kWL.textContent = `${S.wins} / ${S.losses}`;
  el.kStreak.textContent = String(S.lossStreak);
  el.kOpen.textContent = `${S.open.length} / ${cfg.maxOpen}`;
  if (el.openCount) el.openCount.textContent = `Ativos: ${S.open.length} / ${cfg.maxOpen}`;

  el.kSym.textContent = S.lastSymbol || '—';
  el.kPrice.textContent = (typeof S.lastPrice === 'number') ? fmtPx(S.lastPrice) : '—';
  el.kSignal.textContent = `${S.lastSignal}`;
  el.kScore.textContent = Number.isFinite(S.lastScore) ? S.lastScore.toFixed(2) : '—';
  el.kReasons.textContent = (S.lastReasons && S.lastReasons.length) ? S.lastReasons.join(' | ') : '—';
  el.kBestList.textContent = renderFns.bestOfDayLabel(cfg);

  const shouldLock = S.locked || dd >= cfg.maxDailyDD;
  if (dd >= cfg.maxDailyDD){
    S.locked = true;
    S.lockType = 'DD';
    S.lockReason = `Daily DD ${dd.toFixed(2)}% ≥ limite ${cfg.maxDailyDD}%`;
  }

  el.kLock.textContent = shouldLock ? 'ON' : 'OFF';
  el.lockBanner.classList.toggle('on', shouldLock);
  el.lockReason.textContent = S.lockReason || 'Bloqueado por regra de segurança.';
  if (el.btnUnlock) el.btnUnlock.disabled = !shouldLock;
  if (el.btnFocusUnlockDD) el.btnFocusUnlockDD.disabled = !shouldLock;

  // Popup de bloqueio (aparece quando entra em estado de bloqueio)
  if (typeof S._prevLocked === 'undefined') S._prevLocked = false;
  if (shouldLock && !S._prevLocked){
    showLockModal(el, S);
  }
  if (!shouldLock) hideLockModal(el);
  S._prevLocked = shouldLock;


  el.dot.className = `dot ${S.running ? 'on' : 'off'}`;
  el.runLabel.textContent = `Loop: ${S.running ? 'ON' : 'OFF'}`;
  setConfigInputsDisabled(el, S.running);
  if (el.cfgLockHint){
    el.cfgLockHint.textContent = S.running
      ? 'Config travada (aplica no próximo run)'
      : 'Config: editável';
    el.cfgLockHint.classList.toggle('warn', S.running);
  }

  const selectedPreset = String(S.intervalPreset || '-');
  const runningPreset = String(S.runningProfile || selectedPreset);
  const strategyPreset = String(cfg.selectedPresetId || S.selectedPresetId || 'NONE');
  el.profileLabel.textContent = S.running
    ? `Preset selecionado: ${selectedPreset} · Strategy: ${strategyPreset} · Rodando: ${runningPreset}`
    : `Preset selecionado: ${selectedPreset} · Strategy: ${strategyPreset}`;

  el.btnTestMode.textContent = `Modo Teste: ${S.testMode ? 'ON' : 'OFF'}`;
  el.btnFocus.textContent = `Modo Foco: ${S.focus ? 'ON' : 'OFF'}`;

  // status
  el.statusLabel.textContent = S.locked ? `Status: BLOQUEADO` : `Status: OK`;

  // Pending and Open trades are rendered inside the Focus Deck now

  el.btnStart.disabled = S.running;
  el.btnStop.disabled = !S.running;
  // duplicated core controls (Focus Widgets)
  if (el.btnFocusStart) el.btnFocusStart.disabled = S.running;
  if (el.btnFocusStop) el.btnFocusStop.disabled = !S.running;
  // Botões do Focus Deck podem ser recriados via innerHTML; evite referência stale.
  const focusTestBtn = document.getElementById('btnFocusTestMode');
  if (focusTestBtn) focusTestBtn.textContent = `Modo Teste: ${S.testMode ? "ON" : "OFF"}`;

}

// =============================
// FOCUS DECK (widgets na coluna esquerda em modo foco)
// =============================
export function renderFocusDeck(el, getCfg, actions){
  if (!el.focusContent) return;
  // Always render the Focus Deck content so tables/abas funcionem
  // even quando o modo foco está OFF (visível por layout).

  const cfg = getCfg();
  const tab = S.focusTab || 'TRADES';
  const symbols = (cfg.symbols || []).filter(Boolean);
  const universeSet = new Set(symbols);

  const esc = (s)=>String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const section = (title, inner) => `
    <div class="focusItem">
      <div class="head"><b>${title}</b><span class="mini">${cfg.interval || ''} · ${symbols.length} moedas</span></div>
      ${inner}
    </div>
  `;

  if (tab === 'TRADES'){
    // render header with bulk actions and a placeholder for the open-trades list
    const header = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
        <div><b>Open trades</b><span class="mini" style="margin-left:8px">${cfg.interval || ''} · Ativos: ${S.open.length} / ${cfg.maxOpen}</span></div>
        <div style="display:flex; gap:8px">
          <button id="focusCloseAllHeader" class="secondary">Fechar tudo</button>
        </div>
      </div>
    `;

    // placeholder where we'll render the open trades using the existing renderOpen module
    const listPlaceholderId = `focusOpenList`;
    el.focusContent.innerHTML = section('Open trades', `${header}<div id="${listPlaceholderId}" class="focusList" style="margin-top:10px"></div>`);

    const placeholder = document.getElementById(listPlaceholderId);
    if (!placeholder) return;

    // Use the existing renderOpen function to populate the placeholder by passing a minimal el object
    try{
      renderOpen({ openList: placeholder }, (actions && actions.closeTradeByIdMarket) ? actions.closeTradeByIdMarket : () => {}, getCfg);
    }catch(e){
      // fallback: show message
      placeholder.innerHTML = `<div class="mini">Erro ao renderizar open trades: ${e?.message||String(e)}</div>`;
    }

    // wire header actions
    if (actions && typeof actions.closeAllOpenMarket === 'function'){
      const b2 = el.focusContent.querySelector('#focusCloseAllHeader');
      if (b2) b2.addEventListener('click', () => actions.closeAllOpenMarket());
    }

    return;
  }

  if (tab === 'MOVERS'){
    const top = (S.bestOfDay||[]).slice(0, Math.max(6, Math.min(20, cfg.topN||6)));
    const inner = top.length
      ? `<div class="focusList" style="margin-top:10px">${top.map(x=>{
          const inU = universeSet.has(x.symbol);
          const badge = inU ? `<span class="tag ok">no universo</span>` : `<span class="tag">fora</span>`;
          const pct = Number(x.pct);
          const cls = pct>=0 ? 'buy' : 'sell';
          return `<div class="focusItem"><div class="head"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="tag ${cls}">${esc(x.symbol)}</span>${badge}</div><b class="mono">${pct.toFixed(1)}%</b></div></div>`;
        }).join('')}</div>`
      : `<div class="mini" style="margin-top:8px">Sem dados do best-of-day ainda. Rode 1x para atualizar.</div>`;
    el.focusContent.innerHTML = section('Top movers (|% 24h|)', inner);
    return;
  }

  if (tab === 'PENDING'){
    const listPlaceholderId = `focusPendingList`;
    const header = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px">
        <div><b>Opções (pendentes)</b><span class="mini" style="margin-left:8px">${cfg.interval || ''} · ${symbols.length} moedas</span></div>
      </div>
    `;
    el.focusContent.innerHTML = section('Pendentes', `${header}<div id="${listPlaceholderId}" style="margin-top:10px"></div>`);
    const placeholder = document.getElementById(listPlaceholderId);
    if (!placeholder) return;

    // Use existing renderPending to populate the placeholder
    try{
      const acceptFn = (actions && typeof actions.acceptPending === 'function') ? actions.acceptPending : (()=>{});
      const rejectFn = (actions && typeof actions.rejectPending === 'function') ? actions.rejectPending : (()=>{});
      renderPending({ askList: placeholder }, acceptFn, rejectFn);
    }catch(e){
      placeholder.innerHTML = `<div class="mini">Erro ao renderizar pendentes: ${e?.message||String(e)}</div>`;
    }

    return;
  }


  if (tab === 'FEES'){
    const feesSnap = computeFeesSnapshot(S, cfg);
    const { feesUsd: fees, taxReservedUsd: taxRes, taxPaidUsd: taxPaid, grossUsd, netUsd, offSpreadUsd, pixFeeBrl, netAfterOff } = feesSnap;

    const inner = `
      <div class="focusGrid" style="margin-top:10px">
        <div class="focusK"><div class="t">Bruto equivalente</div><div class="v">${fmtUSD(grossUsd)}</div></div>
        <div class="focusK"><div class="t">Taxas acumuladas</div><div class="v">${fmtUSD(-fees)}</div></div>
        <div class="focusK"><div class="t">IR em provisão</div><div class="v">${fmtUSD(-taxRes)}</div></div>
        <div class="focusK"><div class="t">Líquido após provisão</div><div class="v">${fmtUSD(netUsd)}</div></div>
      </div>

      <div class="focusGrid" style="margin-top:12px">
        <div class="focusK"><div class="t">IR já debitado</div><div class="v">${fmtUSD(-taxPaid)}</div></div>
        <div class="focusK"><div class="t">Spread saque (est.)</div><div class="v">${fmtUSD(-offSpreadUsd)}</div></div>
        <div class="focusK"><div class="t">PIX (BRL)</div><div class="v">${pixFeeBrl.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2})}</div></div>
        <div class="focusK"><div class="t">Após saque (est.)</div><div class="v">${fmtUSD(netAfterOff)}</div></div>
      </div>

      <div class="mini" style="margin-top:10px">
        Dica: se você faz muitos trades pequenos, <b>taxa fixa de saque</b> pode “comer” o lucro. Acumule e saque em lotes maiores.
      </div>
    `;
    el.focusContent.innerHTML = section('Taxas', inner);
    return;
  }

  if (tab === 'STATS'){
    const agg = new Map();
    for (const t of S.open){
      const p = (typeof t.lastPrice==='number')?t.lastPrice:t.entry;
      const pnl = applyPnL(t.qty, t.side, t.entry, p);
      const row = agg.get(t.symbol) || {symbol:t.symbol, n:0, upnl:0};
      row.n += 1; row.upnl += pnl; agg.set(t.symbol, row);
    }
    const rows = Array.from(agg.values()).sort((a,b)=>Math.abs(b.upnl)-Math.abs(a.upnl));
    const dd = ddPctCash();
    const inner = `
      <div class="focusGrid" style="margin-top:10px">
        <div class="focusK"><div class="t">Open trades</div><div class="v">${S.open.length} / ${cfg.maxOpen}</div></div>
        <div class="focusK"><div class="t">Lock</div><div class="v">${S.locked ? 'ON' : 'OFF'}</div></div>
        <div class="focusK"><div class="t">Daily DD (saldo)</div><div class="v">${fmtPct(dd)}</div></div>
        <div class="focusK"><div class="t">Universo</div><div class="v">${cfg.universeMode} · ${symbols.length}</div></div>
      </div>
      <div class="focusList" style="margin-top:12px">
        ${rows.length ? rows.map(r=>{
          const cls = r.upnl>=0?'buy':'sell';
          return `<div class="focusItem"><div class="head"><span class="tag ${cls}">${esc(r.symbol)}</span><span class="mini">${r.n} trades</span><b class="mono">${fmtUSD(r.upnl)}</b></div></div>`;
        }).join('') : `<div class="mini">Sem exposição por símbolo (nenhum trade aberto).</div>`}
      </div>
    `;
    el.focusContent.innerHTML = section('Stats', inner);
    return;
  }
}

function showLockModal(el, S){
  if (!el.lockModal) return;
  el.lockModal.classList.remove('hidden');
  // conteúdo
  if (el.lockModalTitle) el.lockModalTitle.textContent = '🚨 Sistema bloqueado';
  const reason = S.lockReason || 'Bloqueado por regra de segurança.';
  const msg = [
    `Motivo: ${reason}`,
    '',
    '• O robô NÃO vai criar novas ordens enquanto estiver bloqueado.',
    '• As ordens abertas continuam sendo monitoradas (stop/target/trailing/BE/time-stop/parcial) até serem fechadas.',
    '• Para voltar a operar, use o botão Desbloquear no módulo de Controles.'
  ].join('\n');

  if (el.lockModalBody) el.lockModalBody.textContent = msg;

  // bind (idempotente)
  if (!el._lockModalBound){
    el._lockModalBound = true;
    el.lockModalClose?.addEventListener('click', () => hideLockModal(el));
    el.lockModalGoControls?.addEventListener('click', () => {
      hideLockModal(el);
      document.getElementById('controlsCard')?.scrollIntoView({behavior:'smooth', block:'start'});
    });
    // click backdrop
    el.lockModal.addEventListener('click', (ev) => {
      if (ev.target === el.lockModal) hideLockModal(el);
    });
  }
}

function hideLockModal(el){
  if (!el.lockModal) return;
  el.lockModal.classList.add('hidden');
}
