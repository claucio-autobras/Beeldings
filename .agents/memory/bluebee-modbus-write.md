---
name: Escrita Modbus
description: Regras duráveis do fluxo de comando Modbus (holding/coil) TCP e RTU
---

- Só `holding` e `coil` são escrevíveis; `input`/`discrete` são somente leitura. O backend resolve binding+config do banco — o frontend nunca envia endereço/tipo de registrador (segurança).
- **Why:** escrita arbitrária em registradores fora do cadastro pode acionar equipamento real errado.
- Sem priority array/relinquish — isso é conceito BACnet; a UI Modbus não tem botão "Liberar" nem campo prioridade.
- O gateway reverte scale/offset (valor de engenharia → cru) com checagem de faixa por dataType; endianness `little` = word-swap nos 32-bit. Coil usa FC05; holding FC06/FC16.
- Releitura pós-escrita é best-effort e publicada como telemetria normal (substitui o valor otimista do SCADA); nunca confirmar sucesso comparando readback (Number(null)=0).
- Mesmo padrão dos writes BACnet/MQTT no backend: pending Map registrado ANTES do publish QoS2, timeout 20s, resultado em `.../commands/result`.
- Backend usa defaults silenciosos p/ binding incompleto (holding/float32/register=instance) — risco conhecido, follow-up proposto para validar no write.
