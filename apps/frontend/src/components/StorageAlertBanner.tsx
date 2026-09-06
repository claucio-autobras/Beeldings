'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Database } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface StorageStatus {
  usedBytes: number;
  quotaBytes: number;
  percent: number;
  environment: 'production' | 'homologacao';
  ingestionBlocked: boolean;
  blockPercent: number;
}

const ADMIN_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);
const WARN_PERCENT = 80;
const POLL_INTERVAL_MS = 60_000;

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/**
 * Banner global de alerta de armazenamento. Visível só para papéis
 * administrativos (o endpoint /health/storage é restrito a eles). Mostra:
 *  - aviso âmbar ao cruzar WARN_PERCENT da quota;
 *  - alerta vermelho quando a gravação de telemetria está PAUSADA (trava).
 */
export function StorageAlertBanner() {
  const user = useCurrentUser();
  const isAdmin = ADMIN_ROLES.has(user.role);

  const { data } = useQuery<StorageStatus>({
    queryKey: ['storage-status-banner'],
    queryFn: () => apiGet('/health/storage'),
    enabled: isAdmin,
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  });

  if (!isAdmin || !data) return null;

  const critical = data.ingestionBlocked;
  const warn = data.percent >= WARN_PERCENT;
  if (!critical && !warn) return null;

  const cls = critical
    ? 'border-red-300 bg-red-50 text-red-800'
    : 'border-amber-300 bg-amber-50 text-amber-800';

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 border-b px-4 py-2 text-sm ${cls}`}
    >
      {critical ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Database className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="flex-1">
        {critical ? (
          <span>
            <strong>Gravação de histórico PAUSADA</strong> — o banco atingiu{' '}
            {data.percent.toFixed(1)}% da quota ({formatGb(data.usedBytes)} de{' '}
            {formatGb(data.quotaBytes)}). A telemetria não está sendo armazenada
            para proteger o sistema; reduza a retenção ou expurgue dados. A
            gravação retoma automaticamente ao liberar espaço.
          </span>
        ) : (
          <span>
            <strong>Armazenamento em {data.percent.toFixed(1)}% da quota</strong>{' '}
            ({formatGb(data.usedBytes)} de {formatGb(data.quotaBytes)}). A
            gravação será pausada automaticamente ao chegar a{' '}
            {data.blockPercent.toFixed(0)}%. Considere reduzir a retenção dos
            trends.
          </span>
        )}
      </div>
    </div>
  );
}
