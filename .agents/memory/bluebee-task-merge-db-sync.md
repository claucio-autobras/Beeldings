---
name: Task merges don't apply migrations or regenerate Prisma client on main
description: After a task agent merge that adds a Prisma model/migration, the main repl's DB and generated client are stale until manually synced.
---

# Sintoma
Feature nova de um merge "não retorna nada" / tela vazia, sem erro visível na UI
(ex.: Relatório de Auditoria vazio mesmo após ações do usuário).

# Causa raiz
O task agent roda em ambiente isolado (banco próprio + Prisma Client próprio).
No merge vêm apenas os arquivos versionados: `schema.prisma`, a pasta
`prisma/migrations/<nova>` e o código. O `scripts/post-merge.sh` só roda
`npm install` — **não** roda `prisma migrate deploy` nem `prisma generate`.
Resultado no repl principal:
- a tabela nova **não existe** no Postgres (migration pendente);
- o `@prisma/client` gerado em `node_modules` **não tem** o modelo novo
  (`prisma.<model>` é `undefined`).

Se o serviço que grava é fire-and-forget (ex.: AuditService.record), ele engole
o erro e nada é gravado → tela fica vazia sem pista.

**Why:** node_modules e o estado do banco não são merge-áveis; só os arquivos são.
O isolamento dos task agents esconde o passo de sincronização do banco/client.

# Como corrigir (no repl principal, após o merge)
```
cd apps/backend
npx prisma migrate status      # confirma migration pendente
npx prisma migrate deploy      # cria tabela/enum no banco principal
npx prisma generate            # regenera o client com o modelo novo
```
Depois reiniciar o workflow "Start Backend" para carregar o novo client.

# Como verificar
- Tabela real pode ter @@map (ex.: model `AuditLog` → tabela `audit_logs`);
  cheque o nome no `migration.sql`, não assuma o nome do model.
- `rg -c "<model>" node_modules/.prisma/client/index.d.ts` deve ser > 0.
- Disparar uma ação real e contar linhas via `prisma.<model>.count()`.

# Prevenção
Considerar adicionar `npx prisma migrate deploy && npx prisma generate` ao
`scripts/post-merge.sh` (idempotente) para qualquer merge futuro com migration.
