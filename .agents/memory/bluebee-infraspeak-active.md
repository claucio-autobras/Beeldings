---
name: Infraspeak integração ativa
description: Detalhes da integração real com a API Infraspeak (failures) — hosts, PAT sandbox, formato JSON:API
---

# Infraspeak integração ativa

- PAT é válido SÓ para o ambiente onde foi emitido: o token atual é **sandbox** → base `https://api.sandbox.infraspeak.com/v3`. Produção exigirá novo PAT + trocar `INFRASPEAK_API_BASE_URL` para `https://api.infraspeak.com/v3`. Um 401 "Authentication token invalid" no host errado NÃO significa token inválido — testar o outro host primeiro.
- Recurso confirmado: `GET /failures`, itens em estilo JSON:API (`{type, id, attributes:{...}}`); campos reais documentados na secção 11 de `docs/infraspeak-requirements-api.md`. Datas são strings `YYYY-MM-DD HH:mm:ss` sem timezone.
- `status` e `state` vêm iguais no payload; o mapeador usa `state` com fallback para `status`.
- Endpoint interno `GET /infraspeak/requests` (JWT) devolve itens mapeados + `raw` íntegro; paginação por `links.next`.
- **Criação (`POST /failures`):** exige `problem_id` de um problem **FOLHA** (`problem_type`) — folhas só aparecem em `GET /problems?expanded=children` no array `included` (o `data` traz só áreas). `local_id` XOR `element_id`; prioridade 1–4 (2=NORMAL). Erros de validação vêm em `error.properties` (mapa campo→mensagens) — concatenar para o usuário.
- **Locais para criação:** usar `GET /locations` (JSON:API) e SÓ `type:"location"` — prédios (`building`) e pastas (`location-folder`) são recusados ("O edifício deve existir"). `GET /locals` devolve apenas prédios raiz, não serve para formulário.
- POST no client não faz retry pós-envio (risco de duplicar chamado); só 429.

**Gotcha operacional:** ao trocar env vars, processos antigos do backend podem sobreviver ao restart do workflow e continuar servindo com env stale — conferir via `/proc/<pid>/environ` e reiniciar de novo se necessário.
