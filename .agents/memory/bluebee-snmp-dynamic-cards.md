---
name: Cards SNMP dinâmicos (CFTV+SCA)
description: Decisões duráveis do modelo genérico de cards SNMP — dados em vez de código por marca, plausibilidade ponta-a-ponta.
---

# Cards SNMP dinâmicos (CFTV + SCA)

- **Zero código por fabricante no motor/card.** Conhecimento de marca entra só
  como dados (perfil, semântica de OIDs, MIB importada). O card renderiza um
  payload orientado a categoria/importância/origem — nunca reintroduzir grid
  fixo de métricas no frontend.
- **Plausibilidade vale ponta-a-ponta, inclusive no apply.** O diagnóstico
  rebaixa leituras incompatíveis para "não confirmada"; o veredito por OID é
  persistido e consultado ao aplicar — OID reprovado nunca recebe rótulo
  semântico nem vira métrica canônica, mesmo via payload direto (entra como
  custom com nome neutro; nome deliberado do operador é mantido).
  **Why:** árvores de OID deslocam entre firmwares (caso Control iD: métrica
  errada com rótulo trocado); validar só na exibição deixa o banco gravar o
  rótulo errado.
- Seletor de fabricante na descoberta reclassifica **client-side** (sem novo
  walk); detecção automática é o default.
- "Não expõe" ≠ "sem leitura no momento" — semânticas distintas no card; nada
  coletado fica invisível.
- Aplicar OID confirmado reponta o ponto canônico existente (preserva
  ID/trends/alarmes), nunca duplica.

**How to apply:** marca/modelo novo = só dados de perfil/semântica; cards de
NVR/switch podem adotar o mesmo modelo reutilizando os utilitários existentes.
