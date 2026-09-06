# Plano — Migração de imagens do SCADA para Supabase Storage

> Documento de design para evolução **futura** (deploy de produção do backend).
> Não é implementação imediata — hoje rodamos **disco local** e está OK para a
> Fase 0 em ambiente único.
> Ponto de partida: implementação atual em `ScadaAssetService` (gravação em disco).

## 1. Objetivo

Mover o armazenamento das imagens das telas SCADA (widget `image` e imagem de
fundo da tela) do **disco local do backend** para o **Supabase Storage**, no
momento em que o backend for para produção.

Motivação central: **não sobrecarregar o backend**. Com Storage, o NestJS não
guarda nem serve os bytes das imagens — apenas intermedeia o upload e devolve a
URL. O download das imagens vai direto do Supabase (CDN), tirando banda e I/O do
servidor. Além disso, disco local não sobrevive a redeploy/restart de container
e não funciona com múltiplas instâncias do backend.

## 2. Contexto — por que NÃO migrar agora

- Backend ainda **não está em produção**; ambiente é único e estável.
- A implementação em disco **já resolve** o erro original (`request entity too
  large`): as imagens saíram do JSON da tela e o save trafega só URLs.
- Migrar exige a **service role key** do Supabase, que hoje está como
  `AGUARDANDO` no `.env` (ver `supabase-auth.service.ts`, que cai no `anonKey`).
  Essa chave precisa existir de qualquer forma quando formos para produção.

> Regra: migrar **junto com a definição do deploy de produção do backend**, não
> antes.

## 3. Estado atual (o que já existe)

| Peça | Arquivo | Situação |
|------|---------|----------|
| Service de assets (grava em disco) | `apps/backend/src/modules/scada/application/scada-asset.service.ts` → `saveDataUrl()`, `resolveScadaUploadDir()` | **Em uso** |
| Endpoint de upload | `apps/backend/src/modules/scada/presentation/scada-assets.controller.ts` → `POST /scada/assets` | **Em uso** |
| Serve estático | `apps/backend/src/main.ts` → `express.static('/scada-assets', uploadDir)` | **Em uso** |
| Upload no frontend | `apps/frontend/src/modules/scada/services/scada.service.ts` → `uploadScadaAsset()` | **Em uso** |
| Resolução de URL | mesmo arquivo → `resolveAssetUrl()` | **Em uso** |
| Consumidores | `ImageWidget.tsx`, `EditorCanvas.tsx`, `ScreenSettingsPanel.tsx` | **Em uso** |

> **Vantagem do desenho atual:** o frontend já está blindado. `uploadScadaAsset`
> devolve uma URL e `resolveAssetUrl` resolve qualquer `src`. A migração para
> Storage é **majoritariamente backend** — os componentes não mudam.

## 4. Pré-requisitos (fazer no painel do Supabase, no deploy)

1. **Service role key** — Settings → API → copiar `service_role` para o `.env` do
   backend como `SUPABASE_SERVICE_ROLE_KEY`. (Nunca expor no frontend.)
2. **Bucket** `scada-assets`:
   - **Público para leitura** (as URLs das imagens são carregadas por `<img>`).
   - **Escrita apenas via service role** (o backend é o único que sobe arquivo).
3. *(Opcional)* política de retenção/limite de tamanho no bucket, espelhando o
   teto de 5 MB já validado no backend.

## 5. Arquitetura proposta

```
POST /scada/assets  (data URL base64)
        │
        ▼
ScadaAssetService.saveDataUrl(tenantId, dataUrl)
        │
        ├─ valida MIME + tamanho (5 MB)          ← já existe
        │
        ├─ DISCO   (sem service role key)  → grava em uploads/scada/...   ← atual
        └─ STORAGE (com service role key)  → supabase.storage
                                              .from('scada-assets')
                                              .upload(`${tenant}/${uuid}.${ext}`)
        │
        ▼
   devolve { url }   (pública do Storage ou /scada-assets/... do disco)
```

