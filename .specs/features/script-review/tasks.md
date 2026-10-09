# Tarefas

Legenda: [x] concluída. Cada tarefa tem teste primeiro quando a regra é clara.

- [x] T1 Scaffold (package.json, tsconfig, vitest, .gitignore). Verificação: `npm install` e `npm run typecheck`.
- [x] T2 `src/dates.ts`: hoje em SP e validação de `due_date` (REV-03, 04, 05). Depende de T1. Verificação: `test/dates.test.ts`.
- [x] T3 `src/domain.ts`: decisões puras de transição e permissão (REV-07, 09, 10, 11) e `overdue` (REV-06). Depende de T2. Verificação: `test/domain.test.ts`.
- [x] T4 `src/db.ts`: schema e repositório (REV-08, 13). Depende de T1.
- [x] T5 `src/app.ts` + `src/index.ts`: HTTP fino (REV-01, 02, 12). Depende de T3, T4. Verificação: `test/api.test.ts` (fluxo, 400, 403, 404, 409, 422, relógio no limite do dia).
- [x] T6 README com exemplos curl verificados em subida real. Depende de T5.
- [x] T7 Mutações de verificação e fechamento. Depende de T5.
