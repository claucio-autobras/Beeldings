---
name: Next 16 e mocks parciais
description: Regras de runtime para scripts no layout e respostas incompletas do modo de demonstração.
---

Scripts de inicialização no `RootLayout` devem usar o componente oficial `next/script`; não renderize uma tag `<script>` diretamente no JSX do layout.

**Why:** No Next 16 em desenvolvimento, uma tag de script renderizada pelo componente pode gerar erro de hidratação e impedir a validação visual mesmo quando o build de produção compila.

**How to apply:** Use `strategy="beforeInteractive"` quando o script precisa rodar antes do primeiro paint, mantendo nonce e conteúdo inline no componente oficial.

Depois de alterações em uma rota, o cache de desenvolvimento do Turbopack pode manter a compilação daquela rota presa, mesmo com o código válido. Limpar `.next` e reiniciar o workflow restaura a compilação.

**Why:** O sintoma aparece como login eternamente carregando porque a navegação pós-login espera a rota protegida; outras rotas continuam funcionando e não há erro de API.

**How to apply:** Se apenas uma rota alterada fica pendente e o servidor não registra `GET` concluído, limpe somente o cache gerado `.next` antes de investigar credenciais ou reescrever o fluxo de autenticação.

Respostas esperadas como objeto devem ser validadas na fronteira de apresentação antes de acessar estruturas aninhadas.

**Why:** O fallback genérico do modo de demonstração pode responder `[]` para endpoints ainda não mapeados; arrays são truthy e passam por verificações simples, causando erro ao acessar campos internos.

**How to apply:** Trate formato incompleto como estado “sem dados” ou erro não bloqueante; não fabrique métricas para preencher o mock.