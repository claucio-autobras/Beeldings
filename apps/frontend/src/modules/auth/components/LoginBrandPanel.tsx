'use client';

import { BrainCircuit, Cog, ShieldCheck, Wifi } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { FeatureHighlight } from './FeatureHighlight';
import { useT } from '@/lib/i18n';

const FEATURES = [
  {
    icon: BrainCircuit,
    title: 'IA',
    description: 'Inteligência artificial que aprende, analisa e gera valor.',
  },
  {
    icon: Wifi,
    title: 'IoT',
    description: 'Dispositivos conectados em tempo real, em qualquer lugar.',
  },
  {
    icon: Cog,
    title: 'Automação',
    description: 'Processos inteligentes e automáticos para mais eficiência.',
  },
] as const;

/**
 * Painel esquerdo da tela de login — marca, proposta de valor e diferenciais.
 * Oculto em telas pequenas (o formulário ocupa a largura inteira).
 */
export function LoginBrandPanel() {
  const t = useT();
  return (
    <aside className="relative hidden overflow-hidden border-r border-slate-200 bg-gradient-to-br from-cyan-50 via-white to-slate-50 lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14">
      {/* Brilho decorativo de fundo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-cyan-200/40 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 bottom-0 h-72 w-72 rounded-full bg-cyan-100/50 blur-3xl"
      />

      {/* Topo: marca + proposta de valor */}
      <div className="relative space-y-8">
        <BrandMark size="lg" />

        <div className="space-y-2">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-slate-900">
            {t('Conectando dispositivos.')}
            <br />
            {t('Automatizando processos.')}
            <br />
            <span className="text-cyan-700">{t('Inteligência')}</span> {t('que transforma.')}
          </h2>
        </div>

        <div className="space-y-5 pt-2">
          {FEATURES.map((f) => (
            <FeatureHighlight key={f.title} icon={f.icon} title={t(f.title)} description={t(f.description)} />
          ))}
        </div>
      </div>

      {/* Rodapé: selo de confiança */}
      <div className="relative mt-10 flex items-center gap-3 rounded-xl border border-slate-200 bg-card/70 px-4 py-3.5 backdrop-blur-sm">
        <ShieldCheck className="h-5 w-5 shrink-0 text-cyan-700" />
        <p className="text-sm text-slate-600">
          {t('Segurança e performance para impulsionar seu negócio com tecnologia de ponta.')}
        </p>
      </div>
    </aside>
  );
}
