'use client';

import { useState } from 'react';
import { Download, HardDriveDownload, Loader2, MonitorCheck, Terminal, ShieldCheck, FileText } from 'lucide-react';
import { downloadAgentPackage, type AgentOs } from '@/modules/gateways/services/agent-package.service';

export default function GatewayAgentPage() {
  const [busy, setBusy] = useState<AgentOs | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(os: AgentOs) {
    setError(null);
    setBusy(os);
    try {
      await downloadAgentPackage(os);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
          <HardDriveDownload className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Agente de Gateway</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Baixe o agente para instalar no equipamento do cliente. Ele conecta os
            dispositivos de campo (BACnet/Modbus) à plataforma via MQTT sobre TLS.
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          Erro ao baixar o pacote: {error}
        </div>
      )}

      {/* Download cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Linux */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm transition-shadow duration-200 hover:shadow-md">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            <h2 className="text-sm font-semibold text-foreground">Linux</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Mini-PC / IPC industrial com systemd (Debian, Ubuntu, Raspberry Pi OS,
            RHEL). Instala como serviço que sobe no boot.
          </p>
          <button
            onClick={() => handleDownload('linux')}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:opacity-50"
          >
            {busy === 'linux' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Baixar para Linux (.zip)
          </button>
        </div>

        {/* Windows */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm transition-shadow duration-200 hover:shadow-md">
          <div className="flex items-center gap-2.5">
            <MonitorCheck className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            <h2 className="text-sm font-semibold text-foreground">Windows</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Windows Server ou estação 24/7. Instala como Serviço do Windows (via
            NSSM) com início automático, sem precisar de usuário logado.
          </p>
          <button
            onClick={() => handleDownload('windows')}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:opacity-50"
          >
            {busy === 'windows' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Baixar para Windows (.zip)
          </button>
        </div>
      </div>

      {/* Pré-requisitos */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Pré-requisitos</h2>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>Máquina <strong>sempre ligada (24/7)</strong> na mesma rede dos equipamentos de automação.</li>
          <li><strong>Node.js 20+</strong> instalado (nodejs.org).</li>
          <li>Saída de rede liberada para o broker na porta <strong>TCP 8883</strong> (não precisa abrir porta de entrada).</li>
          <li>Relógio sincronizado por <strong>NTP</strong>.</li>
          <li>O arquivo <strong>gateway-config.env</strong> do projeto (baixado em Projetos → Baixar gateway-config.env).</li>
        </ul>
      </section>

      {/* Como instalar */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Como instalar</h2>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Linux</h3>
          </div>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal pl-5">
            <li>Extraia o .zip e entre na pasta.</li>
            <li>Coloque o <code className="text-xs">gateway-config.env</code> nessa pasta.</li>
            <li>Rode <code className="text-xs">sudo bash instalar.sh</code>.</li>
          </ol>
          <pre className="text-xs bg-[#0f172a] text-[#e2e8f0] rounded-md p-3 overflow-x-auto">
{`unzip beeldings-gateway-agent-linux.zip
cd beeldings-gateway-agent
# copie o gateway-config.env para esta pasta
sudo bash instalar.sh

# status e logs
systemctl status beeldings-gateway
journalctl -u beeldings-gateway -f`}
          </pre>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MonitorCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Windows</h3>
          </div>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal pl-5">
            <li>Baixe o <strong>.zip</strong> nesta página.</li>
            <li>
              Descompacte a pasta diretamente em <code className="text-xs">C:\</code> (ex.:{' '}
              <code className="text-xs">C:\beeldings-gateway-agent</code>).
            </li>
            <li>
              Coloque o arquivo <code className="text-xs">gateway-config.env</code> (baixado na
              criação do projeto do cliente) dentro da pasta.
            </li>
            <li>
              Clique com o botão direito em <code className="text-xs">instalar.bat</code> e escolha{' '}
              <strong>&quot;Executar como administrador&quot;</strong>.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Extrair em <code className="text-xs">C:\</code> evita erros de instalação quando o nome
            do usuário Windows tem acento e facilita encontrar a pasta depois.
          </p>
          <pre className="text-xs bg-[#0f172a] text-[#e2e8f0] rounded-md p-3 overflow-x-auto">
{`# status e logs (depois de instalado)
sc query BeeldingsGateway
# logs em gateway.log, dentro da pasta do agente`}
          </pre>
          <p className="text-xs text-muted-foreground">
            Em desktop Windows, desative suspensão/hibernação para a coleta não parar.
          </p>
        </div>

        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          O passo a passo completo (validação, integração BACnet/Modbus, atualização
          e remoção) está no arquivo <code className="text-xs">INSTALL.md</code> incluído no pacote.
        </p>
      </section>
    </div>
  );
}
