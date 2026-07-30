'use client';

import { useState } from 'react';
import { resolveTenantLogoUrl } from '@/modules/tenants/services/tenants.service';
import { useT } from '@/lib/i18n';

export interface TenantIdentityData {
  name: string;
  logoUrl?: string | null;
  accentColor?: string | null;
}

/**
 * Bloco de identidade do cliente, centralizado na topbar.
 * - Logo (quando cadastrado) bem enquadrado em um "chip" com fundo neutro.
 * - Nome do empreendimento em destaque com rótulo discreto acima.
 * - Acento sutil da cor do cliente: linha fina em degradê sob o nome e um
 *   filete no contorno do chip do logo. A cor NUNCA fica atrás de texto —
 *   contraste garantido em ambos os temas.
 * - Sem logo: apenas o nome, tipografia hierarquizada (nunca iniciais).
 */
export function TenantIdentity({ tenant, showLabel = true }: { tenant: TenantIdentityData; showLabel?: boolean }) {
  const t = useT();
  const [logoFailed, setLogoFailed] = useState(false);

  const logoSrc = resolveTenantLogoUrl(tenant.logoUrl);
  const showLogo = !!logoSrc && !logoFailed;
  const accent = tenant.accentColor ?? null;

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 md:gap-2.5 max-w-[34vw] md:max-w-[38vw] lg:max-w-[420px]"
      aria-label={t('Cliente')}
    >
      {showLogo && (
        <div
          className="relative flex h-7 w-7 md:h-9 md:w-9 lg:h-10 lg:w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg md:rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80 dark:bg-white/95 dark:ring-white/10"
          style={accent ? { boxShadow: `0 0 0 1px ${accent}33, 0 1px 2px 0 rgb(0 0 0 / 0.05)` } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt={tenant.name}
            className="h-full w-full object-contain p-1"
            onError={() => setLogoFailed(true)}
          />
        </div>
      )}

      <div className="min-w-0 flex flex-col items-start">
        {showLabel && (
          <span className="hidden md:flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] leading-none text-muted-foreground/80">
            {accent && (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: accent, boxShadow: `0 0 6px ${accent}99` }}
              />
            )}
            {t('Cliente')}
          </span>
        )}
        <span className={`max-w-full truncate text-[13px] md:text-[15px] font-semibold leading-tight tracking-tight text-foreground ${showLabel ? 'md:mt-0.5' : ''}`}>
          {tenant.name}
        </span>
        <span
          className="mt-0.5 md:mt-1 h-px w-full rounded-full"
          style={{
            background: accent
              ? `linear-gradient(90deg, ${accent} 0%, ${accent}66 60%, transparent 100%)`
              : 'linear-gradient(90deg, var(--border) 0%, transparent 100%)',
          }}
        />
      </div>
    </div>
  );
}
