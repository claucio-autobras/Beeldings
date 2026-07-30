---
name: BlueBee auth (local, sem Supabase)
description: Como a autenticação do BlueBee funciona após sair do Supabase, e a consequência para usuários existentes.
---

# Autenticação BlueBee — local contra Postgres do Replit

Decisão (escolha do usuário, "opção B"): **remover o Supabase Auth** e autenticar
localmente. Os **dados sempre estiveram no Postgres do Replit** (Prisma); o Supabase
era usado **apenas** em dois pontos: `login` (verificar senha) e `register` (criar
usuário). O JWT sempre foi emitido/validado pelo **próprio backend** via `JWT_SECRET`
(a `JwtStrategy` busca o usuário por `id`, nunca chamou o Supabase para validar token).

**Como ficou:** `login()` busca por email e usa `bcrypt.compare` contra
`User.passwordHash` (campo novo, nullable). `register()` faz `bcrypt.hash` e cria com
`supabaseId = randomUUID()` — a coluna `supabase_id` (NOT NULL unique) foi **mantida
como id legado** só para não quebrar os tipos do frontend (`supabaseId: string`).

**Consequência crítica (não óbvia):** ao sair do Supabase, **as senhas dos usuários
existentes somem** — elas viviam no Supabase, não no Postgres. Toda conta antiga fica
com `passwordHash = null` e **não consegue mais logar** até receber uma senha. A
migração só faz `ADD COLUMN`; não há como recuperar as senhas antigas.

**Why:** antes de cortar o Supabase em produção é obrigatório um fluxo de
definição/reset de senha para os usuários legados (ou re-cadastro). Sem isso, ninguém
além do admin re-semeado consegue entrar.

**How to apply:**
- Seed do admin: senha vem de `ADMIN_SEED_PASSWORD`; em `NODE_ENV=production` o seed
  **falha** se a env não existir (sem fallback). Em dev cai num padrão de conveniência.
- `login()` faz um `bcrypt.compare` contra um hash fictício quando o usuário/hash não
  existe, para nivelar o tempo de resposta (anti-enumeração por timing).
- bcryptjs é namespace-style (sem default export) → use `import * as bcrypt`.

## Frontend ↔ backend no Replit (proxy /api)

No Replit o navegador **não alcança `localhost:4000`** (porta do backend não é exposta).
A ligação frontend→backend é feita por **same-origin** via rewrite do Next
(`next.config.ts`: `/api/:path*` → `http://localhost:4000/:path*`).

Para ligar (sair do mock): em `apps/frontend/.env.local` use
`NEXT_PUBLIC_API_URL=/api` e `NEXT_PUBLIC_USE_MOCK=false`. (`.env.local` tem
prioridade sobre env vars do Replit; é onde o flag de mock vive.)

**Three coisas precisam estar alinhadas, senão quebra silenciosamente:**
1. `NEXT_PUBLIC_API_URL=/api` — todos os serviços montam `${API_URL}${path}`.
2. **Middleware de auth deve liberar `/api`** (`src/middleware.ts`): sem isso o
   `/api/auth/login` é redirecionado 307→/login (o middleware roda antes do rewrite)
   e o login nunca chega ao backend. O JWT é validado pelo backend via header.
3. **Socket.IO** (telemetria e alarmes): conectar em `window.location.origin` com
   `path: '/api/socket.io'` e namespace `/telemetry` — nunca `hostname:4000` direto.

**Why:** porta 4000 inacessível ao browser no Replit; o rewrite é o único caminho.
NEXT_PUBLIC_* são inlined em build — exige restart do workflow do frontend para valer.

### Socket.IO pelo proxy do Next exige 2 ajustes no next.config (senão "Desconectado")

O engine.io faz o handshake em `<path>/?EIO=4...` — sempre com **barra final**:
`/api/socket.io/?EIO=4`. Dois problemas matam a conexão (cliente fica "Desconectado",
telas mostram "Sem resposta da controladora" apesar do backend receber telemetria):
1. Sem `skipTrailingSlashRedirect: true`, o Next responde **308** removendo a barra
   final e o cliente Socket.IO **não segue o redirect** → handshake nunca completa.
