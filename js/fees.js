/**
 * FeesService (MVP)
 * ------------------------------------------------------------
 * Centraliza o cálculo/controle de taxas e impostos do paper-trading,
 * mantendo a carteira (cash) aderente ao fluxo real:
 * - taxas reduzem o saldo no momento da execução
 * - imposto pode ser reservado (provisão) ou abatido do saldo
 * Este módulo também fornece decomposição para auditoria e UI.
 *
 * Responsabilidades:
 * - Definir a taxa de trade (%) com base no modo (STANDARD/BNB/CUSTOM)
 * - Calcular fee (USD) a partir do notional (USD)
 * - Registrar taxas pagas no estado (feePaidUsd)
 * - Reservar imposto sobre lucro (taxReservedUsd) e/ou abater do cash (taxPaidUsd)
 *
 * Observação:
 * - Este módulo não faz chamadas externas.
 * - Ele só opera sobre números e sobre o estado compartilhado S.
 */

/**
 * Resolve a taxa de trade (%), em formato numérico (ex.: 0.10 = 0,1%).
 * STANDARD: 0.10%
 * BNB: 0.075%
 * CUSTOM: valor do usuário (0–1%)
 */
export function resolveTradeFeePct(cfg){
  const mode = String(cfg?.feeMode || 'STANDARD').toUpperCase();
  const custom = Math.max(0, Math.min(1, Number(cfg?.feePctCustom || 0)));
  if (mode === 'BNB') return 0.075;
  if (mode === 'CUSTOM') return custom;
  return 0.10;
}

/**
 * Calcula a taxa em USD a partir do notional (USD) e taxa (%).
 * @param {number} notionalUsd Valor nocional (USD). Ex.: qty * price.
 * @param {number} feePct Percentual (ex.: 0.10 = 0,1%).
 * @returns {number} fee em USD (sempre >= 0)
 */
export function calcFeeUsd(notionalUsd, feePct){
  const n = Number(notionalUsd);
  const p = Math.max(0, Number(feePct));
  if (!Number.isFinite(n) || !Number.isFinite(p)) return 0;
  return Math.abs(n) * (p/100);
}

/**
 * Aplica/registrar as taxas de trade no estado e abate do saldo.
 * Convenção: feePaidUsd acumula o total já descontado do cash.
 * @param {object} S Estado compartilhado
 * @param {number} feeUsd taxa em USD (>=0)
 */
export function registerTradeFee(S, feeUsd){
  const f = Number(feeUsd);
  if (!Number.isFinite(f) || f <= 0) return;
  S.feePaidUsd = (Number(S.feePaidUsd)||0) + f;
  S.cash = (Number(S.cash)||0) - f;
}

/**
 * Reserva imposto sobre lucro (apenas quando lucro > 0).
 * - Se taxApplyCash=ON: abate do cash e contabiliza como taxPaidUsd
 * - Caso contrário: apenas reserva em taxReservedUsd (provisão)
 * @returns {number} imposto (USD) calculado e aplicado
 */
export function applyTaxOnProfit(taxableProfitUsd, S, cfg, log){
  if (!cfg?.taxOn) return 0;
  const profit = Number(taxableProfitUsd);
  if (!Number.isFinite(profit) || profit <= 0) return 0;

  const pct = Math.max(0, Number(cfg.taxPct||0))/100;
  const tax = profit * pct;
  if (!Number.isFinite(tax) || tax <= 0) return 0;

  if (cfg?.taxApplyCash){
    S.taxPaidUsd = (Number(S.taxPaidUsd)||0) + tax;
    S.cash = (Number(S.cash)||0) - tax;
  } else {
    S.taxReservedUsd = (Number(S.taxReservedUsd)||0) + tax;
  }

  return tax;
}

/**
 * Calcula métricas de exibição (bruto/líquido) com base no estado e cfg de off-ramp.
 * Não altera estado.
 */
export function computeFeesSnapshot(S, cfg){
  const fees = Number(S.feePaidUsd)||0;
  const taxRes = Number(S.taxReservedUsd)||0;
  const taxPaid = Number(S.taxPaidUsd)||0;
  const cash = Number(S.cash)||0;
  const grossUsd = cash + fees + taxPaid;
  const netUsd = cash - taxRes;

  const offSpreadPct = Number(cfg?.offRampSpreadPct)||0;
  const fxUsdBrl = Math.max(1e-9, Number(cfg?.fxUsdBrl)||5.0);
  const pixFeeBrl = Math.max(0, Number(cfg?.offRampPixFeeBrl)||0);

  const offSpreadUsd = netUsd * (offSpreadPct/100);
  const pixFeeUsd = pixFeeBrl / fxUsdBrl;
  const netAfterOff = netUsd - offSpreadUsd - pixFeeUsd;

  return {
    feesUsd: fees,
    taxReservedUsd: taxRes,
    taxPaidUsd: taxPaid,
    grossUsd,
    netUsd,
    offSpreadUsd,
    pixFeeUsd,
    pixFeeBrl,
    netAfterOff
  };
}
