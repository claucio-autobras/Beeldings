---
name: Sessão via cookie HttpOnly
description: Como a sessão de login funciona após a migração do localStorage para cookie HttpOnly
---

# Sessão via cookie HttpOnly

- O JWT vive SÓ no cookie `bluebee_session` (HttpOnly, Secure, SameSite=Lax, path=/, 7d), emitido em `POST /auth/login` e expirado em `POST /auth/logout` (logout SEM guard de propósito — precisa funcionar com token expirado).
- **Why:** token em localStorage/document.cookie era roubável por XSS.
- Extração no backend: header `Authorization` primeiro (serviços internos/testes/curl), fallback cookie — util central `session-cookie.ts` (parse manual, sem cookie-parser), reusado pelo handshake do Socket.IO (`withCredentials: true` no cliente, sem `auth: { token }`).
- Frontend NUNCA armazena o token: `LoginResult.accessToken` continua no corpo só para uso programático e é ignorado pelo browser. localStorage guarda só `bluebee_user` (hidratação otimista); a validade real vem de `GET /auth/profile` com credentials no AuthProvider.
- Todo fetch ao backend precisa de `credentials: 'include'` (api-client e downloads de PDF/CSV/zip).
- Middleware do Next checa presença do cookie `bluebee_session`; o nome legado `bluebee_access_token` (localStorage + cookie JS) é propositalmente ignorado e purgado no load → sessões antigas caem no login.
- **Gotcha:** o proxy do preview Replit reescreve `SameSite=Lax` para `None` no Set-Cookie — verificar atributos direto em `localhost:4000`, não pelo domínio .replit.dev. Curl de teste precisa de https (Secure) ou localhost.
- Modo mock ainda grava um cookie `bluebee_session=mock` legível por JS só para o middleware liberar rotas (sem backend).