2. O rewrite genérico `/api/:path*` **perde a barra final** (`:path*` não a captura),
   então chega `/socket.io` (sem barra) no backend → **404** "Cannot GET /socket.io".

Correção (ambos necessários): `skipTrailingSlashRedirect: true` **+** um rewrite
dedicado e ANTES do genérico: `/api/socket.io/` → `http://localhost:4000/socket.io/`.
Validar com `curl /api/socket.io/?EIO=4&transport=polling` → deve dar 200 + `0{"sid"...}`.
Polling e upgrade p/ websocket funcionam pelo rewrite. Sintoma clássico de regressão:
controladora "Online" mas todos os pontos "Sem resposta da controladora".

**Why:** sem isso a telemetria em tempo real nunca chega ao navegador no Replit.

### Comando BACnet (DO) "funciona mas mostra 'gateway não respondeu a tempo'"

WriteProperty BACnet é serviço **confirmado**: o gateway só publica em
`bluebee/{t}/gateway/{g}/commands/result` depois que o node-bacnet recebe (ou
desiste) do SimpleACK do controlador. Com os defaults do node-bacnet
(apduTimeout ~3s × até 3 retries), o callback do write pode levar **até ~12s**
mesmo quando o relé JÁ atuou (1º ACK perdido). Se o timeout do backend
(`bacnet-write.service.ts WRITE_TIMEOUT_MS`) for ≤ esse pior caso, o backend
desiste antes, deleta o `pendingWrites`, retorna timeout e **ignora** o resultado
de sucesso que chega depois → UI mostra "gateway não respondeu a tempo" apesar
de ter funcionado. Regra: manter `WRITE_TIMEOUT_MS` **acima** do pior caso do
gateway (~12s) + margem MQTT (usar ~20s). O frontend usa `fetch` sem timeout e o
endpoint sempre responde HTTP 200 (sucesso vem em `data.success`), então o único
gargalo é o timeout do backend — não há limite menor no cliente.

Correlato: `command_id` deve ser `randomUUID()` (não `Date.now()`) — dois writes
no mesmo ms colidiriam no `pendingWrites` e deixariam uma requisição pendurada.

**Why:** controlar carga real depende de feedback de comando correto; falso
timeout num comando que funcionou mina a confiança do operador.

#### Causa raiz definitiva: SimpleACK do WriteProperty não é reconhecido (confirmar por releitura)

Aumentar timeout e adicionar retry NÃO resolveu o falso timeout. Causa real: o
WriteProperty é serviço confirmado e o **node-bacnet 0.2.4 não recebe/reconhece
o SimpleACK de forma confiável** — o relé atua, mas o callback do write nunca
volta com sucesso, então o gateway nunca confirma. Retry não conserta um ACK que
nunca chega. Pista decisiva: as **leituras funcionam** (o polling via
`readPropertySafe` alimenta a telemetria com valores ao vivo), logo o caminho
gateway↔controlador e o parsing de resposta funcionam para ReadProperty.

Correção (gateway `bacnet-write.service.ts`): no `catch` de cada tentativa de
write, fallback `confirmByReadback(command)` que relê o `presentValue` (prop 85)
e compara com o valor comandado — igualdade exata p/ digitais (BI/BO/BV/MSI/MSO),
tolerância `max(0.5, 1%)` p/ analógicos (AI/AO/AV). Se bate → publica
`success:true` (efeito físico aplicado apesar do ACK perdido). Mantém o caminho
rápido do ACK quando ele chega. Extração igual à do polling:
`response.values[0].value`.

Limites conhecidos (aceitáveis p/ DO idempotente): falso positivo se o valor já
estava no alvo antes do comando; falso negativo se uma prioridade BACnet mais
alta mascarar o presentValue. Orçamento de pior caso ≈ 2×(4s write + 0.3s +
2s readback) ≈ 12,6s — cabe sob `WRITE_TIMEOUT_MS` do backend (20s); cuidado ao
elevar `BACNET_WRITE_RETRIES`/timeouts por env (pode estourar os 20s).

**Why:** o ACK do node-bacnet é um caminho quebrado/instável p/ write; a única
confirmação confiável é o estado real lido do device, que comprovadamente
funciona.
