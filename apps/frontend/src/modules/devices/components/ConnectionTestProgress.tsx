'use client';

import { useEffect } from 'react';
import { Loader2, Radar } from 'lucide-react';

interface ConnectionTestProgressProps {
  protocol: 'bacnet' | 'modbus';
  /** Chamado após um pequeno beat de UX; a transição real depende da resposta da API. */
  onComplete: () => void;
  /** Número real de pontos retornado pela API; undefined = API ainda pendente. */
  pointsReady?: number;
  /** Endereço alvo, exibido para dar contexto do que está sendo procurado. */
  target?: string;
  /** Título exibido — padrão: "Procurando a controladora…" */
  title?: string;
  /** Descrição exibida abaixo do título — padrão: mensagem de descoberta de pontos */
  description?: string;
}

const ACCENT: Record<'bacnet' | 'modbus', { text: string; bar: string; border: string; bg: string }> = {
  bacnet: { text: 'text-cyan-600',   bar: 'bg-cyan-600',   border: 'border-cyan-200',   bg: 'bg-cyan-50'   },
  modbus: { text: 'text-violet-600', bar: 'bg-violet-600', border: 'border-violet-200', bg: 'bg-violet-50' },
};

/**
 * Indicador HONESTO de busca: enquanto a API procura a controladora, mostra um
 * estado "procurando" indeterminado — sem fingir que etapas já foram concluídas.
 * O sucesso/erro é decidido pela resposta real da API (no modal).
 */
export default function ConnectionTestProgress({
  protocol,
  onComplete,
  target,
  title = 'Procurando a controladora…',
  description,
}: ConnectionTestProgressProps) {
  const accent = ACCENT[protocol];

  // Pequeno beat de UX antes de liberar a transição; a espera real é a da API.
  useEffect(() => {
    const t = setTimeout(onComplete, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`rounded-xl border ${accent.border} ${accent.bg} p-6 flex flex-col items-center gap-4 text-center`}>
      <div className={`relative flex h-14 w-14 items-center justify-center rounded-full bg-card ${accent.text}`}>
        <Radar className="h-7 w-7" />
        <Loader2 className={`absolute h-14 w-14 ${accent.text} animate-spin opacity-30`} />
      </div>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">
          {description ?? (
            <>
              Tentando conectar{target ? <> a <span className="font-mono">{target}</span></> : null} e descobrir os
              pontos. Isso pode levar alguns segundos.
            </>
          )}
        </p>
      </div>

      {/* Barra indeterminada — não implica conclusão de etapas */}
      <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full w-1/3 rounded-full ${accent.bar} animate-indeterminate`} />
      </div>
    </div>
  );
}
