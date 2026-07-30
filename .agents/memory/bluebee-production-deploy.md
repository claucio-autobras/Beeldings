---
name: BlueBee deploy de produção (Replit VM)
description: Como o deploy de produção está montado e as armadilhas de configuração (env vars vs secrets, .replit, seed).
---

# Deploy de produção — decisões e armadilhas

- Alvo é **VM (sempre ligado)**, não autoscale: o backend mantém assinatura MQTT
  contínua, motor de alarmes e heartbeat de gateways; autoscale desliga/duplica
  instâncias. **Why:** ingestão não tem gating de líder para múltiplas instâncias.
- **Modo artefatos**: ao existirem artifacts registrados (`.replit-artifact/artifact.toml`),
  o Publish IGNORA `.replit [deployment].run` e publica só quem tem
  `[services.production]` — sem registro do app principal, sobe só o vídeo estático
  → 500 em tudo. **Fix:** app principal registrado em `/.replit-artifact/artifact.toml`
  (id `default-start-application`, path `/`) apontando para os mesmos scripts; o
  arquivo é protegido contra edição direta — usar `verifyAndReplaceArtifactToml`
  (criação inicial exigiu stub via fs do sandbox porque o callback só substitui
  arquivo existente).
- Build/run originais viviam em `.replit [deployment]` (hoje só pre-build hook):
  `scripts/build-production.sh` (install + prisma generate + nest build + seed
  compilado p/ JS + next build) e `scripts/start-production.sh` (seed + backend
  4000 + next start 8080→externa 80; `wait -n` derruba tudo se um processo
  morrer para a plataforma reiniciar).
- **NUNCA rodar `prisma migrate deploy` no start de produção**: o Publish da
  Replit já sincroniza o schema prod via diff dev→prod. Rodar migrations em
  cima disso deu "column already exists" → migration marcada como falha em
  `_prisma_migrations` → P3009 em toda subida → crash loop do deploy. Schema
  prod = responsabilidade do fluxo de Publish; para mudar schema, migrar em
  dev e re-publicar. (Sobrou uma linha de migration com falha no
  `_prisma_migrations` de prod — inofensiva sem migrate deploy no start.)
- **`.replit` só pode ser alterado via `verifyAndReplaceDotReplit`** (sandbox
  code_execution); o arquivo temp precisa estar DENTRO do workspace (não /tmp).
- **NUNCA usar `setEnvVars` para senha/segredo**: ele grava em texto puro no
  `.replit` versionado (`[userenv.*]`) — e o `.replit` é espelhado no GitHub do
  Claucio. Senhas → Secrets via `requestEnvVar` (globais, fora do git).
- **nest build gera `dist/src/main.js`, NÃO `dist/main.js`** (o tsconfig inclui
  `prisma/` e `scripts/`, então o rootDir sobe um nível). O start de produção
  deve usar `node dist/src/main.js` — o caminho errado só estoura no deploy
  (ModuleNotFound), não no build.
- Seed de produção: **não roda ts-node em runtime** — o build compila
  `prisma/seed.ts` → `dist-seed/seed.js`. Seed é idempotente e **não sobrescreve
  passwordHash existente** do admin (troca de senha via UI sobrevive a restart);
  exige `ADMIN_SEED_PASSWORD` quando NODE_ENV=production.
- Logger Nest em produção: sem debug/verbose (telemetria MQTT gera uma linha
  DEBUG por mensagem).
- Pendências conscientes pré-go-live: usuários legados sem passwordHash (era
  Supabase) não logam; TLS/mTLS fino, HA líder-único e backpressure adiados.
