---
name: Recuperação de senha e 2FA por e-mail
description: Regras de segurança e operação dos desafios de autenticação enviados por e-mail.
---

Desafios de recuperação de senha e 2FA por e-mail devem persistir somente um hash do segredo, com expiração, limite de tentativas e marca de consumo. A sessão/JWT só pode ser emitida depois da confirmação do código de 2FA; toda troca de senha deve invalidar as sessões anteriores.

**Why:** Evita que um vazamento do banco revele links/códigos utilizáveis, reduz tentativas de força bruta, impede reutilização e não deixa uma senha redefinida convivendo com sessões antigas. Rotações simultâneas também podem enviar códigos concorrentes, deixando usuários com um e-mail que nunca funcionará.

**How to apply:** Produção exige 2FA por e-mail por padrão, exceto a conta operacional `admin@autobras.com.br`, que autentica apenas com senha. Desenvolvimento pode ativá-lo com `EMAIL_2FA_REQUIRED=true`, mas sem um provedor de e-mail o login não deve concluir quando 2FA estiver ativo. Criação, consumo e reenvio são serializados por usuário/tipo; reenvio mantém o mesmo desafio e respeita uma janela curta, sem trocar o código quando o anterior ainda é válido. Links de recuperação usam a URL pública configurável (`APP_URL`), com domínio produtivo como padrão.