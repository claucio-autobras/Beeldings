---
name: Modbus RTU serial RS485
description: Como o suporte Modbus RTU via porta serial funciona no gateway/backend/frontend
---
- RS485 é half-duplex: TODAS as operações de uma porta serial passam por UMA fila serializada (promise chain) no SerialPortManager do gateway; `setID(unitId)` imediatamente antes de cada operação (vários escravos no mesmo barramento compartilham 1 client `connectRTUBuffered`).
- **Why:** duas requisições simultâneas no mesmo barramento corrompem frames; setID é estado global do client modbus-serial.
- Porta identificada case-insensitive (COM3 == com3); parâmetros divergentes numa porta já aberta são rejeitados com erro PT-BR ("já está em uso com outros parâmetros").
- Refcount acquire/release por deviceId; sem consumidores a porta fecha (teste de conexão avulso abre e fecha). Timeout por operação rejeita mas NÃO trava a fila; só erro de porta (open/ENOENT/EACCES) derruba a conexão — exceção Modbus (illegal address etc.) mantém aberta e no teste de conexão conta como SUCESSO (escravo respondeu).
- Config: `config.connectionType` ('tcp'|'rtu', ausente = tcp legado) + `config.serial` {path, baudRate, parity, dataBits, stopBits}; no RTU o campo `ip` espelha o path da porta e `port`=0. Frontend não permite trocar o modo na edição.
- Gateway OTA: qualquer arquivo novo em apps/gateway exige bump de versão no package.json + `node scripts/gateway-manifest.mjs --update`, senão gateways em campo não recebem a atualização.
- Não existe caminho de escrita Modbus na plataforma (só BACnet/MQTT) — a fila serial está pronta p/ escrita, mas nada a usa ainda.
