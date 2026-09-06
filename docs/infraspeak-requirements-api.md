# Relatório Técnico — API Infraspeak: Documentação "Requirements"

**Fonte oficial:** https://infraspeak.stoplight.io/docs/api/f89e68a07621b-requirements  
**Data de consulta:** 29 de junho de 2026  
**Versão da API documentada:** v3

---

> **Nota metodológica — acesso à documentação**
>
> A documentação da Infraspeak no Stoplight é uma Single-Page Application (SPA) renderizada por JavaScript. Para obter o conteúdo oficial, este relatório utilizou dois métodos: (1) fetch HTTP estático das páginas e (2) captura via browser com renderização JavaScript. Cada secção indica a fonte e o método que produziu os dados. Para as páginas em que nenhum dos métodos obteve conteúdo (exibem ecrã em branco após renderização), isso é declarado explicitamente.
>
> **Acerca da denominação "Requirements":** Na documentação oficial, a URL fornecida (`f89e68a07621b-requirements`) é a **página de introdução e pré-requisitos gerais da API Infraspeak**. Na barra lateral, esta página aparece na secção "1. INTRODUCTION" com o título "Requirements" — ou seja, "o que é necessário para usar a API". Não foi encontrado qualquer endpoint de recurso denominado "Requirements" na documentação. O recurso listado na barra lateral mais próximo semanticamente chama-se "Requests" (Pedidos de manutenção). A secção 2 deste relatório documenta o que foi possível confirmar sobre o endpoint.

---

## 1. Autenticação

### Fontes confirmadas

| Secção | URL oficial | Método de acesso |
|---|---|---|
| Generating a Token | https://infraspeak.stoplight.io/docs/api/efb05786d9dac-generating-a-token | Fetch estático ✅ |
| HTTP request headers | https://infraspeak.stoplight.io/docs/api/f1c0bb5de545c-http-request-headers | Fetch estático ✅ |
| Revoking a Token | https://infraspeak.stoplight.io/docs/api/cb1235a9a476a-revoking-a-token | Screenshot (browser) ✅ |
| Using the Token | https://infraspeak.stoplight.io/docs/api/b12bdbebe6402-using-the-token | Ecrã em branco após renderização ❌ |

### Como funciona

Confirmado na documentação oficial (página "Generating a Token"):

> *"In order to have access to the Infraspeak REST API resources, you will need a Personal Access Token (PAT). PATs provide an easy way to work with Infraspeak REST API and allow clients to run automation without an interactive login."*

### Tokens necessários

- **Tipo:** Personal Access Token (PAT)
- **Como obter:** Entrar em contacto direto com a Infraspeak. Não existe geração self-service de PATs.
  - Para o ambiente **sandbox**: fornecer informações sobre a aplicação e uma visão geral da integração a ser desenvolvida.
  - Para **produção**: solicitar o PAT após concluir e validar os testes no sandbox.

### Tempo de expiração

Confirmado na documentação oficial (página "Generating a Token"):

> *"Our PATs are long-lived, they don't expire, so you don't need to refresh them. They become invalid only when revoked."*

Os PATs **não expiram por tempo**. Tornam-se inválidos apenas quando revogados.

### Header de autenticação

Confirmado na documentação oficial (página "HTTP request headers"):

> *"This header is required in order to authenticate over the API. It enables you to perform actions on behalf and with the approval of the resource owner, and follows the Bearer authentication scheme."*

```
Authorization: Bearer <Access Token>
```

### Fluxo completo de autenticação

1. Contactar a Infraspeak para obter PAT do ambiente sandbox (com informações sobre a aplicação)
2. Incluir o PAT no header `Authorization: Bearer <token>` em todas as requisições
3. Desenvolver e testar a integração no ambiente sandbox
4. Contactar a Infraspeak para obter o PAT de produção após conclusão dos testes
5. PATs são válidos apenas para o ambiente onde foram gerados (sandbox ≠ produção)

Confirmado na documentação oficial (página "Generating a Token"):

> *"PATs are valid only for the environment where they are generated."*
> *"Your API tokens need to be treated as secure as any other password."*

### Revogação de tokens

Confirmado na documentação oficial (página "Revoking a Token", obtida por screenshot):

> *"A Personal Access Token can be revoked at any time, for various reasons. Once you revoke a token, it will stop working with immediate effect. This action is irreversible."*
> *"Trying to use a revoked token on an API request will result in a 401 Unauthorized response."*

- Um PAT pode ser revogado a qualquer momento
- A revogação tem efeito imediato
- A revogação é irreversível
- O uso de um token revogado resulta em `401 Unauthorized`

### Secção não confirmada

