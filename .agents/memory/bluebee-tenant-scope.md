---
name: Tenant scope resolution
description: Regra durável de escopo multi-tenant no backend e o vazamento de string vazia que ela previne
---

**Rule:** escopo de tenant em controllers nunca é resolvido à mão — sempre pelos helpers centrais de tenant-scope do módulo auth (`resolveTenantScope` para query, `resolveBodyTenantScope` para tenantId vindo no body). Endpoints inerentemente globais (agregados de todos os clientes) usam `RolesGuard` + `@Roles(ADMIN, CCO, SUPERVISOR)` em vez de escopo.

**Why:** os services Prisma tratam tenantId falsy (`''`/`undefined`) como "sem filtro". Fallbacks manuais tipo `user.tenantId ?? ''` deixavam um CLIENTE/VISUALIZADOR sem tenant cair no escopo de TODOS os clientes (vazamento). Papel de cliente também nunca pode escolher tenant via query/body.

**How to apply:** cliente sem tenant → 403; cliente com tenant → sempre o próprio (query/body ignorados); global → tenant pedido ou todos. Operações que recebem gateway+tenant do body (scans/descobertas/testes de conexão) também validam que o gateway pertence ao tenant efetivo. Progresso de scans polled por HTTP carrega o tenant (extraído do tópico MQTT, válido em qualquer instância do cluster) e é escopado na leitura.

**Frontend corollary:** como "sem tenant" = "todos", formulários de criação para perfis globais devem GATEAR as listagens dependentes (sites/gateways/projetos) até o cliente ser escolhido — `useSites`/`useGateways` aceitam `{ enabled }` para não disparar a query, e os selects ficam desabilitados com "Selecione o cliente primeiro". Senão o form lista recursos de outros clientes e permite cadastro cruzado. Endpoints cujo resultado muda conforme o usuário autenticado também precisam incluir o escopo na query key do React Query; nunca reutilize a mesma entrada de cache para a lista global e a lista de um cliente.

**SCADA corollary:** telas novas exigem cliente, site e projeto/gateway, e o projeto precisa pertencer ao site informado. Para CLIENTE/VISUALIZADOR, a busca individual por ID também exige o site selecionado; a proteção da listagem por `siteId` não basta para URLs diretas.

**Why:** registros SCADA legados podem existir sem `projectId`, e um endpoint individual limitado apenas por tenant permite atravessar sites do mesmo cliente quando o ID da tela é conhecido.

**How to apply:** manter validação de vínculo tenant→site→project em create/update e passar o site no carregamento individual do viewer; tratar telas legadas por migração/arquivamento separado, sem apagar dados automaticamente.
