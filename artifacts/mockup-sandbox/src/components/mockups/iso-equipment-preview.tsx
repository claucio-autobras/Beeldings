// Prévia antes/depois — redesign isométrico dos equipamentos SCADA.
// "DEPOIS" agora usa renders 3D isométricos (imagens) com tratamento de estado
// por brilho colorido + LED de status.
import React from 'react';

const ISO_IMG: Record<string, string> = {
  chiller: `${import.meta.env.BASE_URL}iso/iso_chiller.png`,
  ahu: `${import.meta.env.BASE_URL}iso/iso_ahu.png`,
  pump: `${import.meta.env.BASE_URL}iso/iso_pump.png`,
};

/** Como o equipamento aparecerá no SCADA: render 3D + glow/LED na cor de estado. */
function IsoRender({ type, color, size, base }: { type: string; color: string; size: number; base?: boolean }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-block' }}>
      <img
        src={ISO_IMG[type]}
        alt={type}
        draggable={false}
        style={{
          width: '100%', height: '100%', objectFit: 'contain', display: 'block',
          filter: base
            ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))'
            : `drop-shadow(0 0 7px ${color}) drop-shadow(0 2px 4px rgba(0,0,0,0.3))`,
        }}
      />
      <span style={{
        position: 'absolute', right: 2, top: 2, width: size * 0.14, height: size * 0.14,
        borderRadius: '50%', background: color,
        boxShadow: base ? 'none' : `0 0 6px 1px ${color}`,
        border: '1.5px solid rgba(255,255,255,0.75)',
      }} />
    </div>
  );
}

// ── Cópia dos ícones ATUAIS (estilo semi-3D metálico) só para comparação ──────

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return [100, 116, 139];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct);
  const mix = (c: number) => Math.round((t - c) * p + c);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
