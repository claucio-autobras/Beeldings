'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Copy, Cpu, Download, Edit2, Eye, FileText, Loader2, Monitor, RefreshCw, Router, Wifi, WifiOff,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';
import { getGatewayConfigText, getMqttIntegrationGuidePdf } from '@/modules/projects/services/projects.service';
import { useT } from '@/lib/i18n';
import { getScreens } from '@/modules/scada/services/scada.service';
import type { ScadaScreen } from '@/modules/scada/types/scada.types';

interface GatewayInfo {
  id: string;
  status: string;
  mqttUser?: string;
  mqttPass?: string;
  lastSeen?: string | null;
}
interface ProjectDetail {
  id: string;
  name: string;
  siteId: string;
  tenantId: string;
  createdAt: string;
  gateway?: GatewayInfo | null;
  site?: { id: string; name: string } | null;
}
interface DeviceItem {
  id: string;
  name: string;
  protocol: string;
  status: string;
  gatewayId?: string | null;
  siteId?: string | null;
  points?: unknown[];
}

function formatRelative(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

export default function ProjectDetailClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);

  const { data: project, isLoading, error } = useQuery<ProjectDetail>({
    queryKey: ['project', projectId],
    queryFn: () => apiGet(`/projects/${projectId}`),
    refetchInterval: 30_000,
  });

  const gw = project?.gateway ?? null;

  // Endereço vem do Site (localidade física), não do projeto.
  const { data: siteDetail } = useQuery<{ id: string; name: string; location?: string | null }>({
    queryKey: ['site', project?.siteId ?? null],
    queryFn: () => apiGet(`/sites/${project?.siteId}`),
    enabled: !!project?.siteId,
  });

  const { data: devices = [] } = useQuery<DeviceItem[]>({
    queryKey: ['devices', project?.tenantId ?? null],
    queryFn: () => apiGet(`/devices${project?.tenantId ? `?tenantId=${project.tenantId}` : ''}`),
    enabled: !!project?.tenantId,
  });

  // Controladoras do projeto: ligadas a este gateway E a este site. O filtro por
  // site é essencial quando o gateway é compartilhado entre sites diferentes
  // (ex.: torres com rack central) — cada site mostra só as suas controladoras.
  const projectDevices = gw && project
    ? devices.filter((d) => d.gatewayId === gw.id && d.siteId === project.siteId)
    : [];

  const { data: screens = [] } = useQuery<ScadaScreen[]>({
    queryKey: ['scada-screens', 'project', projectId],
    queryFn: () => getScreens({ projectId }),
    enabled: !!projectId,
  });

  const reprovision = useMutation({
    mutationFn: (id: string) => apiPost(`/gateways/${id}/reprovision`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  function copy(label: string, value: string) {
    void navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  async function handleDownload() {
    const text = await getGatewayConfigText(projectId);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'gateway-config.env';
    a.click();
  }

  async function handleDownloadGuide() {
    setGuideError(null);
    setGuideLoading(true);
    try {
      const blob = await getMqttIntegrationGuidePdf(projectId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `guia-integracao-mqtt-${gw?.id ?? projectId}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setGuideError(t('Não foi possível gerar o guia. Tente novamente.'));
    } finally {
      setGuideLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 rounded bg-muted/40 animate-pulse" />
        <div className="h-48 rounded-xl bg-muted/40 animate-pulse" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Erro ao carregar projeto: {error ? (error as Error).message : 'não encontrado'}
      </div>
    );
  }

  const online = gw?.status === 'online';

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push(`/admin/projects?siteId=${project.siteId}&tenantId=${project.tenantId}`)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Projetos
      </button>

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {project.site?.name ? `Site: ${project.site.name}` : ''}
          {siteDetail?.location ? ` · ${siteDetail.location}` : ''}
        </p>
      </div>

      {/* Gateway card */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between bg-muted/30 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Router className="h-4 w-4 text-cyan-700" />
            <h2 className="text-sm font-semibold text-foreground">Gateway</h2>
          </div>
          {gw && (
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${online ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
              {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {online ? 'Online' : 'Offline'}
            </span>
          )}
        </div>

        {gw ? (
          <div className="px-5 py-4 space-y-3">
            {[
              ['Gateway ID', gw.id],
              ['MQTT User', gw.mqttUser ?? '—'],
              ['MQTT Pass', gw.mqttPass ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
                <code className="text-xs font-mono text-foreground bg-muted/40 px-2 py-1 rounded flex-1 truncate">{value}</code>
                <button
                  onClick={() => copy(label, value)}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-cyan-700 hover:bg-cyan-50 transition-colors"
                  title="Copiar"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copied === label && <span className="text-[11px] text-green-600">copiado</span>}
              </div>
            ))}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-24 shrink-0">Última comunicação</span>
              <span className="text-xs text-foreground">{formatRelative(gw.lastSeen)}</span>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button onClick={() => void handleDownload()} className="flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-cyan-700 text-white hover:bg-cyan-800 transition-colors">
                <Download className="h-4 w-4" />
                Baixar gateway-config.env
              </button>
              <button
                onClick={() => void handleDownloadGuide()}
                disabled={guideLoading}
                className="flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
              >
                {guideLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {t('Baixar guia de integração (PDF)')}
              </button>
              <button
                onClick={() => reprovision.mutate(gw.id)}
                disabled={reprovision.isPending}
                className="flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
              >
                {reprovision.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Reprovisionar no broker
              </button>
            </div>
            {guideError && <p className="text-xs text-red-600">{guideError}</p>}
            {reprovision.isSuccess && <p className="text-xs text-green-600">Gateway reprovisionado no broker MQTT.</p>}
            {reprovision.error && <p className="text-xs text-red-600">{(reprovision.error as Error).message}</p>}
          </div>
        ) : (
          <div className="px-5 py-6 text-sm text-muted-foreground">Este projeto não possui gateway.</div>
        )}
      </div>

      {/* Devices */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between bg-muted/30 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-foreground">
              Controladoras ({projectDevices.length})
            </h2>
          </div>
          <button onClick={() => router.push('/devices')} className="text-xs font-medium text-cyan-700 hover:underline">
            Gerenciar dispositivos →
          </button>
        </div>
        {projectDevices.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            Nenhuma controladora cadastrada neste gateway ainda. Cadastre em{' '}
            <button onClick={() => router.push('/devices')} className="font-medium text-cyan-700 hover:underline">Dispositivos</button>.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Controladora</th>
                <th className="text-left px-5 py-2.5 text-xs font-medium text-muted-foreground">Protocolo</th>
                <th className="text-center px-5 py-2.5 text-xs font-medium text-muted-foreground">Pontos</th>
                <th className="text-center px-5 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projectDevices.map((d) => (
                <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-2.5 font-medium text-foreground">{d.name}</td>
                  <td className="px-5 py-2.5 text-muted-foreground uppercase text-xs">{d.protocol}</td>
                  <td className="px-5 py-2.5 text-center text-muted-foreground">{d.points?.length ?? 0}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${d.status === 'online' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${d.status === 'online' ? 'bg-green-500' : 'bg-slate-400'}`} />
                      {d.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Telas SCADA */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between bg-muted/30 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-foreground">
              Telas SCADA ({screens.length})
            </h2>
          </div>
          <button onClick={() => router.push('/scada')} className="text-xs font-medium text-cyan-700 hover:underline">
            Gerenciar telas →
          </button>
        </div>
        {screens.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            Nenhuma tela sinótica criada para este projeto ainda. Crie em{' '}
            <button onClick={() => router.push('/scada')} className="font-medium text-cyan-700 hover:underline">Telas</button>.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {screens.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.width}×{s.height} · {s.widgets.length} {s.widgets.length === 1 ? 'componente' : 'componentes'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link href={`/scada-view/${s.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.5} /> Visualizar
                  </Link>
                  <Link href={`/scada/editor/${s.id}`} className="inline-flex items-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-800 transition-colors">
                    <Edit2 className="h-3.5 w-3.5" strokeWidth={1.5} /> Editar
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
