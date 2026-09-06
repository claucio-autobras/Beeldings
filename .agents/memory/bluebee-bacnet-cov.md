---
name: BACnet COV (Change of Value)
description: Durable decisions/constraints for the gateway's COV subscription path (node-bacnet API quirks, telemetry contract, correlation).
---

# BACnet COV no gateway

## node-bacnet API (não óbvia)
- `subscribeCov(receiver, objectId, subscribeId, cancel, issueConfirmedNotifications, lifetime, options, cb)` — são **8 args**; `options` (objeto, ex. `{}`) é obrigatório antes do callback, senão o cb vira `options`.
- Notificações chegam por **evento**, não por callback: `covNotifyUnconfirmed` (quando `issueConfirmedNotifications=false`) e `covNotify` (confirmadas). Usamos não confirmadas.
- Payload decodificado: `content.payload = { subscriberProcessId, initiatingDeviceId, monitoredObjectId:{type,instance}, timeRemaining, values:[{property:{id,index}, value:[{type,value}], priority}] }`; origem em `content.header.sender.address` (pode ter `:porta`).
- `subscribeId` (= subscriberProcessId) é escolhido por nós e **deve ser reutilizado** nas renovações do mesmo objeto (device atualiza a assinatura em vez de criar outra). Cancelar = `subscribeCov(..., cancel=true, lifetime=0)`.
- `receiver` aceita string IP (mesmo caminho de `readProperty`), não precisa do objeto `header.sender`.

## Contrato de telemetria (crítico)
- **Why:** o backend consome o mesmo tópico/formato independentemente da origem (polling ou COV); divergência quebra a ingestão silenciosamente.
- **How to apply:** COV publica em `bluebee/{tenant}/gateway/{gw}/telemetry` com `{timestamp, deviceId, points[{tag,objectType,objectInstance,value,unit}]}` — idêntico ao polling. Se mudar o shape num serviço, mude no outro em lockstep.

## Divisão polling vs COV
- Pontos `useCov:true` são **excluídos de propósito** do BacnetPollingService (`filter(o=>!o.useCov)`); quem os gerencia é o BacnetCovService. Não reintroduzir esses pontos no polling.
- Fallback e heartbeat de COV usam leitura individual (`readPropertySafe`), não RPM — COV são poucos pontos e baixa frequência; RPM fica só no polling normal.

## Correlação de notificações (evita misrouting)
- **Why:** `subscribeId` sozinho pode colidir após restart/reinício do contador ou vir de tráfego BACnet alheio.
- **How to apply:** ao receber COV, validar **subscribeId + address + monitoredObjectId (type/instance)** antes de publicar; descartar+logar em mismatch.

## Concorrência
- Loops de `setInterval` (manutenção global e ciclo por device) têm guarda de reentrância; devices lentos fariam ciclos se sobreporem gerando subscribe/read duplicados.
- Renovação: lifetime finito (default 300s) + renovar a ~80% do lifetime no loop de manutenção; FAILED faz retry de assinatura (self-healing) e enquanto isso é lido por polling no intervalo do device.

## Env
- `BACNET_COV_ENABLED` (default true), `BACNET_COV_LIFETIME_S` (300), `BACNET_COV_HEARTBEAT_MS` (300000).
