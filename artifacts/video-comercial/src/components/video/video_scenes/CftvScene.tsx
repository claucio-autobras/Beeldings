import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SceneBackdrop } from '../SceneBackdrop';

const cftvImg = `${import.meta.env.BASE_URL}current-ui/cftv.png`;

export function CftvScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Total 11.2s
    const timers = [
      setTimeout(() => setPhase(1), 300),   // "E a inteligência não para por aí..."
      setTimeout(() => setPhase(2), 2000),  // "O CFTV também..."
      setTimeout(() => setPhase(3), 5000),  // "com monitoramento de câmeras..."
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 z-10 flex items-center"
      initial={{ opacity: 0, x: "10vw", filter: "blur(10px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(20px)" }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <SceneBackdrop image="beeldings-cftv-background.jpg" accent="blue" position="center 35%" />
      <div className="absolute top-[28vh] left-[5vw] z-30 w-[31vw] rounded-3xl border border-white/10 bg-[#020617]/85 px-[2.4vw] py-[3vh] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-md">
        <div className="overflow-hidden mb-6">
          <motion.h2 
            className="text-[4.2vw] font-display font-black leading-[1.08] tracking-tight text-white drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)]"
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? "0%" : "100%" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          >
            CFTV Integrado
          </motion.h2>
        </div>
        
        <motion.div
          className="relative border-l-[3px] border-accent pl-6 py-2"
          initial={{ opacity: 0, scaleY: 0, transformOrigin: "top" }}
          animate={{ opacity: phase >= 2 ? 1 : 0, scaleY: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.p
            className="text-[1.45vw] text-white/90 font-medium leading-[1.55] min-h-[10vh] drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: phase >= 2 ? 1 : 0, x: phase >= 2 ? 0 : -20 }}
            transition={{ duration: 1, delay: 0.2 }}
          >
            {phase < 3 ? "O CFTV faz parte da plataforma em um único ecossistema." : "Monitoramento de câmeras, detecção de eventos e alarmes instantâneos."}
          </motion.p>
        </motion.div>
      </div>

      <motion.div 
        className="absolute right-[3vw] top-[15vh] w-[56vw] h-[70vh] rounded-2xl overflow-hidden shadow-[0_0_120px_rgba(255,255,255,0.1)] border border-white/20"
        initial={{ opacity: 0, scale: 0.85, rotateY: 20 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, scale: phase >= 1 ? 1 : 0.85, rotateY: phase >= 1 ? 0 : 20 }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        style={{ perspective: 1200 }}
      >
        <img src={cftvImg} className="w-full h-full object-cover object-center scale-105" alt="CFTV" />
        
        {/* Simulating camera recording blink */}
        <motion.div 
          className="absolute top-6 right-6 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.5 }}
        >
          <motion.div 
            className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
          <span className="text-white font-mono text-sm tracking-widest">REC</span>
        </motion.div>
        
        {/* Subtle scanline overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100%_4px] mix-blend-overlay pointer-events-none" />
      </motion.div>
    </motion.div>
  );
}
