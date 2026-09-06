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
 * Malha de "prédio vivo": nós de telemetria conectados, alguns pulsando.
 * Puramente decorativa (aria-hidden) — remete ao monitoramento em tempo real.
 */
function LivingGrid() {
  const nodes = [
    { x: 14, y: 18, live: true },
    { x: 34, y: 10, live: false },
    { x: 58, y: 16, live: true },
    { x: 80, y: 8, live: false },
    { x: 22, y: 38, live: false },
    { x: 46, y: 32, live: true },
    { x: 72, y: 36, live: false },
    { x: 90, y: 28, live: true },
    { x: 12, y: 60, live: true },
    { x: 38, y: 56, live: false },
    { x: 62, y: 62, live: false },
    { x: 86, y: 56, live: true },
    { x: 26, y: 82, live: false },
    { x: 52, y: 78, live: true },
    { x: 76, y: 84, live: false },
  ];
  const links: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 2], [5, 6], [6, 7], [3, 7],
    [4, 8], [8, 9], [9, 10], [10, 11], [7, 11], [9, 12], [12, 13], [13, 14], [10, 14], [5, 9],
  ];
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full opacity-70"
      aria-hidden
    >
      {links.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          stroke="rgb(34 211 238)"
          strokeOpacity="0.14"
          strokeWidth="0.25"
        />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          {n.live && (
            <circle cx={n.x} cy={n.y} r="1.6" fill="rgb(34 211 238)" fillOpacity="0.25">
              <animate
                attributeName="r"
                values="1.2;2.6;1.2"
                dur="3.2s"
                begin={`${i * 0.4}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="fill-opacity"
                values="0.3;0;0.3"
                dur="3.2s"
                begin={`${i * 0.4}s`}
                repeatCount="indefinite"
              />
            </circle>
          )}
          <circle
            cx={n.x}
            cy={n.y}
            r="0.55"
            fill={n.live ? 'rgb(103 232 249)' : 'rgb(148 163 184)'}
            fillOpacity={n.live ? 0.95 : 0.5}
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * Painel esquerdo da tela de login — "sala de controle": fundo escuro com a
 * malha de telemetria viva, marca, proposta de valor e diferenciais.
 * Oculto em telas pequenas (o formulário ocupa a largura inteira).
 */
export function LoginBrandPanel() {
  const t = useT();
  return (
    <aside className="relative hidden overflow-hidden bg-slate-950 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
      {/* Fundo: brilhos radiais + malha viva */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(8,145,178,0.22),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(14,116,144,0.18),transparent_50%)]" />
      <LivingGrid />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 top-1/4 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl"
      />

      {/* Topo: marca + proposta de valor */}
      <div className="relative space-y-10">
        <BrandMark size="lg" dark />

        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-cyan-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
            </span>
            {t('Plataforma de gestão predial inteligente')}
          </div>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-white">
            {t('Seu prédio,')}
            <br />
            {t('vivo em tempo real.')}
            <br />
            <span className="bg-gradient-to-r from-cyan-300 to-cyan-500 bg-clip-text text-transparent">
              {t('Inteligência que transforma.')}
            </span>
          </h2>
        </div>

        <div className="space-y-4 pt-1">
          {FEATURES.map((f) => (
            <FeatureHighlight key={f.title} icon={f.icon} title={t(f.title)} description={t(f.description)} />
          ))}
        </div>
      </div>

      {/* Rodapé: selo de confiança */}
      <div className="relative mt-10 flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.04] px-5 py-4 backdrop-blur-sm">
        <ShieldCheck className="h-5 w-5 shrink-0 text-cyan-300" />
        <p className="text-sm text-slate-400">
          {t('Segurança e performance para impulsionar seu negócio com tecnologia de ponta.')}
        </p>
      </div>
    </aside>
  );
}