- **Using the Token** (https://infraspeak.stoplight.io/docs/api/b12bdbebe6402-using-the-token): A página exibiu ecrã em branco após renderização com browser. Não foi possível confirmar o conteúdo desta secção na documentação oficial.

---

## 2. Endpoint

### Fontes confirmadas

| Secção | URL oficial | Método de acesso |
|---|---|---|
| Requirements (intro) | https://infraspeak.stoplight.io/docs/api/f89e68a07621b-requirements | Screenshot (browser) ✅ |
| Recursos individuais (sidebar) | (páginas de cada recurso) | Não acessíveis publicamente ❌ |

### O que foi confirmado na documentação oficial

Confirmado na página "Requirements" (screenshot):

> *"Infraspeak's API make use of REST architecture in order to provide an easy interface to perform operations such as create, read, update and delete resources. The current version is v3."*
> *"You need to access the API over HTTPS, using SSL. Also, API requests without authentication will fail."*

- A API usa arquitetura **REST**
- A versão atual é **v3**
- O protocolo obrigatório é **HTTPS com SSL**
- Todas as requisições requerem autenticação

### Padrão de URL confirmado (a partir da página Pagination)

A documentação oficial de Pagination usa os seguintes exemplos de URL:

```
GET <API base URL>/v3/locations?limit=300
GET <API base URL>/v3/locations?limit=300&page=2
```

Estes exemplos confirmam que o padrão de URL dos endpoints segue o formato:

```
<API base URL>/v3/<recurso>
```

O valor de `<API base URL>` está representado como placeholder na documentação, não foi explicitamente declarado nas páginas acessíveis.

### Recursos disponíveis na API

A barra lateral da documentação oficial lista os seguintes grupos de recursos da API Infraspeak:

> Buy Orders, Categories, Clients, Contacts, Cost Centers, Elements, Failures, Files, Locations, Materials, Operators, Other Costs, Problems, Quotes, **Requests**, Scheduled Works, Sell Orders, Stock Movements, Stocks, Suppliers, Warehouses, Works, Stock Transactions, Schemas

### O que NÃO foi possível confirmar

Não foi possível confirmar na documentação oficial:

- A URL exata do endpoint do recurso "Requests" (host + path completo)
- O método HTTP do endpoint
- Os parâmetros de path
- Os campos específicos de resposta do recurso "Requests"
- Os filtros pesquisáveis específicos do recurso "Requests"

As páginas individuais de recursos da API requerem autenticação no Stoplight para exibir conteúdo.

### Headers obrigatórios em todos os endpoints (confirmados)

Confirmados na página "HTTP request headers":

| Header | Valor | Quando obrigatório |
|---|---|---|
| `Authorization` | `Bearer <Access Token>` | Sempre |
| `Accept` | `application/json` | Operações com corpo de resposta |
| `Content-Type` | `application/json` | Operações com corpo de requisição |
| `User-Agent` | `Nome do App (url ou email de contacto)` | Recomendado |

Exemplos documentados oficialmente para `User-Agent`:

```
User-Agent: Custom App Name (https://example.com/contact)
User-Agent: Custom App Name (contact@example.com)
```

---

## 3. Paginação

### Fonte confirmada

| Secção | URL oficial | Método de acesso |
|---|---|---|
| Pagination | https://infraspeak.stoplight.io/docs/api/7d56ca7f2fd57-pagination | Screenshot (browser) ✅ |
| Parameters (limite) | https://infraspeak.stoplight.io/docs/api/1f866ecae49d8-parameters | Fetch estático ✅ |

### Como funciona — confirmado na documentação oficial

Confirmado na página "Pagination" (screenshot):

> *"Requests that return multiple items will be paginated to 200 items by default. It's possible to change this value by specifying the `limit` parameter."*

### Parâmetros de paginação (confirmados)

| Parâmetro | Tipo | Descrição (confirmada) | Exemplo (confirmado) |
|---|---|---|---|
| `limit` | integer | Limita o número de resultados por página. Padrão: **200**. Se exceder o limite máximo do recurso, aplica-se o máximo do recurso. | `?limit=300` |
| `page` | integer | Navega para uma página específica. **Numeração começa em 1.** Omitir retorna a primeira página. | `?page=2` |

Confirmado na documentação oficial:

> *"You can specify further pages with the `page` parameter."*
> *"Page number is 1-based and omitting the `page` parameter will return the first page."*

Exemplos documentados:

```
GET <API base URL>/v3/locations?limit=300
GET <API base URL>/v3/locations?limit=300&page=2
```

### Estrutura de resposta com metadados de paginação (confirmada)

Confirmado na página "Pagination" (screenshot), a resposta inclui metadados de paginação:

```json
{
  "data": [
    (...)
  ],
  "meta": {
    "pagination": {
      "per_page": 200,
      "current_page": 3
    }
  },
  "links": {
    "self": "<API base URL>/v3/locations?page=3",
    "first": "<API base URL>/v3/locations?page=1",
    "prev": "<API base URL>/v3/locations?page=2",
    "next": "<API base URL>/v3/locations?page=4"
  }
}
```

Confirmado na documentação oficial:

> *"Also, the response includes some pagination metadata, such as number of items per page, current page and generated links for next/previous pages."*

### Como descobrir se existem mais páginas

A partir do objeto `links` na resposta (confirmado na documentação oficial):
- **`links.next`**: presente quando existe uma próxima página; ausente quando a página atual é a última
- **`links.prev`**: presente quando existe uma página anterior; ausente na primeira página
- **`links.first`**: URL da primeira página
- **`meta.pagination.current_page`**: número da página atual
- **`meta.pagination.per_page`**: número de itens por página

---

## 4. Filtros

### Fonte confirmada

| Secção | URL oficial | Método de acesso |
|---|---|---|
| Parameters | https://infraspeak.stoplight.io/docs/api/1f866ecae49d8-parameters | Fetch estático ✅ |

### Parâmetros de filtragem globais (confirmados)

A documentação oficial descreve um sistema de parâmetros denominado **JQL**, aceito como query string em quase todos os endpoints.

Confirmado na documentação oficial:

| Parâmetro | Tipo | Descrição (confirmada) | Exemplo (confirmado) |
|---|---|---|---|
| `date_min_<field>` | string | Filtra pelo valor mínimo de um campo de data | `?date_min_approved_date=2020-08-03T10:59:00` |
| `date_max_<field>` | string | Filtra pelo valor máximo de um campo de data | `?date_max_started_date=2020-08-03T10:59:00` |
| `expanded` | string | Inclui relações do recurso. As relações expandidas aparecem no atributo `included` da resposta. O atributo `relationships` no objeto indica as relações suportadas. | `?expanded=relation1,relation2` |
| `limit` | integer | Limita o número de resultados. Padrão: **200**. | `?limit=200` |
| `sort` | string | Ordena por campo em ordem crescente. Sufixo `-` para ordem decrescente. | `?sort=name` ou `?sort=name-` |
| `s_<field>` | string | Pesquisa campo por valor exato | `?s_code=ABC123` |
| `s_<field>_in` | string | Pesquisa campo cujo valor esteja na lista fornecida | `?s_category_id_in=777,888,999` |
| `s_<field>_notin` | string | Pesquisa campo cujo valor **não** esteja na lista fornecida | `?s_category_id_notin=111,222,333` |
| `s_<field>_like` | string | Pesquisa campo que contém o valor fornecido (case insensitive) | `?s_name_like=john` |
| `s_<relation>-<field>[_in,_notin,_like]` | string | Pesquisa campo de uma relação por valor | `?s_work-cost_center_id_notin=null` |

Confirmado na documentação oficial:

> *"Almost all endpoints accept optional parameters which can be passed as HTTP query string parameters to filter, limit and sort the data in an API response. We call these parameters JQL."*
> *"For the 'filtering' parameters (e.g.: date_min_*, date_max_*, s_*), each resource has its own 'searchable' fields defined on the endpoint description."*

### Filtros específicos por recurso

Não foi possível confirmar na documentação oficial os campos filtráveis específicos do recurso "Requests". As páginas de recurso individual requerem autenticação no Stoplight para exibir conteúdo.

---

## 5. Estrutura da resposta

### Fontes confirmadas

| Secção | URL oficial | Método de acesso |
|---|---|---|
| Errors | https://infraspeak.stoplight.io/docs/api/be910e4a766ea-errors | Fetch estático ✅ |
| Pagination | https://infraspeak.stoplight.io/docs/api/7d56ca7f2fd57-pagination | Screenshot (browser) ✅ |
| Parameters | https://infraspeak.stoplight.io/docs/api/1f866ecae49d8-parameters | Fetch estático ✅ |
| Request/Response Format | https://infraspeak.stoplight.io/docs/api/a8b365c9886ae-request-response-format | Ecrã em branco após renderização ❌ |

### Estrutura geral de resposta (parcialmente confirmada)

A partir da página "Pagination", a estrutura de resposta para listas inclui os seguintes atributos de topo:

| Atributo | Descrição (confirmada) |
|---|---|
| `data` | Array com os registos retornados |
| `meta.pagination.per_page` | Número de itens por página |
| `meta.pagination.current_page` | Número da página atual |
| `links.self` | URL da página atual |
| `links.first` | URL da primeira página |
| `links.prev` | URL da página anterior (ausente na primeira página) |
| `links.next` | URL da próxima página (ausente na última página) |

A partir da página "Parameters":

| Atributo | Descrição (confirmada) |
|---|---|
| `included` | Contém as relações expandidas quando o parâmetro `expanded` é utilizado |
| `relationships` (em cada objeto) | Indica quais relações o objeto suporta |

### Estrutura de resposta de erro (confirmada)

Confirmado na documentação oficial (página "Errors"):

```json
{
  "status": "error",
  "error": {
    "http_code": 400,
    "message": "Property validation error.",
    "properties": {
      "name": [
        "You must provide a value for the name field."
      ],
      "code": [
        "You must provide a value for the code field."
      ]
    }
  }
}
```

| Campo | Tipo | Descrição (confirmada) |
|---|---|---|
| `status` | string | Valor `"error"` em respostas de erro |
| `error.http_code` | integer | Código HTTP do erro |
| `error.message` | string | Descrição do erro |
| `error.properties` | object | Presente **apenas em erros de validação**; detalha os campos com problema |

### Campos específicos do recurso "Requests"

Não foi possível confirmar na documentação oficial. A página "Request/Response Format" exibiu ecrã em branco após renderização com browser. As páginas de recurso individual requerem autenticação no Stoplight.

---

## 6. Rate Limit

### Fonte confirmada

| Secção | URL oficial | Método de acesso |
|---|---|---|
| Throttling | https://infraspeak.stoplight.io/docs/api/bb96dca8ef317-throttling | Fetch estático ✅ |

### Existe limite de chamadas?

**Sim.** Confirmado na documentação oficial:

> *"So, in order to control the incoming traffic from the API, you can perform a limited number of requests in a given period of time. Currently, the limit is 60 requests per minute."*

### Quantidade e janela de tempo (confirmados)

| Parâmetro | Valor (confirmado) |
|---|---|
| Limite | **60 requisições** |
| Janela de tempo | **1 minuto (60 segundos)** |

### Headers de rate limit em cada resposta (confirmados)

| Header | Descrição (confirmada) |
|---|---|
| `X-Ratelimit-Limit` | Total de requisições permitidas na janela de 60 segundos |
| `X-Ratelimit-Remaining` | Requisições restantes até o reset da janela |

### Comportamento ao exceder o rate limit (confirmado)

Confirmado na documentação oficial:

> *"Once you reach the rate limit, subsequent requests will get a 429 Too Many Requests HTTP status code response until the 1-minute timeframe is reset. This means that you need to wait for the period of time to reset in order to execute requests again."*

**Headers adicionais retornados quando o rate limit é excedido (confirmados):**

| Header | Descrição (confirmada) |
|---|---|
| `Retry-After` | Tempo em **segundos** que o cliente deve aguardar antes de fazer novas requisições |
| `X-RateLimit-Reset` | Momento do reset do rate limit em formato **UNIX timestamp** |

### Recomendação documentada oficialmente

> *"To avoid rate limiting, do not use polling: use Webhooks instead."*

---

## 7. Erros

### Fonte confirmada

| Secção | URL oficial | Método de acesso |
|---|---|---|
| Errors | https://infraspeak.stoplight.io/docs/api/be910e4a766ea-errors | Fetch estático ✅ |

Confirmado na documentação oficial:

> *"Infraspeak uses conventional HTTP response codes to indicate the success or failure of an API request. In general: codes in the 2xx range indicate success, while codes in the 4xx range indicate an error that failed given the information provided. Codes in the 5xx range indicate an error related to Infraspeak's servers (these are rare)."*

Todos os seguintes códigos são confirmados na documentação oficial:

| Código HTTP | Tipo (confirmado) | Significado (confirmado) |
|---|---|---|
| `400 Bad Request` | Erro do cliente | Ocorre quando parâmetros inválidos são fornecidos ou em erros de validação. Ex.: criar recurso sem campos obrigatórios. O atributo `properties` na resposta fornece mais detalhes. |
| `401 Unauthorized` | Erro de autenticação ou permissão | Token de acesso em falta, incorreto ou inválido. Também ocorre ao usar um token revogado. |
| `404 Not Found` | Recurso não encontrado | Requisições a recursos que não existem ou URLs malformadas. |
| `405 Method Not Allowed` | Método HTTP inválido | Uso de método HTTP não suportado. Ex.: usar `POST` num recurso read-only, ou `PUT` em lugar de `PATCH`. |
| `429 Too Many Requests` | Rate limit excedido | O cliente enviou demasiadas requisições no período configurado. Ver secção Rate Limit. |
| `500 Internal Server Error` | Erro interno do servidor | Erro no lado da Infraspeak (classificado como raro). A documentação solicita reporte com: endpoint, headers e body da requisição. |

---

## 8. Exemplo real

O exemplo abaixo usa **exclusivamente informações confirmadas na documentação oficial**. O valor de `<API base URL>` é utilizado como placeholder porque a documentação oficial não especifica explicitamente o host nas páginas acessíveis.

### Exemplo de requisição — Listar recursos com filtros e paginação

```http
GET <API base URL>/v3/<recurso>?limit=50&page=1&sort=name-&s_name_like=manutencao&expanded=relation1 HTTP/1.1
Authorization: Bearer SEU_PERSONAL_ACCESS_TOKEN
Accept: application/json
User-Agent: MinhaApp (contacto@minhaempresa.com)
```

**Parâmetros utilizados e suas fontes:**

| Parâmetro | Valor | Confirmado em |
|---|---|---|
| `limit` | `50` | Página Parameters + Pagination — padrão é 200 |
| `page` | `1` | Página Pagination — numeração começa em 1 |
| `sort` | `name-` | Página Parameters — sufixo `-` indica decrescente |
| `s_name_like` | `manutencao` | Página Parameters — busca parcial case-insensitive |
| `expanded` | `relation1` | Página Parameters — inclui relações no `included` |

**Headers utilizados e suas fontes:**

| Header | Fonte |
|---|---|
| `Authorization: Bearer ...` | Página HTTP request headers |
| `Accept: application/json` | Página HTTP request headers |
| `User-Agent: ...` | Página HTTP request headers |

### Exemplo de resposta de sucesso (estrutura confirmada)

```json
{
  "data": [
    { "...": "campos do recurso" }
  ],
  "meta": {
    "pagination": {
      "per_page": 50,
      "current_page": 1
    }
  },
  "links": {
    "self": "<API base URL>/v3/<recurso>?page=1",
    "first": "<API base URL>/v3/<recurso>?page=1",
    "next": "<API base URL>/v3/<recurso>?page=2"
  }
}
```

### Exemplo de resposta de erro 400 (estrutura confirmada)

```json
{
  "status": "error",
  "error": {
    "http_code": 400,
    "message": "Property validation error.",
    "properties": {
      "name": ["You must provide a value for the name field."]
    }
  }
}
```

### O que NÃO foi possível incluir no exemplo

Não foi possível confirmar na documentação oficial:
- O host e path exatos do endpoint (ex.: URL base, path do recurso "Requests")
- Os campos da resposta específicos do recurso "Requests"

---

## 9. Restrições

Todas as restrições abaixo são confirmadas na documentação oficial com citação da fonte:

1. **HTTPS obrigatório** *(página Requirements)*: *"You need to access the API over HTTPS, using SSL."* Não é possível aceder à API via HTTP simples.

2. **Autenticação obrigatória em todas as requisições** *(página Requirements)*: *"API requests without authentication will fail."*

3. **Rate limit fixo de 60 requisições por minuto** *(página Throttling)*: *"Currently, the limit is 60 requests per minute."* Ao exceder, recebe-se `429` até ao reset da janela de 1 minuto.

4. **PAT válido apenas para o ambiente de emissão** *(página Generating a Token)*: *"PATs are valid only for the environment where they are generated."*

5. **Emissão de PAT requer contacto com a Infraspeak** *(página Generating a Token)*: O processo de obtenção do token envolve contacto direto. Não existe endpoint self-service documentado.

6. **Revogação de PAT é irreversível e imediata** *(página Revoking a Token)*: *"Once you revoke a token, it will stop working with immediate effect. This action is irreversible."*

7. **O parâmetro `limit` é limitado pelo máximo do recurso** *(página Parameters)*: *"If the specified limit exceeds the resource's maximum limit, the resource's maximum limit will be used instead."* O valor máximo específico por recurso não está declarado globalmente.

8. **Filtros são por campo e por recurso** *(página Parameters)*: *"each resource has its own 'searchable' fields defined on the endpoint description."* Não é possível filtrar por qualquer campo — apenas pelos campos declarados como pesquisáveis no recurso.

9. **Polling desaconselhado** *(página Throttling)*: *"To avoid rate limiting, do not use polling: use Webhooks instead."*

---

## 10. Recomendações

As recomendações abaixo são derivadas **exclusivamente** do que a documentação oficial declara. Onde a documentação não se pronuncia, isso é assinalado.

### Autenticação

- Tratar o PAT como senha *(documentado: "Your API tokens need to be treated as secure as any other password")*: não versionar em repositórios, não expor em logs, armazenar em variável de ambiente segura.
- Manter tokens separados para sandbox e produção — não são intercambiáveis *(documentado: "PATs are valid only for the environment where they are generated")*.
- O token não expira, mas pode ser revogado a qualquer momento com efeito imediato e de forma irreversível *(documentado)*. Monitorizar respostas `401` — podem indicar revogação do token.
- Solicitar o PAT de produção apenas após validação completa no ambiente sandbox *(fluxo documentado)*.

### Paginação

- Usar o parâmetro `limit` para controlar o volume de dados por requisição *(documentado)*.
- O valor padrão é 200 itens por página *(documentado)*; valores superiores ao máximo do recurso são automaticamente limitados *(documentado)*.
- Para navegar entre páginas, usar o parâmetro `page` a partir de 1 *(documentado)*; omitir retorna a primeira página *(documentado)*.
- Verificar a presença do campo `links.next` na resposta para determinar se existem mais páginas *(estrutura confirmada na documentação)*.

### Tratamento de erros

- Para `400`: inspecionar o campo `properties` da resposta para identificar quais campos falharam *(documentado: "you can check the properties attribute on the response for more details")*.
- Para `429`: aguardar o número de segundos indicado no header `Retry-After` *(documentado)*; o header `X-RateLimit-Reset` indica o momento exato do reset *(documentado)*.
- Para `500`: reportar à Infraspeak com endpoint, headers e body da requisição *(documentado: "Please, report us and try to provide as much information as possible")*.
- Para `401` com token revogado: a revogação é irreversível *(documentado)*; é necessário obter um novo token.

### Performance

- **Não usar polling** — usar **Webhooks** *(recomendação explícita da documentação: "do not use polling: use Webhooks instead")*.
- Usar o parâmetro `expanded` apenas para as relações necessárias *(parâmetro documentado como opcional)*.
- Filtrar os dados diretamente na API usando os parâmetros JQL (`s_*`, `date_min_*`, `date_max_*`) *(documentado como funcionalidade disponível)*.
- Ordenar os resultados na API usando o parâmetro `sort` *(documentado)*.

### Retries

- Para `429 Too Many Requests`: aguardar o valor do header `Retry-After` em segundos antes de retomar *(documentado)*.
- Para outros códigos de erro: a documentação oficial não descreve estratégia de retry. Qualquer outra estratégia de retry **não pôde ser confirmada na documentação oficial**.

### Segurança

- Comunicar exclusivamente via HTTPS *(obrigatório conforme documentado)*.
- Incluir o header `User-Agent` com nome e contacto da aplicação *(documentado como header da API)*.
- Não expor o valor do header `Authorization` em logs *(implícito no tratamento de tokens como senhas, conforme documentado)*.

---

## 11. Campos confirmados do recurso `failures` (chamada real — 20/07/2026)

Integração ATIVADA. Confirmado com chamada real ao **sandbox** (`https://api.sandbox.infraspeak.com/v3/failures`, PAT sandbox):

- **URL base sandbox:** `https://api.sandbox.infraspeak.com/v3` (o PAT é válido só para o ambiente onde foi emitido; produção usará `https://api.infraspeak.com/v3` com PAT de produção).
- **Recurso:** `GET /failures` — lista os chamados (failures).
- **Formato do item (estilo JSON:API):** `{ "type": "failure", "id": "709936", "attributes": { ... } }`.
- **Envelope:** `data` + `meta.pagination` (`total`, `count`, `per_page`, `current_page`, `total_pages`) + `links` (`self`, `first`, `last`, e `next`/`prev` quando aplicável) — compatível com a paginação já implementada no client (detecção por `links.next`).

### Campos de `attributes` observados no payload real

`uuid`, `failure_id`, `problem_id`, `problem_name`, `status`, `state` (iguais no payload observado), `report_date`, `completed_date`, `approved_date`, `paused_date`, `state_description`, `description`, `observations`, `entity_id`, `priority`, `priority_text`, `client_id`, `client_code`, `client_name`, `local_id`, `local_code`, `local_name`, `root_local_id`, `solved`, `confirmed`, `next_schedule`, `message_count`, `time_statistics` (objeto), `supplier_id`, `signature_status`, `last_status_change_date`, `next_sla_date`, `next_sla_percentage`, `approved_by_id`, `completed_by_id`, `reported_by_id`, `started_by_id`, `manpower_duration`, `manpower_cost`, `started_date`, `cost_center_id`, `external_id`, `next_failure_sla_id`, `next_failure_sla_date`, `next_failure_sla_status_order`, `failure_priority_id`, `network_failure_id`, `gatekeeper_id`, `created_at`, `updated_at`, `date_deleted`, `failure_original_mapping_id`.

Datas vêm como strings `"YYYY-MM-DD HH:mm:ss"` (sem timezone explícito no payload).

### Mapeamento interno

O `RequestsService` (`apps/backend/src/modules/infraspeak/application/requests.service.ts`) mapeia cada item para um formato interno limpo (`InfraspeakRequestItem`: id, uuid, descrição, estado, prioridade, problema, cliente, local, datas do ciclo de vida, SLA, flags) **preservando o payload original íntegro em `raw`**. Endpoint interno: `GET /infraspeak/requests` (JWT obrigatório), com auto-paginação e repasse de filtros JQL via query string.

Configuração ativa: `INFRASPEAK_API_BASE_URL=https://api.sandbox.infraspeak.com/v3`, `INFRASPEAK_REQUESTS_PATH=failures`, `INFRASPEAK_API_TOKEN` (Secret).

---

## Criação de chamados (`POST /failures`) — contrato confirmado no sandbox (31/07/2026)

Descoberto por sondagem real (POST vazio → erros de validação por campo; criação de teste bem-sucedida → chamado `#710185`).

- **Endpoint:** `POST /failures` com `Content-Type: application/json`.
- **Payload:** `{ "problem_id": <int>, "local_id": <int> | "element_id": <int>, "description": "<texto>", "priority": 1–4 }`.
- **Campos obrigatórios (mensagens reais da API):**
  - `problem_id` — obrigatório; precisa ser um problem **folha** (`problem_type`). Áreas (`problem_area`) são recusadas com `"O tipo de chamado deve existir"`.
  - `local_id` **ou** `element_id` — exatamente um dos dois é exigido ("obrigatório quando o outro não está presente").
- **Prioridade:** inteiro 1–4 (validação real: `"O campo priority deverá ter um valor entre 1 - 4"`); 2 = `NORMAL`.
- **Resposta de sucesso:** `201/200` com envelope de objeto único `{ "data": { "type": "failure", "id": "...", "attributes": { ...mesmos campos do GET... } } }` — estado inicial observado: `WAITING_APPROVAL`.
- **Erros de validação:** `400` com `error.properties` (mapa campo → lista de mensagens em pt) — o client concatena essas mensagens na exceção para o usuário saber o que corrigir.

### Recursos de apoio ao formulário

- **Problems folha:** `GET /problems?expanded=children,clients` — `data` traz as áreas (`problem_area`, `parent_id: null`) com os atributos `all_clients` (boolean) e a relação `clients` (lista de clientes permitidos quando `all_clients=false`); os tipos folha (`problem_type`, com `parent_id` apontando para a área) chegam no array **`included`** — os filhos herdam o escopo da área pai. Sem `expanded=children`, os folhas não aparecem em lugar nenhum.
- **Locais:** usar `GET /locations` (JSON:API; `type` ∈ `building` | `location-folder` | `location`) e oferecer **somente `type: "location"`** — a criação recusa prédios/pastas com `"O edifício deve existir"` / `"Building must exist"`. Os prédios (`type: "building"`) têm `client_id` direto; as locations têm `root_parent_id` apontando para o prédio (resolução de client_id sem request adicional). Atenção: `GET /locals` (payload plano) devolve **apenas os prédios raiz**, não serve para o formulário.
- **Elements:** `GET /elements` — JSON:API (`type: "element"`, `attributes.element_id`, `local_id`).

### Implementação interna

`InfraspeakClient.post()` (sem retry pós-envio, exceto 429), `RequestsService.create()` + `getFormOptions()`, endpoints `POST /infraspeak/requests` e `GET /infraspeak/form-options` (JWT). A criação entra na trilha de auditoria via allowlist do `AuditInterceptor` (`CREATE / Chamado Infraspeak`).

---

## Filtro de problemas por contexto de local — causa raiz e estratégia (05/08/2026)

### Problema reportado

Chamados criados via BlueBee eram rejeitados pelo ambiente do cliente com "Área de Problema / Tipo de Problema não cadastrado naquele ambiente". O formulário carregava `GET /problems?expanded=children` e `GET /locations` sem nenhum filtro por contexto (building/cliente).

### Causa raiz comprovada (sandbox 05/08/2026)

Em produção, `problem_area` com `all_clients=false` possui a relação `clients` preenchida com IDs dos clientes permitidos. A criação de failure com um local de cliente X e um tipo de problema restrito a clientes Y/Z é rejeitada pela Infraspeak com:

```
POST /failures { "problem_id": <restrito>, "local_id": <cliente X> }
→ HTTP 400 {
    "status": "error",
    "error": {
      "http_code": 400,
      "message": "Property validation error.",
      "properties": {
        "problem_id": ["O tipo de chamado deve existir", "validation.has_access_network"]
      }
    }
  }
```

Reprodução adicional capturada (area pai em vez de tipo folha):

```
POST /failures { "problem_id": 28309, "local_id": 387903 }  ← area, não leaf
→ HTTP 400 { "properties": { "problem_id": ["O tipo de chamado deve existir"] } }
```

### Filtros nativos — inexistentes (confirmado sandbox)

| Tentativa | Resultado |
|---|---|
| `GET /problems?s_client_id=75472` | HTTP 500, `code: "42703"` (coluna inexistente) |
| `GET /problems?s_local_id=387903` | HTTP 500, `code: "42703"` |
| `GET /problems?s_building_id=387904` | HTTP 500, `code: "42703"` |
| `GET /clients/75472/problems` | HTTP 404 |
| `GET /buildings/387904/problems` | HTTP 404 |
| `GET /problems?expanded=children,locations` | HTTP 400 (relação inexistente) |

**Conclusão: a API Infraspeak NÃO oferece filtragem nativa de problems por client_id, local_id ou building. O filtro deve ser feito client-side.**

### Estrutura da relação `clients` em problems (confirmado sandbox)

```
GET /problems?expanded=children,clients
→ data[]: problem_area com:
    attributes.all_clients: true | false
    relationships.clients.data: [{ type: "client", id: "75473" }, ...]  ← vazio quando all_clients=true
→ included[]: problem_type (tipos folha) — NÃO têm relação `clients`
              herdam o escopo via parent_id → area.all_clients/clientIds
```

### Estrutura de client_id em locations (confirmado sandbox)

```
GET /locations
→ type=building:  attributes.client_id = 75472 | 75473 | null
→ type=location:  attributes.client_id = null
                  attributes.root_parent_id = <building local_id>  ← resolve clientId
→ type=location-folder: excluídos do formulário (recusados na criação)
```

### Estratégia adotada: derivação client-side sem requests extras

1. `GET /problems?expanded=children,clients` (parâmetro `clients` adicionado) — extrai `allClients` + `clientIds` de cada área e propaga para os tipos filhos
2. `GET /locations` (mesmo payload) — mapeia `building.local_id → client_id`; resolve `location.clientId = buildingMap[root_parent_id]`
3. No frontend, ao selecionar o local, o `clientId` do local drive a filtragem:
   - `allClients=true` → problema aparece para qualquer local
   - `allClients=false` → problema aparece só se `clientId ∈ clientIds`
   - Sem local selecionado → lista completa (sem filtro)
  - Local selecionado com `clientId=null` (indeterminado) → modo seguro: só `all_clients=true` + aviso (ver seção "Endurecimento" abaixo)
4. Reset visível de `problemId` quando a seleção anterior fica inválida ao trocar de local
5. Mapeamento do erro 400 "O tipo de chamado deve existir" / "validation.has_access_network" → mensagem legível em PT (defesa em profundidade)

### Verificação sandbox pós-implementação (05/08/2026)

```
# 92 tipos folha — todos com allClients=True no sandbox
# 217 locations — todos com clientId resolvido via root_parent_id → building
# Submission válida continua funcionando:
POST /failures { problem_id: 28310, local_id: 387903 } → 200 (failure #710554)
POST /failures { problem_id: 28310, local_id: 388053 } → 200 (failure #710555, cliente 75473)
# Erro de area pai confirmado:
POST /failures { problem_id: 28309, local_id: 387903 } → 400 "O tipo de chamado deve existir"
```

### Endurecimento: local com cliente indeterminado (06/08/2026)

Quando o local selecionado no formulário não tem `clientId` resolvível
(ex.: `root_parent_id` sem prédio correspondente ou prédio sem `client_id`),
o frontend entra em **modo seguro**: oferece apenas tipos com
`all_clients=true` e exibe aviso explícito ao usuário — nunca a lista
completa silenciosa (que permitiria escolher combinação rejeitável).
Trocar para um local nesses termos também reseta seleção de tipo restrito.
Ver `filterProblemsForLocal` em `CreateInfraspeakRequestModal.tsx` (+ specs).

### Verificação no ambiente de teste do cliente — PENDENTE

Segundo a Infraspeak, no ambiente de teste do cliente existem somente as
áreas/tipos permitidos (áreas com `all_clients=false` + relationship
`clients` populada). A validação ponta a ponta contra esse ambiente
(inspeção de `/problems?expanded=children,clients`, `/locations` e testes de
criação com tipo permitido × proibido) **aguarda o PAT e a base URL desse
ambiente** — o token atual é do sandbox (21 áreas, todas `all_clients=true`,
verificado em 06/08/2026). Registrar aqui os achados quando executada.

---

## Tabela de rastreabilidade das fontes

| Secção do relatório | URL oficial | Método | Status |
|---|---|---|---|
| 1. Autenticação — geração de token | https://infraspeak.stoplight.io/docs/api/efb05786d9dac-generating-a-token | Fetch estático | ✅ Completa |
| 1. Autenticação — header Authorization | https://infraspeak.stoplight.io/docs/api/f1c0bb5de545c-http-request-headers | Fetch estático | ✅ Completa |
| 1. Autenticação — revogação | https://infraspeak.stoplight.io/docs/api/cb1235a9a476a-revoking-a-token | Screenshot (browser) | ✅ Completa |
| 1. Autenticação — using the token | https://infraspeak.stoplight.io/docs/api/b12bdbebe6402-using-the-token | Fetch + Screenshot | ❌ Ecrã em branco |
| 2. Endpoint — introdução/requisitos | https://infraspeak.stoplight.io/docs/api/f89e68a07621b-requirements | Screenshot (browser) | ✅ Completa |
| 2. Endpoint — recursos individuais | (páginas de cada recurso) | Fetch + Screenshot | ❌ Requerem auth Stoplight |
| 3. Paginação — parâmetros e estrutura | https://infraspeak.stoplight.io/docs/api/7d56ca7f2fd57-pagination | Screenshot (browser) | ✅ Completa |
| 4. Filtros — parâmetros JQL | https://infraspeak.stoplight.io/docs/api/1f866ecae49d8-parameters | Fetch estático | ✅ Completa |
| 5. Estrutura resposta — erros | https://infraspeak.stoplight.io/docs/api/be910e4a766ea-errors | Fetch estático | ✅ Completa |
| 5. Estrutura resposta — paginação | https://infraspeak.stoplight.io/docs/api/7d56ca7f2fd57-pagination | Screenshot (browser) | ✅ Completa |
| 5. Estrutura resposta — recursos | https://infraspeak.stoplight.io/docs/api/a8b365c9886ae-request-response-format | Fetch + Screenshot | ❌ Ecrã em branco |
| 6. Rate Limit / Throttling | https://infraspeak.stoplight.io/docs/api/bb96dca8ef317-throttling | Fetch estático | ✅ Completa |
| 7. Erros | https://infraspeak.stoplight.io/docs/api/be910e4a766ea-errors | Fetch estático | ✅ Completa |
| 8. Exemplo — headers | https://infraspeak.stoplight.io/docs/api/f1c0bb5de545c-http-request-headers | Fetch estático | ✅ Completa |
| 8. Exemplo — parâmetros | https://infraspeak.stoplight.io/docs/api/1f866ecae49d8-parameters | Fetch estático | ✅ Completa |
| 9. Restrições | Múltiplas (citadas no texto) | Múltiplos | ✅ Confirmadas |
| 10. Recomendações | Múltiplas (citadas no texto) | Múltiplos | ✅ Derivadas do documentado |
