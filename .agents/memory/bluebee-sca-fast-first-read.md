---
name: SCA primeira leitura pós-cadastro
description: Contrato que faz controladoras SCA lerem logo após salvar — sem OID engessado, seed live-vence e diff de config no polling SNMP do gateway.
---

# SCA: leituras logo após salvar (sem diagnóstico)

Contrato comportamental (vale para novos tipos monitorados):

1. Pontos canônicos nascem SEM OID fixo — o gateway resolve pela cadeia de
   perfis base→fabricante. OID fixo no binding suprime o fallback do perfil
   por design (é o canal do diagnóstico/operador).
2. Binding tocado pelo operador/diagnóstico SEMPRE carrega a chave
   `unsupported`; a ausência dela identifica seed intocado do cadastro antigo
   e autoriza re-resolução para `oid: null` no publish (nunca migração
   destrutiva, nunca sobrescrever escolha deliberada).
3. Seed do teste de cadastro grava lastValue só onde `lastValueAt IS NULL`
   (live vence). Valores do snmp-health-test são CRUS — aplicar a escala do
   perfil ao semear.
4. `applyConfig` do polling SNMP do gateway diffa por configKey (pontos
   ordenados por tag): device inalterado não reinicia; novo/alterado pós-boot
   parte em janela ≤5s; config inicial retida mantém jitter cheio (sem
   rebanho no restart).

**Why:** OIDs genéricos engessados no seed deixavam Control iD em "Sem dados"
até o diagnóstico; e o republish reiniciava todos os polls, regredindo
leituras em edições não relacionadas.

**How to apply:** gateway local usa `TENANT_ID` no segmento de tópico (não
`GATEWAY_TENANT_ID`); delete de projeto deprovisiona EMQX sem tenantId →
tópicos retidos do gateway exigem limpeza manual no retainer.
