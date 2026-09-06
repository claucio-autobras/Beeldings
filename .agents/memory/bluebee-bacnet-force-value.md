---
name: BACnet force value / relinquish
description: Forcing commandable point values and the null-relinquish path across frontend/backend/gateway
---

# Forçar valor em pontos BACnet

- Só pontos comandáveis mostram a ação: AO(1) AV(2) BO(4) BV(5) MSO(14). Read-only (AI/BI/MSI) nunca.
- Fluxo reusa useBacnetWrite → POST /devices/bacnet/write. value type é `number | null`.
- Relinquish ("Liberar") = escrever `null`. Precisa suporte null ponta-a-ponta:
  DTO value `number|boolean|null`; controller só rejeita `undefined` (null é válido);
  gateway usa BACnet application tag Null (0) e writeValue null.
- **Confirmação por releitura (confirmByReadback) DEVE ser pulada no relinquish**:
  Number(null)=0 casaria por acidente com uma leitura 0 → falso sucesso. No relinquish
  o presentValue volta ao valor de prioridade mais baixa (desconhecido), então só dá
  pra confiar no SimpleACK/retry.
  **Why:** relinquish não tem valor-alvo pra comparar; readback daria falso positivo.
- Prioridade 1-16, default 8 (Manual_Operator); nunca 1-3 (Life Safety).
