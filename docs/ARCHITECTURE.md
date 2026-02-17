# Arquitetura Atual (Mapeamento)

## Visao Geral
- UI/browser app: `index.html`, `css/styles.css`, `js/*.js`
- Engine de decisao e execucao paper-trading: `js/engine.js`
- Estado compartilhado global: `js/state.js`
- Apresentacao e logs em tela: `js/ui.js`
- Integracao de mercado (Binance publico): `js/binance.js`
- Taxas/impostos (simulacao): `js/fees.js`
- Utilitarios e performance helpers: `js/utils.js`

## Services (Supabase Edge Functions)
- Proxy Binance publico/assinado: `supabase/functions/binance-proxy/index.ts`
- Noticias (CoinDesk RSS + GDELT): `supabase/functions/news-proxy/index.ts`
- Sentimento (Fear & Greed): `supabase/functions/sentiment-proxy/index.ts`
- Macro/snapshot mercado: `supabase/functions/macro-proxy/index.ts`
- Auditoria de execucao por `runId`: `supabase/functions/audit-proxy/index.ts`
- Shared helpers: `supabase/functions/_shared/*`

## Fluxo de Execucao (frontend)
1. `js/app.js` monta UI, le configuracao e inicia o loop.
2. Cada tick busca klines por simbolo e gera decisao via `buildDecision`.
3. `js/engine.js` gerencia abertura/parcial/fechamento e travas de risco.
4. `js/ui.js` renderiza KPIs, Focus Deck e logs (debounced por frame).
5. `js/fees.js` acumula fees/tax e gera snapshot liquido para auditoria visual.

## Logs e Auditoria
- Padrao de eventos com prefixo `[AUDIT]`:
  - `[AUDIT][RUN_START]`
  - `[AUDIT][RUN_STOP]`
  - `[AUDIT][OPEN]`
  - `[AUDIT][PARTIAL]`
  - `[AUDIT][CLOSE]`
- Campos minimos por trade: `run`, `trade`, `symbol`, `interval`, `fee_*`, `tax_usd`, `pnl_usd`, `reason`.
