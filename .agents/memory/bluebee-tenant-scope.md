---
name: Tenant scope resolution
description: Regra durável de escopo multi-tenant no backend e o vazamento de string vazia que ela previne
---

**Rule:** escopo de tenant em controllers nunca é resolvido à mão — sempre pelos helpers centrais de tenant-scope do módulo auth (`resolveTenantScope` para query, `resolveBodyTenantScope` para tenantId vindo no body). Endpoints inerentemente globais (agregados de todos os clientes) usam `RolesGuard` + `@Roles(ADMIN, CCO, SUPERVISOR)` em vez de escopo.

**Why:** os services Prisma tratam tenantId falsy (`''`/`undefined`) como "sem filtro". Fallbacks manuais tipo `user.tenantId ?? ''` deixavam um CLIENTE/VISUALIZADOR sem tenant cair no escopo de TODOS os clientes (vazamento). Papel de cliente também nunca pode escolher tenant via query/body.

**How to apply:** cliente sem tenant → 403; cliente com tenant → sempre o próprio (query/body ignorados); global → tenant pedido ou todos. Operações que recebem gateway+tenant do body (scans/descobertas/testes de conexão) também validam que o gateway pertence ao tenant efetivo. Progresso de scans polled por HTTP carrega o tenant (extraído do tópico MQTT, válido em qualquer instância do cluster) e é escopado na leitura.

**Frontend corollary:** como "sem tenant" = "todos", formulários de criação para perfis globais devem GATEAR as listagens dependentes (sites/gateways/projetos) até o cliente ser escolhido — `useSites`/`useGateways` aceitam `{ enabled }` para não disparar a query, e os selects ficam desabilitados com "Selecione o cliente primeiro". Senão o form lista recursos de outros clientes e permite cadastro cruzado.
