---
name: Infraspeak problemas por contexto
description: Por que tipos de problema listados são rejeitados na criação de failures e como filtrar por cliente
---
Regra: a API Infraspeak NÃO tem filtro nativo de /problems por local/cliente (`s_client_id`/`s_local_id` → 500 code 42703; `/clients/{id}/problems` → 404). A restrição vive na relationship `clients` da `problem_area` (`all_clients` boolean + IDs quando restrito), carregada via `expanded=children,clients`; os `problem_type` filhos herdam da área pai. O client de um local resolve via `root_parent_id → building.client_id` (buildings têm `client_id` direto).

**Why:** failures com problem fora do escopo do cliente do local são rejeitados com HTTP 400 `properties.problem_id: ["O tipo de chamado deve existir", "validation.has_access_network"]`. Sandbox tem todos `all_clients=true`, então o filtro só se manifesta em produção.

**How to apply:** derivar combinações válidas client-side (allClients || clientIds.includes(clientId do local)); tratar o erro 400 acima como incompatibilidade de contexto, não como catálogo quebrado. Detalhes em docs/infraspeak-requirements-api.md.

## Modo seguro para cliente indeterminado
- Local selecionado cujo cliente não pôde ser resolvido → oferecer SÓ tipos all_clients=true + aviso explícito; nunca lista completa silenciosa (evita 400 has_access_network). Troca de local nesses termos reseta tipo restrito.
- Sandbox Infraspeak tem TODAS as áreas all_clients=true — restrições reais só existem no ambiente de teste do cliente; validar filtro lá exige PAT/base URL próprios.