- **Seleção automática por env:** se `SUPABASE_SERVICE_ROLE_KEY` estiver
  presente → usa Storage; ausente → usa disco. Zero mudança de comportamento em
  dev; produção liga sozinho ao configurar a chave.
- **`resolveAssetUrl` no frontend:** a URL pública do Storage é **absoluta**
  (`https://<proj>.supabase.co/storage/v1/object/public/scada-assets/...`), então
  já passa direto por `resolveAssetUrl` (que só prefixa paths `/scada-assets/`).
  **Nenhuma mudança no frontend.**

## 6. Configuração (env)

| Variável | Função | Default |
|----------|--------|---------|
| `SUPABASE_URL` | já existe | — |
| `SUPABASE_SERVICE_ROLE_KEY` *(novo)* | habilita Storage; ausente → disco | vazio (disco) |
| `SCADA_STORAGE_BUCKET` *(novo)* | nome do bucket | `scada-assets` |
| `SCADA_UPLOAD_DIR` | dir de disco (fallback) | `<cwd>/uploads/scada` |

## 7. Impacto por camada

- **Backend:**
  - `ScadaAssetService` ganha um branch Storage usando `@supabase/supabase-js`
    (já é dependência). Cliente criado com a service role key.
  - `main.ts`: o `express.static('/scada-assets')` continua existindo como
    **fallback** (telas antigas gravadas em disco antes da migração).
  - Sem mudança de contrato no `POST /scada/assets`.
- **Frontend:** **nenhuma** — `uploadScadaAsset` e `resolveAssetUrl` já abstraem.
- **Banco:** nenhuma migration — `widgets`/`settings` continuam guardando só a
  URL (string) no JSON da tela.

## 8. Passos de implementação (no deploy)

1. Criar bucket + chave (seção 4).
2. Adicionar branch Storage em `ScadaAssetService.saveDataUrl()` (seleção por env).
3. Manter `express.static` como fallback para URLs legadas em disco.
4. Testar: subir imagem em produção → confirmar URL do Storage e render no editor
   e no viewer.
5. *(Opcional)* migrar imagens antigas do disco para o bucket (script único que
   relê os arquivos e regrava as URLs nas telas) — só se houver telas em disco
   que precisem sobreviver ao corte.

## 9. Pendências independentes da migração (valem para os dois back-ends)

- **Arquivos órfãos:** trocar/remover a imagem de um widget deixa o arquivo
  antigo no storage (disco ou bucket). Hoje não há limpeza. Opções futuras:
  (a) job de varredura que cruza arquivos × URLs referenciadas nas telas e apaga
  os não-referenciados; (b) apagar o arquivo anterior no momento da troca.
- **Limite de tamanho:** o teto de 5 MB está no backend (`MAX_BYTES`). Replicar
  no bucket quando migrar.

## 10. Critérios de aceite

- [ ] Com `SUPABASE_SERVICE_ROLE_KEY` definida, o upload grava no bucket
      `scada-assets` e a tela passa a guardar a URL pública do Storage.
- [ ] Sem a chave (dev), o comportamento atual (disco) é mantido — sem regressão.
- [ ] Telas antigas com imagem em disco (`/scada-assets/...`) continuam
      renderizando via fallback estático.
- [ ] Frontend **inalterado** — `ImageWidget`, `EditorCanvas` e
      `ScreenSettingsPanel` funcionam sem edição.
- [ ] Backend não serve mais os bytes das imagens novas (carga sai do servidor).

## 11. Riscos e cuidados

- **Vazamento da service role key:** é uma chave de altíssimo privilégio. Só no
  `.env` do backend, nunca no frontend nem no repositório.
- **Bucket público:** leitura pública é aceitável (nomes UUID imprevisíveis e
  conteúdo de tela sinótica), mas validar se algum cliente exige imagens
  privadas — nesse caso usar URLs assinadas (`createSignedUrl`).
- **Custo/limites do plano Supabase:** acompanhar uso de Storage e banda ao
  escalar para muitos tenants/telas.
