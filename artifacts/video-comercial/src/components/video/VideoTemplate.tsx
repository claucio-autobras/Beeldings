import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { IntroScene } from './video_scenes/IntroScene';
import { DashboardScene } from './video_scenes/DashboardScene';
import { AlarmsScene } from './video_scenes/AlarmsScene';
import { DevicesScene } from './video_scenes/DevicesScene';
import { CftvScene } from './video_scenes/CftvScene';
import { ScadaScene } from './video_scenes/ScadaScene';
import { TrendsScene } from './video_scenes/TrendsScene';
import { ReportsScene } from './video_scenes/ReportsScene';
import { AutomationScene } from './video_scenes/AutomationScene';
import { AiScene } from './video_scenes/AiScene';
import { OutroScene } from './video_scenes/OutroScene';

export const SCENE_DURATIONS = {
  intro: 7000,
  dashboard: 13000,
  alarms: 10500,
  devices: 13500,
  cftv: 11000,
  scada: 10500,
  trends: 10000,
  reports: 9500,
  automations: 9500,
  ai: 10000,
  outro: 9000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  intro: IntroScene,
  dashboard: DashboardScene,
  alarms: AlarmsScene,
  devices: DevicesScene,
  cftv: CftvScene,
  scada: ScadaScene,
  trends: TrendsScene,
  reports: ReportsScene,
  automations: AutomationScene,
  ai: AiScene,
  outro: OutroScene,
};

const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
    out[key] = cumulativeMs / 1000;
    cumulativeMs += ms;
  }
  return out;
})();

const AUDIO_SEEK_EPSILON_SEC = 0.18;

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey, currentScene } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 1.0;
    const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
    if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
      audio.currentTime = targetTime;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted]);

  return (
    <div className="w-full h-screen overflow-hidden relative bg-[#02040a] text-text-primary perspective-1000">
      {/* Cinematic Background Layer - Persistent */}
      <div className="absolute inset-0 z-0">
        {/* Deep ambient glow */}
        <motion.div 
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120vw] h-[120vh] rounded-full blur-[150px] opacity-30"
          animate={{
            background: [
              'radial-gradient(circle, rgba(14,116,144,0.4) 0%, transparent 70%)',
              'radial-gradient(circle, rgba(6,182,212,0.3) 0%, transparent 70%)',
              'radial-gradient(circle, rgba(14,116,144,0.4) 0%, transparent 70%)'
            ],
            scale: [1, 1.1, 0.9, 1],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        
        {/* Dynamic Light Leaks shifting based on scene */}
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[120px] opacity-20 bg-primary mix-blend-screen"
          animate={{
            x: ['-10vw', '50vw', '80vw', '20vw', '-10vw'][currentScene % 5],
            y: ['10vh', '-20vh', '40vh', '80vh', '10vh'][currentScene % 5],
            scale: [1, 1.5, 0.8, 1.2, 1][currentScene % 5],
          }}
          transition={{ duration: 8, ease: [0.25, 1, 0.5, 1] }}
        />

        <motion.div
          className="absolute right-0 bottom-0 w-[70vw] h-[70vw] rounded-full blur-[150px] opacity-15 bg-accent mix-blend-screen"
          animate={{
            x: ['10vw', '-40vw', '-80vw', '0vw', '10vw'][currentScene % 5],
            y: ['20vh', '60vh', '-10vh', '-30vh', '20vh'][currentScene % 5],
          }}
          transition={{ duration: 10, ease: [0.25, 1, 0.5, 1] }}
        />

        {/* Cinematic noise texture overlay */}
        <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}></div>
      </div>

      {/* Main scenes wrapper */}
      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>

      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/composite_audio.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />
    </div>
  );
}
