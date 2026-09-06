---
name: Telemetry socket compartilhado
description: Socket.IO /telemetry é singleton ref-counted no frontend; nunca chamar io()/disconnect() direto em hooks.
---

# Socket /telemetry compartilhado (frontend)

Regra: todo consumo do namespace Socket.IO `/telemetry` no frontend passa por `lib/telemetry-socket.ts` — `acquireTelemetrySocket()` / `releaseTelemetrySocket()` (refcount + linger de ~2s) e `setTelemetryScope(tenantId)`. Hooks registram listeners próprios e removem com `socket.off(event, handler)`; NUNCA chamam `socket.disconnect()`.

**Why:** socket.io-client reaproveita o MESMO socket de namespace para URL/path iguais; cada hook que chamava `io()` + `disconnect()` derrubava o socket dos demais (Topbar, popup de alarmes, viewer SCADA), e o double-mount do StrictMode desconectava no meio do handshake — gerando avisos repetidos "WebSocket is closed before the connection is established" e churn de reconexão.

**How to apply:** qualquer novo consumidor de tempo real (`bacnet:telemetry`, `alarm:event`, etc.) usa acquire/release no effect e emite escopo via `setTelemetryScope` (reemitido automaticamente a cada `connect`). Trocar o tenant selecionado NÃO deve reconectar o socket — só reemitir o escopo.
