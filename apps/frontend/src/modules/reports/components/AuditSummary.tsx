'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { getAuditPreview, type AuditPreviewData, type AuditPreviewEntry } from '../services/reports.service';

interface AuditSummaryProps {
  /** Cliente em foco (admin pode escolher; demais ficam no próprio tenant). */
  tenantId?: string;
  from?: Date;
  to?: Date;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Mesmo fuso fixo dos relatórios (PDF/CSV), para prévia e arquivo baterem.
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d);
}

/**
 * Cor da coluna "Ação": ações destrutivas (exclusão) e logins com falha em
 * vermelho; comando a equipamento em laranja; demais em cor neutra.
 */
function actionClass(r: AuditPreviewEntry): string {
  if (r.actionCode === 'DELETE') return 'text-red-600';
  if (r.actionCode === 'LOGIN' && r.result === 'FAILURE') return 'text-red-600';
  if (r.actionCode === 'COMMAND') return 'text-amber-600';
  return 'text-foreground';
}

function ResultBadge({ result }: { result: string }) {
  if (result === 'SUCCESS') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Sucesso
      </span>
    );
  }
  if (result === 'FAILURE') {
    return (
      <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        Falha
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

/**
 * Prévia do relatório de auditoria: uma tabela completa de eventos com as
 * colunas Data/hora, Usuário, Cliente, Ação, Entidade / alteração, Origem e
 * Resultado. Reflete as ações de TODOS os usuários no escopo (cliente/período)
 * e respeita o recorte de tenant aplicado pelo backend.
 */
export function AuditSummary({ tenantId, from, to }: AuditSummaryProps) {
  const { data, isLoading } = useQuery<AuditPreviewData>({
    queryKey: [
      'reports-audit-preview',
      tenantId ?? '',
      from?.toISOString() ?? '',
      to?.toISOString() ?? '',
    ],
    queryFn: () => getAuditPreview({ tenantId, from, to }),
  });

  if (isLoading) {
    return (
      <div className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando prévia…
      </div>
    );
  }

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];

  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-medium text-foreground">
        Prévia{' '}
        <span className="text-muted-foreground">
          ({total} registro(s) no período{total > rows.length ? `, mostrando os ${rows.length} mais recentes` : ''})
        </span>
      </p>
      {total > rows.length && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          A prévia exibe apenas os {rows.length} registros mais recentes de {total}. Registros mais antigos
          continuam no sistema: refine o período (data inicial/final) para vê-los aqui, ou exporte o CSV do
          período para o conjunto completo.
        </p>
      )}
      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-8 text-center text-xs text-muted-foreground">
          Nenhuma ação registrada no período/cliente selecionado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="sticky top-0 bg-muted/40 backdrop-blur">
                <tr className="border-b border-border text-muted-foreground">
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Data/hora</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Usuário</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Cliente</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Ação</th>
                  <th className="px-3 py-2 font-medium">Entidade / alteração</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Origem</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDateTime(r.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{r.user}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{r.client || '—'}</td>
                    <td className={`whitespace-nowrap px-3 py-2 font-medium ${actionClass(r)}`}>{r.action}</td>
                    <td className="px-3 py-2 text-foreground">
                      {r.entity || '—'}
                      {r.change && (
                        <span className="mt-0.5 block text-muted-foreground">{r.change}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-tabular text-muted-foreground">{r.origin || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <ResultBadge result={r.result} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
