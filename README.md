# conty-script-review

API de revisão de roteiro da Conty. O criador envia o roteiro, a marca pede alteração (com motivo e prazo) ou aprova, o criador manda outra versão. Cada versão fica guardada e o estado é sempre explícito. Sem vídeo, upload ou interface.

## Como rodar

Requer Node 22.13 ou superior (`node:sqlite` sem flag). Só confirmei em Node 24; 22.13 é o mínimo declarado, não testado.

```bash
npm install
npm test            # vitest, relógio controlado
npm run typecheck
npm run dev         # http://127.0.0.1:3003 (PORT muda a porta)
```

`DB_PATH` define o arquivo SQLite (padrão `./data/script-review.sqlite`; os testes usam `:memory:`). Ver `.env.example`.

## Estados e transições

| De | Ação | Quem | Para |
|---|---|---|---|
| (novo) | `POST /scripts` | creator | `awaiting_review` (versão 1) |
| `awaiting_review` | `POST /scripts/:id/change-requests` | brand | `changes_requested` |
| `awaiting_review` | `POST /scripts/:id/approve` | brand | `approved` |
| `changes_requested` | `POST /scripts/:id/versions` | creator | `awaiting_review` (versão N+1) |
| `changes_requested` | aprovar ou novo pedido | brand | 409 (há pedido aberto) |
| `approved` | qualquer escrita | qualquer | 409 (aprovação não reabre) |

`GET /scripts/:id` devolve o estado, todas as versões, todos os pedidos, o pedido aberto e a flag `overdue`.

## Quem faz o quê

O header `x-actor: brand` ou `x-actor: creator` diz quem age, e a permissão é checada no domínio (403). **Isto não é autenticação**: qualquer cliente pode mandar qualquer valor. Header ausente ou desconhecido também dá 403. Leitura (`GET`) não exige header.

## Prazo (America/Sao_Paulo)

- `due_date` é um dia civil `YYYY-MM-DD`, no fuso da marca. O dia inteiro vale: às 23:59:59.999 de São Paulo o prazo de hoje ainda é aceito.
- "Hoje" vem de `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })`, nunca do corte da string ISO em UTC. Às 21h de SP o UTC já está no dia seguinte, e isso não muda o dia da marca.
- Prazo anterior a hoje: 422 `prazo já passou` (limite testado: `2026-03-13T02:59:59.999Z` aceita `2026-03-12`, `03:00:00.000Z` dá 422). Data malformada ou inexistente (`2026-02-30`): 400.
- Prazo vencido sem nova versão não muda o estado. O `GET` mostra `overdue: true` (pedido aberto e hoje em SP maior que `due_date`). O criador ainda pode enviar a versão atrasada.

## Exemplos

Respostas abaixo encurtadas (`...`), a real traz todos os campos.

```bash
# 1. criador envia o roteiro
curl -X POST localhost:3003/scripts -H 'x-actor: creator' -H 'content-type: application/json' \
  -d '{"campaign_id":"camp-1","creator_id":"cr-1","content":"Abertura com o produto na mão..."}'
# 201
# {"id":"283fd9a3-...","campaign_id":"camp-1","creator_id":"cr-1","status":"awaiting_review",
#  "overdue":false,"current_version":1,"open_change_request":null,
#  "versions":[{"number":1,"content":"Abertura com o produto na mão...","created_at":"..."}],"change_requests":[]}

# 2. marca pede alteração
curl -X POST localhost:3003/scripts/$ID/change-requests -H 'x-actor: brand' -H 'content-type: application/json' \
  -d '{"reason":"Tirar a menção ao preço","due_date":"2026-10-12"}'
# 201
# {"id":"283fd9a3-...","status":"changes_requested","overdue":false,"current_version":1,
#  "open_change_request":{"id":"ca77c7cf-...","version_number":1,"reason":"Tirar a menção ao preço",
#   "due_date":"2026-10-12","resolved_by_version":null,"overdue":false,"created_at":"..."}, ...}

# 3. criador envia a versão 2 (resolve o pedido)
curl -X POST localhost:3003/scripts/$ID/versions -H 'x-actor: creator' -H 'content-type: application/json' \
  -d '{"content":"Nova abertura, sem preço"}'
# 201  {"status":"awaiting_review","current_version":2,"open_change_request":null,
#       "versions":[{"number":1,...},{"number":2,...}],"change_requests":[{... "resolved_by_version":2}], ...}

# 4. marca aprova
curl -X POST localhost:3003/scripts/$ID/approve -H 'x-actor: brand'
# 200  {"status":"approved", ...}
```

Erros (corpo sempre `{"error": "..."}`):

```bash
# nova versão depois de aprovado
# 409 {"error":"roteiro já aprovado; a aprovação não reabre"}

# pedido com pedido já aberto
# 409 {"error":"há um pedido de alteração aberto; o criador precisa enviar uma nova versão antes"}

# prazo de ontem
# 422 {"error":"prazo já passou: escolha hoje ou uma data futura (America/Sao_Paulo)"}

# criador tentando pedir alteração
# 403 {"error":"ator sem permissão para esta ação (use o header x-actor: brand ou creator)"}

# motivo vazio
# 400 {"error":"reason (motivo) é obrigatório e não pode ser vazio"}
```

Ordem de checagem: ator (403), roteiro existe (404), corpo (400), estado (409), prazo passado (422).

## Estrutura

- `src/dates.ts`: dia civil de SP e validação do prazo (puro).
- `src/domain.ts`: permissões, transições e `overdue` (puro, sem Hono nem SQL).
- `src/db.ts`: schema SQLite e consultas. Índice único garante no máximo um pedido aberto por roteiro.
- `src/app.ts`: HTTP fino, `createApp({ db, clock })`. Pedido, nova versão e aprovação rodam em transação.
- `.specs/features/script-review/`: requisitos (REV-xx) e tarefas.

## O que ficou de fora

Autenticação real (o `x-actor` é só um rótulo), notificações, edição ou cancelamento de pedido, múltiplos criadores ou marcas por roteiro (não há checagem de que o criador é o dono do roteiro), listagem de roteiros, paginação, vídeo e upload.

## Decisões que eu deixaria diferentes com mais tempo

- Trocar `x-actor` por autenticação de verdade, com o ator ligado ao `creator_id` do roteiro e à marca da campanha.
- Dar à marca uma forma de retirar um pedido (hoje um pedido só se resolve com nova versão) e de estender prazo.
- `overdue` é calculado na leitura. Se alguém precisar de lembrete ou fila de atrasados, isso vira consulta/índice por `due_date` ou um job, e provavelmente um evento.
- O prazo vale até o fim do dia de SP para todas as marcas. Fuso por marca exigiria guardar o fuso na campanha.
- Sem listagem nem filtros (`GET /scripts?status=`), sem paginação do histórico.
- Sem controle de concorrência além da transação: duas chamadas simultâneas são serializadas pelo SQLite e a segunda recebe 409, mas não há `ETag`/versão otimista para o cliente.
- Textos de erro fixos em PT-BR, sem códigos de erro estáveis para o cliente.

## Uso de IA
- **Feito com IA:** especificação, código e testes escritos com Claude Code (Claude Sonnet 5.5), a partir de decisões do autor tomadas em entrevista (grill) e registradas em `.specs/`.
- **Revisado pelo autor:** TODO(preencher após a revisão humana do diff).
- **Revisão independente:** TODO(preencher após a revisão por agente de contexto limpo).
