# Refatoracao Proposta (pequenos commits)

## Commit 1 - Unificar fechamento manual com engine
Arquivos:
- `js/app.js`
- `js/engine.js`

Mudanca:
- `closeTradeByIdMarket` passou a chamar `closeTrade(...)` do engine.

Por que:
- Remove duplicacao de regra contabillistica.
- Evita divergencia entre fechamento automatico e manual.

Risco:
- Mudanca de comportamento em operacoes manuais (agora inclui taxa/imposto como esperado).

## Commit 2 - Padronizar logs de auditoria
Arquivos:
- `js/state.js`
- `js/app.js`
- `js/engine.js`

Mudanca:
- Novo `runId` em estado.
- Eventos de execucao e trades no formato `[AUDIT][EVENT] campo=valor`.
- Inclusao de taxa por trade (entrada/saida/acumulada) e imposto por fechamento.

Por que:
- Facilita trilha de auditoria e reconciliacao de PnL.
- Contexto de execucao fica rastreavel por sessao (`runId`).

Risco:
- Logs ficam mais verbosos; pode exigir filtro no consumidor.

## Commit 3 - Remocao de redundancias e parametros sem efeito
Arquivos:
- `js/engine.js`
- `js/app.js`
- `js/ui.js`

Mudanca:
- `ddPctCash(cfg)` -> `ddPctCash()` (parametro inutil removido).
- Removido calculo local `feePct` em `getCfg` (nao era usado).
- Removidas dependencias de `window.Fees` no frontend principal.
- Uso direto de `resolveTradeFeePct(cfg)` no filtro de edge.

Por que:
- Reduz acoplamento global implícito (`window.*`).
- Remove codigo morto e melhora legibilidade/manutenibilidade.

Risco:
- Baixo. Mudancas sao locais e com validacao sintatica.

## Backlog recomendado (proximo ciclo)
1. Migrar `js/*.js` para `src/*.ts` com tipos de `Trade`, `Config`, `Decision`, `AuditEvent`.
2. Extrair `tickSymbol` para um `TradeEngineService` puro (sem DOM).
3. Persistir logs `[AUDIT]` em armazenamento externo (arquivo/DB) para auditoria historica.
4. Definir suite minima de testes para:
   - PnL bruto/liquido
   - Fees/tax por parcial e fechamento final
   - Locks de DD e loss streak
