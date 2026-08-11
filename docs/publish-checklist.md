# Checklist pós-publish (produção)

Após cada Publish, verificar rapidamente:

1. **Build passou** — o deploy conclui `scripts/build-production.sh` sem erro
   (fontes são locais em `apps/frontend/src/app/fonts/`; nenhum acesso ao
   Google Fonts é necessário no build).
2. **App sobe** — login abre e autentica; dashboard carrega dados.
3. **Fontes corretas** — Inter no texto geral e Fira Code nos valores
   monoespaçados (ex.: telemetria), em light e dark.
4. **Imagens SCADA ok** — telas SCADA mostram os renders de equipamento
   (`apps/frontend/public/scada-equipment`) e os assets do App Storage.
5. **PDF ok** — um relatório em PDF sai com acentuação correta (fontes Roboto
   embutidas no backend).
6. **Download do agente de gateway ok** — `GET /gateways/agent-package`
   continua gerando o zip (precisa de `apps/gateway` presente na imagem).

## Tamanho da imagem

O `.replitignore` exclui `.git`, `.next` de dev, `.pythonlibs`, caches,
`attached_assets`, `backups`, `exports`, vídeos `.mp4` e os artifacts de
mockup/vídeo. Imagem estimada ≈1,5 GiB (limite: 8 GiB). Se o publish voltar a
reclamar de tamanho, conferir novos diretórios grandes com `du -sh */ .[!.]*/`
na raiz e adicioná-los ao `.replitignore` (desde que não sejam lidos pelos
scripts de build/start nem servidos em runtime).
