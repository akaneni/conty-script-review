# Revisão de roteiro: requisitos

Origem: enunciado do desafio 03 e decisões do grill (atores por `x-actor`, flag derivada `overdue`, um pedido aberto por vez, SQLite).

## Requisitos

| ID | Requisito | Critério de aceite |
|---|---|---|
| REV-01 | O criador cria um roteiro (versão 1) e ele nasce `awaiting_review`. | `POST /scripts` com `x-actor: creator` devolve 201 com status e versão 1. |
| REV-02 | O roteiro tem estado explícito: `awaiting_review`, `changes_requested`, `approved`. `GET /scripts/:id` mostra estado, versões, pedidos e pedido aberto. | Fluxo completo seguido só pelo GET. |
| REV-03 | A marca pede alteração com `reason` (não vazio após trim) e `due_date` (`YYYY-MM-DD`). | Sem motivo, sem prazo ou prazo malformado/inexistente (ex.: 2026-02-30): 400. |
| REV-04 | O prazo é um dia civil em America/Sao_Paulo; vale se `due_date >= hoje(SP)`; o último instante do dia vale. | 02:59:59.999Z de 13/03 com prazo 12/03: 201. 03:00:00.000Z: 422 "prazo já passou". |
| REV-05 | "Hoje" em SP vem de `Intl.DateTimeFormat('en-CA', { timeZone })`, nunca de `slice` do ISO UTC. | Testes de REV-04 (UTC já virou o dia). |
| REV-06 | `overdue` é derivado: pedido aberto e hoje(SP) > `due_date`. Não muda o estado. | `overdue` false até o fim do dia, true no primeiro instante seguinte; status segue `changes_requested`. |
| REV-07 | O criador envia nova versão só com pedido aberto; a versão resolve o pedido e o roteiro volta a `awaiting_review`. | Sem pedido aberto: 409. Depois do envio, pedido tem `resolved_by_version`. |
| REV-08 | Versões antigas nunca são sobrescritas nem apagadas. | v1 e v2 listadas com conteúdo original. |
| REV-09 | A marca aprova em `awaiting_review`. Aprovado é final: nova versão, novo pedido e nova aprovação dão 409. | Testes de roteiro aprovado. |
| REV-10 | Um pedido aberto por vez: novo pedido ou aprovação com pedido aberto dão 409. | Teste de pedido duplicado. |
| REV-11 | Permissão no domínio: só `creator` cria e envia versão; só `brand` pede alteração e aprova. Header ausente ou inválido também é 403. Não é autenticação. | Testes de permissão. |
| REV-12 | Erros `{ "error": "..." }` em PT-BR: 400, 403, 404, 409, 422. | Testes de contrato. |
| REV-13 | Relógio injetável; persistência em SQLite (`DB_PATH`, `:memory:` nos testes). | `createApp({ db, clock })`. |

## Decisões além da spec do grill
- Ordem de checagem: ator (403) > roteiro existe (404) > corpo (400) > estado (409) > prazo passado (422).
- O pedido e a nova versão (e a transição de estado) acontecem em uma transação.
- `GET /scripts/:id` é leitura aberta (não exige `x-actor`).
- Conteúdo da versão: string não vazia após trim, guardada como veio.

## Fora de escopo
Autenticação real, notificações, edição/cancelamento de pedido, múltiplos criadores/marcas por roteiro, listagem de roteiros, vídeo e upload.