function Defs({ uid, c }: { uid: string; c: string }) {
  return (
    <defs>
      <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={shade(c, 0.6)} /><stop offset="0.12" stopColor={shade(c, 0.35)} /><stop offset="0.5" stopColor={c} /><stop offset="1" stopColor={shade(c, -0.45)} />
      </linearGradient>
      <linearGradient id={`m${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={shade(c, -0.4)} /><stop offset="0.12" stopColor={shade(c, 0.6)} /><stop offset="0.4" stopColor={c} /><stop offset="0.7" stopColor={shade(c, -0.28)} /><stop offset="0.86" stopColor={shade(c, 0.1)} /><stop offset="1" stopColor={shade(c, -0.5)} />
      </linearGradient>
      <linearGradient id={`mv${uid}`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={shade(c, -0.4)} /><stop offset="0.12" stopColor={shade(c, 0.6)} /><stop offset="0.4" stopColor={c} /><stop offset="0.7" stopColor={shade(c, -0.28)} /><stop offset="0.86" stopColor={shade(c, 0.1)} /><stop offset="1" stopColor={shade(c, -0.5)} />
      </linearGradient>
      <linearGradient id={`top${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={shade(c, 0.65)} /><stop offset="1" stopColor={shade(c, 0.2)} />
      </linearGradient>
      <radialGradient id={`g${uid}`} cx="0.35" cy="0.28" r="0.6">
        <stop offset="0" stopColor="rgba(255,255,255,0.4)" /><stop offset="1" stopColor="rgba(255,255,255,0)" />
      </radialGradient>
    </defs>
  );
}
function boltRing(cx: number, cy: number, r: number, color: string) {
  return [0, 90, 180, 270].map((a) => {
    const rad = (a * Math.PI) / 180;
    return <circle key={a} cx={cx + r * Math.cos(rad)} cy={cy + r * Math.sin(rad)} r="1.3" fill={color} stroke="none" />;
  });
}
function castShadow(cx = 50, cy = 94, rx = 42) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry="4.5" fill="rgba(0,0,0,0.3)" />;
}

const OLD_ICONS: Record<string, (c: string, s: number, uid: string) => React.ReactNode> = {
  pump: (c, s, uid) => {
    const ed = shade(c, -0.6); const ac = shade(c, 0.5); const sk = shade(c, -0.3); const dk = shade(c, -0.45);
    return (
      <svg width={s} height={s} viewBox="0 0 100 100">
        <Defs uid={uid} c={c} />
        {castShadow(50, 95, 45)}
        <g stroke={ed} strokeWidth="1.2" strokeLinejoin="round">
          <rect x="6" y="85" width="88" height="9" rx="2" fill={`url(#m${uid})`} />
          <rect x="6" y="85" width="88" height="2.4" fill={ac} stroke="none" />
          <rect x="15" y="94" width="10" height="5" fill={dk} /><rect x="75" y="94" width="10" height="5" fill={dk} />
          <rect x="25" y="14" width="13" height="22" fill={`url(#mv${uid})`} />
          <rect x="19" y="8" width="25" height="8" rx="2" fill={`url(#top${uid})`} />
          {boltRing(31.5, 12, 8.5, dk)}
          <rect x="2" y="47" width="15" height="16" rx="2" fill={`url(#mv${uid})`} />
          <rect x="0" y="43" width="7" height="24" rx="2" fill={`url(#top${uid})`} />
          {boltRing(3.5, 55, 8.5, dk)}
          <rect x="55" y="46" width="9" height="20" rx="2" fill={`url(#mv${uid})`} />
          <rect x="60" y="40" width="34" height="32" rx="16" fill={`url(#m${uid})`} />
          <g stroke={dk} strokeWidth="1.2" opacity="0.5">{[66, 72, 78, 84].map((x) => <line key={x} x1={x} y1="43" x2={x} y2="69" />)}</g>
          <circle cx="91" cy="56" r="8" fill={`url(#mv${uid})`} stroke={dk} strokeWidth="1" />
          <circle cx="91" cy="56" r="3" fill={dk} stroke="none" />
          <rect x="66" y="31" width="17" height="10" rx="1.5" fill={`url(#top${uid})`} />
          <circle cx="32" cy="55" r="27" fill={`url(#b${uid})`} />
          <path d="M32 28 A27 27 0 0 1 59 51 L47 55 A15 15 0 0 0 32 40 Z" fill={sk} stroke="none" opacity="0.7" />
          <circle cx="32" cy="55" r="15" fill="none" stroke={dk} strokeWidth="1" opacity="0.5" />
          <circle cx="32" cy="55" r="27" fill={`url(#g${uid})`} stroke="none" />
          <g stroke={ac} strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.95">
            <path d="M32 55 Q42 48 40 38" /><path d="M32 55 Q40 65 50 63" /><path d="M32 55 Q22 62 24 72" /><path d="M32 55 Q24 45 14 47" />
          </g>
          <circle cx="32" cy="55" r="4.5" fill={dk} stroke="none" />
        </g>
      </svg>
    );
  },
  ahu: (c, s, uid) => {
    const ed = shade(c, -0.6); const ac = shade(c, 0.5); const sk = shade(c, -0.38); const dk = shade(c, -0.45);
    return (
      <svg width={s} height={s} viewBox="0 0 100 100">
        <Defs uid={uid} c={c} />
        {castShadow(50, 88, 44)}
        <g stroke={ed} strokeWidth="1.2" strokeLinejoin="round">
          <rect x="16" y="6" width="15" height="12" fill={`url(#mv${uid})`} />
          <rect x="69" y="6" width="15" height="12" fill={`url(#mv${uid})`} />
          <rect x="6" y="16" width="88" height="66" rx="4" fill={`url(#b${uid})`} />
          <rect x="6" y="16" width="88" height="6" rx="4" fill={`url(#top${uid})`} stroke="none" />
          <rect x="14" y="82" width="8" height="6" fill={dk} /><rect x="78" y="82" width="8" height="6" fill={dk} />
          <g stroke={dk} strokeWidth="1" opacity="0.55"><line x1="36" y1="22" x2="36" y2="76" /><line x1="64" y1="22" x2="64" y2="76" /></g>
          <rect x="11" y="26" width="21" height="46" rx="2" fill={sk} stroke={dk} strokeWidth="0.6" />
          <g stroke={ac} strokeWidth="1" opacity="0.5">{[30, 40, 50, 60].map((y) => <line key={y} x1="12" y1={y} x2="31" y2={y - 8} />)}</g>
          <circle cx="50" cy="49" r="13" fill={sk} stroke={dk} strokeWidth="1" />
          <g stroke={ac} strokeWidth="1.8" fill="none" strokeLinecap="round">
            <path d="M50 49 Q57 44 55 37" /><path d="M50 49 Q57 56 63 53" /><path d="M50 49 Q43 56 45 63" /><path d="M50 49 Q43 42 37 45" />
          </g>
          <circle cx="50" cy="49" r="3" fill={dk} stroke="none" />
          <rect x="68" y="26" width="22" height="46" rx="2" fill={sk} stroke={dk} strokeWidth="0.6" />
          <g stroke={ac} strokeWidth="2" opacity="0.65"><line x1="74" y1="28" x2="74" y2="70" /><line x1="81" y1="28" x2="81" y2="70" /><line x1="88" y1="28" x2="88" y2="70" /></g>
        </g>
      </svg>
    );
  },
  chiller: (c, s, uid) => {
    const ed = shade(c, -0.6); const ac = shade(c, 0.5); const dk = shade(c, -0.45); const sk = shade(c, -0.35);
    return (
      <svg width={s} height={s} viewBox="0 0 100 100">
        <Defs uid={uid} c={c} />
        {castShadow(50, 95, 44)}
        <g stroke={ed} strokeWidth="1.2" strokeLinejoin="round">
          <rect x="6" y="86" width="88" height="8" rx="2" fill={`url(#m${uid})`} />
          <rect x="14" y="94" width="10" height="5" fill={dk} /><rect x="76" y="94" width="10" height="5" fill={dk} />
          <rect x="30" y="10" width="44" height="18" rx="9" fill={`url(#m${uid})`} />
          <circle cx="70" cy="19" r="6" fill={`url(#mv${uid})`} stroke={dk} strokeWidth="0.8" />
          <line x1="34" y1="28" x2="34" y2="34" stroke={dk} strokeWidth="2" />
          <line x1="66" y1="28" x2="66" y2="34" stroke={dk} strokeWidth="2" />
          <rect x="12" y="34" width="76" height="22" rx="11" fill={`url(#m${uid})`} />
          <ellipse cx="88" cy="45" rx="6" ry="11" fill={dk} stroke={ed} strokeWidth="0.8" />
          <ellipse cx="12" cy="45" rx="5" ry="11" fill={shade(c, 0.55)} />
          <rect x="12" y="60" width="76" height="22" rx="11" fill={`url(#m${uid})`} />
          <ellipse cx="88" cy="71" rx="6" ry="11" fill={dk} stroke={ed} strokeWidth="0.8" />
          <ellipse cx="12" cy="71" rx="5" ry="11" fill={shade(c, 0.55)} />
          <rect x="40" y="63" width="20" height="16" rx="1.5" fill={sk} stroke={dk} strokeWidth="0.6" />
          <rect x="43" y="66" width="14" height="6" rx="1" fill={ac} opacity="0.85" stroke="none" />
        </g>
      </svg>
    );
  },
};

// ── Grade comparativa ─────────────────────────────────────────────────────────

const STATES: { label: string; color: string }[] = [
  { label: 'Base (projeto)', color: '#64748B' },
  { label: 'Ligado', color: '#22C55E' },
  { label: 'Alarme', color: '#EF4444' },
  { label: 'Água gelada', color: '#38BDF8' },
];
const TYPES: { key: string; label: string }[] = [
  { key: 'chiller', label: 'Chiller' },
  { key: 'ahu', label: 'UTA / AHU' },
  { key: 'pump', label: 'Bomba' },
];

function Row({ dark }: { dark: boolean }) {
  const bg = dark ? '#0F172A' : '#F1F5F9';
  const fg = dark ? '#E2E8F0' : '#1E293B';
  const cardBg = dark ? '#1E293B' : '#FFFFFF';
  return (
    <div style={{ background: bg, color: fg, padding: '24px 32px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, opacity: 0.6, marginBottom: 16 }}>
        Tema {dark ? 'escuro' : 'claro'}
      </div>
      {TYPES.map((t) => (
        <div key={t.key} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{t.label}</div>
          <div style={{ display: 'flex', gap: 24 }}>
            {['ANTES', 'DEPOIS'].map((phase) => (
              <div key={phase} style={{ background: cardBg, borderRadius: 12, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, opacity: 0.5, marginBottom: 6 }}>{phase}</div>
                <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
                  {STATES.map((st, i) => (
                    <div key={st.label} style={{ textAlign: 'center' }}>
                      {phase === 'ANTES'
                        ? OLD_ICONS[t.key](st.color, 96, `${phase}${t.key}${st.label}${dark ? 'd' : 'l'}`.replace(/[^a-zA-Z]/g, ''))
                        : <IsoRender type={t.key} color={st.color} size={96} base={i === 0} />}
                      <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>{st.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function IsoEquipmentPreview() {
  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      <Row dark />
      <Row dark={false} />
    </div>
  );
}
