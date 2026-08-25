# Sincronização bidirecional com GitHub (BlueBee-Infra)

O repositório `github.com/claucio-autobras/Beeldings` espelha o `main` do Replit e
aceita commits feitos fora do Replit (IDE local). A sincronização é feita por
`scripts/sync-github.sh` e **nunca** envia o histórico completo local (~3,8 GB, exigido
pelos checkpoints do Replit) nem faz force-push depois da base publicada.

## Comandos (rodados no Replit)

| Comando | O que faz |
| --- | --- |
| `scripts/sync-github.sh status` | Mostra se Replit e GitHub estão em dia, à frente, atrás ou divergentes. |
| `scripts/sync-github.sh push` | Reproduz cada commit local desde o último ponto sincronizado como commit normal em cima do `main` remoto (sem force). **Aborta** se o GitHub tiver commits ainda não trazidos — rode `pull` primeiro. |
| `scripts/sync-github.sh push-snapshot` | Publica o estado atual da `main` como um único commit normal. É o comando recomendado quando existem muitos commits locais pendentes; exclui `attached_assets/`, `exports/`, `screenshots/`, vídeos, o artefato de vídeo e saídas geradas. |
| `scripts/sync-github.sh pull` | Busca os commits novos do GitHub, aplica o diff ao worktree e cria um commit no `main` local preservando mensagem/autoria originais no texto. |
| `scripts/sync-github.sh init-base` | Só para primeiro setup ou recuperação: force-pusha um snapshot sem histórico do HEAD atual e registra o ponto de sincronização. Apaga commits remotos ainda não trazidos — use com cuidado. |

Requisitos: `GITHUB_TOKEN` no ambiente (vai via credential helper do git — nunca em URLs,
arquivos ou logs). O estado do ponto de sincronização (SHA local ↔ SHA remoto) fica em
`.git/bluebee-github-sync`, fora do worktree versionado. `backups/`, `attached_assets/`,
`exports/`, `screenshots/`, vídeos e artefatos de vídeo nunca são publicados. Assets de
runtime em `apps/frontend/public` continuam no snapshot porque são necessários para o app.

Um workflow persistente roda `scripts/github-sync-daemon.sh` e publica automaticamente
novos commits da `main` local. O `scripts/post-merge.sh` também tenta sincronizar
imediatamente após cada merge. O daemon usa lock e uma tentativa por intervalo para
evitar concorrência e tempestade de retries. Se o GitHub avançar pela IDE, ele não
faz pull nem force-push: registra a divergência para resolução manual.
O workflow é iniciado junto com o projeto e verifica a `main` a cada 60 segundos por
padrão; esse intervalo pode ser ajustado com `GITHUB_SYNC_INTERVAL_SECONDS`.

## Fluxo para trabalhar na IDE local

1. Clonar: `git clone https://github.com/claucio-autobras/Beeldings.git`
2. Instalar dependências: `npm install` na raiz (monorepo npm workspaces).
3. Criar os `.env` locais necessários (não são versionados): `DATABASE_URL`,
   `JWT_SECRET`, e os demais que o backend exigir no seu cenário
   (veja `replit.md` / `apps/backend`).
4. Rodar: frontend `cd apps/frontend && npx next dev`, backend
   `cd apps/backend && npm run start:dev`.
5. Corrigir/commitar/pushar normalmente para o `main` do GitHub.
6. No Replit, pedir para rodar `scripts/sync-github.sh pull` (ou rodar você mesmo no
   shell) — as mudanças entram no `main` do Replit como um commit local que cita as
   mensagens e autores originais.

## Regras de ouro

- Nunca reescrever histórico no GitHub (force-push) depois da base — o `pull` aborta se
  detectar isso.
- Se `push` reclamar que o remoto avançou, rode `pull` antes; se o mesmo arquivo mudou
  dos dois lados e o patch não aplicar, resolva localmente no Replit e tente de novo.
- Se o mapeamento se perder (rollback de checkpoint muito antigo, etc.),
  `init-base` recomeça a base — commits remotos não trazidos são perdidos, então rode
  `pull` antes se possível.

## Histórico

- 2026-07-30: fluxo bidirecional ativado; primeiro commit de teste feito direto no GitHub.
