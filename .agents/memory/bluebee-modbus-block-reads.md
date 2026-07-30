---
name: Modbus block reads (gateway polling)
description: How gateway Modbus polling batches contiguous registers into single range reads, and the invariants that keep telemetry identical.
---

# Modbus leitura em bloco (ModbusPollingService)

O polling agrupa registradores contíguos do MESMO tipo (holding/input/coil/discrete)
e faz uma leitura de faixa por bloco, em vez de um request por registrador.

## Invariantes que NÃO podem quebrar
- **Payload de telemetria idêntico ao antigo**: mesmo tópico, mesmos pontos e
  **mesma ordem** dos registradores como cadastrados no device. Blocos reordenam
  por endereço, então cada ponto carrega `originalIndex` e o payload é reordenado
  por esse índice antes de publicar. **NUNCA reordenar por `tag`** — tags podem
  se repetir e a ordem quebraria (foi exatamente o motivo de um FAIL de review).
- **Decodificação por fatia**: o buffer do bloco é big-endian por word; cada reg
  lê `p.words*2` bytes no offset `(p.addr - blockStart)*2`. A lógica de 32-bit com
  word-swap (`endianness==='little'`) vive em `decode()` e é reaproveitada na fatia.

## Regras do planejamento (planBlocks)
- Separa por `registerType`, ordena por endereço de protocolo, agrupa contíguos
  (`p.addr <= blockEnd`, sem lacuna) até o limite por request:
  `MAX_REGISTERS_PER_READ=125` (16-bit) / `MAX_BITS_PER_READ=2000` (coil/discrete).
- Lacuna de endereço → bloco novo. 32-bit ocupa 2 words (`wordsFor`).

## Degradação graciosa (readBlock)
- Erro/timeout num bloco com >1 registrador → subdivide ao meio e re-tenta
  (recursivo), isolando o endereço problemático. Bloco de 1 reg que falha → loga
  em debug e é pulado, sem derrubar o ciclo. Reusa a conexão TCP persistente.

**Why:** Modbus é lento por round-trip; muitos registros → ciclo estoura o
intervalo. Bloco corta round-trips. Mas o downstream (trends/alarmes) não pode
perceber diferença, daí as invariantes de payload/ordem.
