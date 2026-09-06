// ─── Som de notificação do sino ───────────────────────────────────────────────
// Beep curto de dois tons via WebAudio — sem asset externo. Só toca após o
// primeiro gesto do usuário (restrição de autoplay dos navegadores).

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new AudioContext();
    return ctx;
  } catch {
    return null;
  }
}

export function playNotificationSound(): void {
  const audio = getContext();
  if (!audio) return;
  // Autoplay bloqueado até o primeiro gesto: tenta retomar, senão ignora.
  if (audio.state === 'suspended') {
    void audio.resume().catch(() => undefined);
    if (audio.state === 'suspended') return;
  }

  const now = audio.currentTime;
  const gain = audio.createGain();
  gain.connect(audio.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

  const osc = audio.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(660, now + 0.18);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.5);
}
