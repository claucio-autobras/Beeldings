# Deploy do Gateway BlueBee (Windows)

O gateway é distribuído como um **executável único** (`bluebee-gateway.exe`, com
o Node embutido) e instalado como **serviço do Windows** via NSSM.

## Gerar a distribuição (na máquina de build)

```bash
cd apps/gateway
npm run package:win
```

Isso compila o gateway, gera o `.exe` com [`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg)
e monta a pasta `apps/gateway/release/`:

```
release/
├─ bluebee-gateway.exe    # gateway (Node embutido — não precisa instalar Node no cliente)
├─ nssm.exe               # wrapper de serviço do Windows
├─ install-service.bat    # instala/inicia o serviço (rodar como Administrador)
├─ uninstall-service.bat  # para/remove o serviço (rodar como Administrador)
└─ .env.example           # modelo de configuração
```

> `release/` e `vendor/` são ignorados pelo git. O `nssm.exe` fica vendorizado em
> `apps/gateway/service/` (domínio público) para o build não depender do nssm.cc.
> O alvo do pkg é `node22-win-x64` (`.exe` ~80 MB). Para um binário menor, troque
> o target em `package.json` → `pkg.targets` / script `build:exe` (ex: `node20-win-x64`).

## Instalar no computador do cliente

1. Copie a pasta `release/` para o cliente (ex: `C:\BlueBee\Gateway\`).
2. Baixe o **`.env` do gateway** na plataforma BlueBee e coloque na **mesma pasta**
   do `bluebee-gateway.exe`.
3. Clique com o botão direito em **`install-service.bat`** → **Executar como
   administrador**.

O serviço **BlueBee IoT Gateway** passa a iniciar junto com o Windows e reinicia
sozinho em caso de falha.

- Gerenciar: `services.msc` → "BlueBee IoT Gateway".
- Logs: `gateway.log` na mesma pasta (rotaciona a cada 10 MB).

## Atualizar

Pare o serviço (ou rode `uninstall-service.bat`), substitua o `bluebee-gateway.exe`,
e rode `install-service.bat` novamente.

## Desinstalar

Rode **`uninstall-service.bat`** como administrador.

## Observações

- O `.exe` lê o `.env` **ao lado do executável** (não do diretório de trabalho),
  então funciona mesmo rodando como serviço (cujo cwd é `System32`).
- O gateway abre a porta HTTP definida em `PORT` (padrão 3001) e conecta no broker
  MQTT de `MQTT_BROKER_URL`. Garanta que essas portas/rede estejam liberadas no host.
