---
name: Cloudflare Turnstile no login
description: Anti-robô no login — só em produção, chaves restritas ao domínio, tokens de uso único
---

**Regra:** o Turnstile só é exigido quando `NODE_ENV=production` E as DUAS chaves (`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`) estão configuradas. O frontend descobre a site key via `GET /auth/turnstile-config` (público); `siteKey:null` = sem widget.

**Why:**
- A site key do Cloudflare é restrita aos hostnames cadastrados (bluebee.ia.br). No preview dev (`*.replit.dev`/127.0.0.1) o widget falha com erro **110200** — se o backend exigisse token em dev, trancaria todo mundo fora do login.
- Exigir as duas chaves evita lockout silencioso (secret sem site key = backend exige token que o front não consegue gerar).
- Tokens do Turnstile são de **uso único**: após login que falhou (ex.: senha errada), o LoginForm incrementa `resetSignal` do widget para re-desafiar — reenviar o mesmo token dá 401 "verificação inválida".
- siteverify indisponível (rede/5xx) → **fail-open** com log (login já tem throttle por IP + auditoria); token inválido → 401 fail-closed.

**How to apply:** ao testar login em dev, nada muda (sem widget). Validação real só no domínio publicado. Curl em prod precisa de token válido — não dá para testar o caminho feliz por curl.

**Gotcha de boot relacionado:** `DeviceConfigPublisherService.onApplicationBootstrap` bloqueava `app.listen` para sempre quando o broker MQTT estava inalcançável (mqtt.js enfileira publishes offline e o await nunca resolve) — agora é fire-and-forget. Qualquer novo hook de boot que aguarde publish MQTT repete o problema.
