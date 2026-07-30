---
name: Gateway agent download package
description: How the "Agente de Gateway" download works and the CJS/ESM + deploy constraints behind it
---

# Pacote de download do Agente de Gateway

O frontend (`apps/frontend/.../gateways/services/agent-package.service.ts`) baixa
o agente via `GET /gateways/agent-package?os=linux|windows` com Bearer token. O
endpoint vive no **GatewaysController** (não no ProjectsController), monta um
`.zip` sob demanda e o devolve.

## Decisões duráveis

- **Distribuição por código-fonte, não por .exe.** O pacote contém o `src/` do
  gateway + `package.json`/tsconfig/nest-cli + `.env.example` + `INSTALL.md` +
  scripts de serviço. O cliente roda `npm install` → `npm run build` → instala o
  serviço (NSSM no Windows, systemd no Linux). Existe um caminho paralelo de
  empacotamento via `.exe` (pkg) em `apps/gateway/service` + `package-windows.mjs`
  — **não é** o usado pelo download; não confundir os dois.
  **Why:** os pré-requisitos da UI já exigem Node.js 20+, então o fluxo npm é
  coerente e mais simples de manter que o binário pkg.

- **Backend é CommonJS** (tsconfig `module: nodenext`, sem `"type": "module"` no
  package.json). Logo, dependência **ESM-pura quebra em runtime** no `require`.
  O `archiver` v7+ é ESM puro (`"type":"module"`) → trocado por **`adm-zip`**
  (CJS), importado como `import AdmZip = require('adm-zip')` e gerado em memória
  com `zip.toBuffer()` + `res.end(buffer)` (rota usa `@Res()`, que bypassa o
  interceptor de resposta do Nest — esperado para binário).
  **Why:** custou várias tentativas; o erro de tipos "not callable" do
  `@types/archiver` era sintoma de import incompatível, mas o problema real seria
  no runtime (require de ESM).
  **How to apply:** ao adicionar libs no backend, prefira CJS; para `export =`
  use `import X = require('X')`.

- **Rota estática antes da paramétrica.** `@Get('/agent-package')` precisa ser
  declarado **antes** de `@Get('/:id')` no controller, senão o Nest/Express trata
  "agent-package" como `:id`.

- **Risco de deploy:** `resolveGatewayRoot()` sobe na árvore a partir de
  `process.cwd()` procurando `apps/gateway` (com `package.json` + `src`). Se o
  deploy de produção empacotar **apenas** `apps/backend`, o endpoint retorna 404
  (`NotFoundException`). Garanta que `apps/gateway` esteja presente no filesystem
  do backend em produção (ou publique o pacote em storage).

- **.bat em CRLF.** Scripts Windows (`instalar.bat`/`remover.bat`) devem ficar em
  CRLF (converter com `perl -i -pe 's/(?<!\r)\n/\r\n/g'`). O instalador faz
  `cd /d "%DIR%"` antes do `npm install`/`build` para funcionar mesmo se chamado
  de outro diretório.

- **Autorização:** o download exige só JWT (consistente com `findAll`/`findOne`
  de gateways). O pacote **não contém segredos** — o `gateway-config.env` com
  credenciais MQTT é baixado à parte (rota de projetos). Se um dia for preciso
  restringir a ADMIN/CCO, aplicar RolesGuard.
