# Checklist de Prontidao para Operar com Dinheiro

## O que foi implementado neste ciclo
- Contabilidade realista de taxas:
  - Fee reduz `cash` na execucao (`registerTradeFee`).
- Imposto com dois modos:
  - `taxApplyCash=OFF`: reserva em `taxReservedUsd`.
  - `taxApplyCash=ON`: debita `cash` e acumula em `taxPaidUsd`.
- Simulador de execucao:
  - spread (bps), slippage (bps), latencia (ms) e impacto de latencia (bps/s).
  - preco sempre adverso ao trader (conservador).
- Auditoria persistente:
  - frontend fila e flush por lote (`js/audit.js`).
  - edge function `audit-proxy` para inserir/listar por `runId`.
  - tabela `audit_events` (script SQL em `supabase/sql/001_audit_events.sql`).

## Passos obrigatorios de setup (antes de validar)
1. Aplicar SQL:
   - `supabase/sql/001_audit_events.sql`
2. Deploy da edge function:
   - `supabase/functions/audit-proxy/index.ts`
3. Configurar secrets na function:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. No app, validar:
   - `Auditoria remota = ON`
   - `Endpoint auditoria = /functions/v1/audit-proxy` (ou URL completa do seu projeto)

## Riscos que ainda precisam de fechamento
- Nao ha reconciliacao com fills reais da corretora (somente simulacao local).
- Nao ha retentativa exponencial sofisticada para falha de rede na auditoria.
- Nao ha teste automatizado de regressao para PnL/fees/tax e locks.
- Nao ha controle de risco em backend para envio real de ordens (kill-switch servidor).
