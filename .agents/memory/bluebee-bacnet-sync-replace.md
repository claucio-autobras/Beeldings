---
name: BACnet sync replace
description: Semântica do "Atualizar todos os pontos" BACnet — payload é a fonte de verdade e o replace recria IDs.
---

# BACnet sync replace

- O endpoint `POST /devices/:id/bacnet/sync/replace` faz `deleteMany + createMany`: o payload enviado pelo frontend É o conjunto final de pontos. Enviar `existentes + novos` reinjeta pontos obsoletos — para remover de verdade, envie exatamente o conjunto descoberto agora.
- **Preservação de nomes:** o nome/tag customizado (mprog da Mercato) vive nos pontos salvos; ao montar o payload do replace, faça merge por chave `objectType:instance` usando o dado salvo para pontos que continuam existindo, senão o discovery sobrescreve com o nome genérico.
- **Armadilha conhecida:** como o replace recria todos os DevicePoints, os pontos sobreviventes ganham IDs novos → trends/regras de alarme apontadas para os IDs antigos são perdidas/órfãs. Corrigir exige diff no backend (update em vez de delete+create para sobreviventes).
- Exclusão de ponto individual usa a rota genérica `DELETE /devices/:id/points/:pointId` (compartilhada Modbus/BACnet); backend remove trends/alarmes em cascata e republica a config de polling (gateway para de ler).
