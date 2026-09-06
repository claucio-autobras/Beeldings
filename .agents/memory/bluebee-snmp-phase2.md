---
name: SNMP fase 2 — credencial, descoberta e coleta restrita
description: Decisões arquiteturais duráveis da separação descoberta/coleta e do SNMPv3.
---

## Credencial SNMP
- A tabela de credenciais é a fonte da verdade; campos legados em Device.config são só retrocompat — resolver sempre pelo helper central (credencial vence).
- Chaves v3 cifradas em repouso e decifradas SOMENTE ao publicar config MQTT; o gateway nunca decifra; API expõe só flags has*Key; edição com chave vazia = manter.
- **Why:** chave em texto puro nunca pode transitar em GET nem persistir em config visível.

## Coleta governada pelo banco
- Os OIDs publicados ao gateway vêm do estado PÓS-sync da tabela de bindings, sincronizada na MESMA publicação de config; em falha de sync vale o estado atual do banco — nunca um espelho em memória.
- Em modo restrito o gateway NÃO identifica perfil (nada de sysDescr/sysObjectID por ciclo) e NÃO faz walk/subtree: tabelas são lidas por GET do OID completo linha a linha; qualquer ponto sem OID resolvido tira o device do modo restrito (caminho legado por perfil continua válido).
- **Why:** um espelho defasado ou um perfil não pode governar a coleta; walk por ciclo satura a rede do cliente.

## Descoberta persistida
- Todo walk vira um run persistido com diff contra o anterior e detecção de bindings quebrados (OID sumiu/mudou de tipo) — recalculado só em walk alcançável e não-vazio, senão um walk falho marcaria tudo como quebrado.
- Auto-descoberta (cadastro) com throttle de 1×/dia; manual sempre roda; persistência do run é não-fatal para o diagnóstico.
