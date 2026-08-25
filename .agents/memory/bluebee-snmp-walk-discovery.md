---
name: Descoberta SNMP genérica via WALK
description: Decisões arquiteturais da descoberta SNMP por walk (motor genérico, perfis aditivos) e regras que não podem regredir.
---

# Descoberta SNMP genérica via WALK

**Regra:** o motor SNMP (transporte/walk/descoberta) é 100% independente de fabricante; perfis só ADICIONAM conhecimento (roots de walk, classificação semântica). Nenhum ramo condicional por vendor no motor.
**Why:** requisito de spec do cliente — o mesmo fluxo serve SCA, CFTV híbrido, NVR e switch; um caso especial quebraria todos.
**How to apply:** conhecimento novo de fabricante entra como root de walk no perfil (gateway) e/ou entrada na tabela semântica (backend), nunca como `if` no walk/probe.

Decisões duráveis:
- Descoberta ≠ interpretação: TODO objeto do walk vira candidato; sem semântica = "OID desconhecido" selecionável — nunca descartar, nunca filtrar por sufixo `.0` ou tipo ASN.1.
- Não nomear OID não confirmado pela árvore real do firmware (ex.: iDFlex …1.1.5.0 Gauge32 ficou sem nome de propósito).
- Control iD responde sob enterprise **49617** (34475 é legado do cadastro antigo).
- Community SNMP é credencial: NUNCA entra em payload de resultado/diagnóstico nem na UI.
- Orçamento ponta-a-ponta: GETs + retry + walk dividem um deadline único abaixo do timeout do backend (retry/walk encolhem, jamais estouram) — senão o backend descarta o resultado como "gateway indisponível".
- Pontos livres descobertos casam por `binding.oid` (nunca por metric — 'custom' colide); tag derivada do OID.
- Compat gateway antigo: entradas de walk podem ser só `{oid,value}` e sem stats — todo campo novo é opcional/null-safe ponta-a-ponta.
- Teste de paridade usa agente net-snmp simulado com a árvore real; walk de subárvore inexistente contra agente vivo pode girar até o orçamento — asserte tipo de erro, não duração.
