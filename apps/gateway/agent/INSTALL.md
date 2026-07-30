# BlueBee IoT — Instalação do Gateway (Agente)

Este pacote contém o **código-fonte do gateway** que conecta os equipamentos de
campo (BACnet/Modbus) à plataforma BlueBee via MQTT.

A instalação roda **`npm install`** na pasta, compila o gateway e o registra como
**serviço** (Windows ou Linux) para subir sozinho no boot e reiniciar em caso de
falha.

---

## 1. Pré-requisitos

- Máquina **sempre ligada (24/7)** na mesma rede dos equipamentos de automação.
- **Node.js 20+** instalado — baixe em https://nodejs.org (no Windows, marque a
  opção *"Add to PATH"* durante a instalação).
- Saída de rede liberada para o broker MQTT.
- O arquivo **`gateway-config.env`** do projeto (baixe na plataforma em
  **Projetos → Baixar gateway-config.env**).

> No Windows, módulos nativos podem exigir as *Build Tools*. Se o `npm install`
> falhar compilando dependências, instale uma vez:
> `npm install --global --production windows-build-tools` (PowerShell como Admin)
> ou instale o "Desktop development with C++" pelo Visual Studio Build Tools.

---

## 2. Passo a passo — Windows

1. **Baixe** o `.zip` na plataforma (página **Agente de Gateway**).
2. **Descompacte** a pasta diretamente em **`C:\`** (ex.:
   `C:\bluebee-gateway-agent`).
   > Extrair em `C:\` evita erros de instalação quando o nome do usuário
   > Windows tem acento e facilita encontrar a pasta depois.
3. Copie o **`gateway-config.env`** (baixado na criação do projeto do cliente)
   para **dentro dessa pasta**. O instalador o renomeia para `.env`
   automaticamente.
4. Clique com o botão direito em **`instalar.bat`** → **Executar como
   administrador**.

O `instalar.bat` faz tudo de uma vez:

- roda `npm install` (baixa as dependências),
- roda `npm run build` (compila o gateway),
- registra e inicia o **Serviço do Windows** `BlueBeeGateway` (via NSSM).

**Verificar / acompanhar:**

```bat
sc query BlueBeeGateway
REM logs em gateway.log na mesma pasta
```

Gerencie também pelo `services.msc` (procure por **"BlueBee IoT Gateway"**).

> Em desktop, desative suspensão/hibernação para a coleta não parar.

---

## 3. Passo a passo — Linux (systemd)

1. **Extraia** o `.zip` (ele cria a pasta `bluebee-gateway-agent/`, ex.: em
   `/opt`) e entre na pasta.
2. Copie o **`gateway-config.env`** para essa pasta (vira `.env`
   automaticamente).
3. Rode o instalador como root:

```bash
sudo bash instalar.sh
```

O `instalar.sh` roda `npm install`, `npm run build`, cria o serviço
`bluebee-gateway` no systemd e o inicia.

**Verificar / acompanhar:**

```bash
systemctl status bluebee-gateway
journalctl -u bluebee-gateway -f
```

---

## 4. Atualizar o gateway

Baixe o pacote novo, extraia **por cima** da pasta atual (mantendo o `.env`) e
rode novamente `instalar.bat` (Windows) ou `sudo bash instalar.sh` (Linux). O
script remove a versão anterior do serviço e reinstala.

---

## 5. Remover o serviço

Necessário, por exemplo, quando for reinstalar do zero por causa de algum erro.

### Windows (recomendado)

Clique com o botão direito em **`remover.bat`** → **Executar como
administrador**. Ele para e remove o serviço `BlueBeeGateway`.

Se preferir os comandos manuais (PowerShell/CMD **como Admin**):

```bat
sc.exe stop BlueBeeGateway
sc.exe delete BlueBeeGateway
sc.exe query BlueBeeGateway
```

> O `remover.bat` faz exatamente isso (via NSSM, com `sc.exe` como reserva), de
> forma automática. Depois de remover, rode o `instalar.bat` novamente para
> reinstalar limpo.

### Linux

```bash
sudo bash remover.sh
```

---

## 6. Conteúdo do pacote

```
bluebee-gateway-agent/
├─ src/                 # código-fonte do gateway
├─ package.json         # dependências (usadas pelo npm install)
├─ tsconfig*.json       # configuração de build
├─ nest-cli.json
├─ .env.example         # modelo de configuração
├─ INSTALL.md           # este guia
│
├─ (Windows) instalar.bat / remover.bat / nssm.exe
└─ (Linux)   instalar.sh  / remover.sh
```

O arquivo **`.env`** (a partir do `gateway-config.env`) deve ficar **na raiz da
pasta**, ao lado do `package.json`.
