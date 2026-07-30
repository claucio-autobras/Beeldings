---
name: SNMP diagnose false negatives
description: Why camera firmwares produce false "não suportada" in SNMP diagnostics and the required mitigations (reuse ping, shared session + pacing + retry, walk cross-check, dynamic ifIndex).
---

# Falsos "não suportada" no diagnóstico SNMP de câmeras

Regra: nunca declare um OID "não suportado" com base num único GET efêmero.
Firmwares de câmera (Hikvision etc.) descartam pacotes sob rajada de sessões
UDP novas em sequência.

**Why:** o diagnóstico marcava sysUpTime como não suportado na MESMA câmera que
tinha acabado de responder o ping (que lê sysUpTime) — o resultado do ping era
descartado e o re-teste falhava sob rajada.

**How to apply:**
- Reaproveite a leitura do ping como resultado do OID pingado (não re-teste).
- Use UMA sessão SNMP compartilhada para todos os GETs do diagnóstico, com
  pausa (~150ms) entre requests e uma segunda passada só dos que falharam.
- Cruze com o walk: OID testado que aparece no walk com valor É suportado —
  o walk vence o GET falho.
- "Pacotes perdidos" não pode assumir ifIndex 1: derive candidatos dinâmicos de
  ifInDiscards/ifInErrors dos índices reais vistos no walk de 1.3.6.1.2.1.2
  (backend injeta no catálogo + em oidResults com o valor do walk).
- Teste sem hardware: agente net-snmp local + proxy UDP que descarta pacotes
  com inter-arrival < ~60ms simula o firmware que dropa rajadas.
