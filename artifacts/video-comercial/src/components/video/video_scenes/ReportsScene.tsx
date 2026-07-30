import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import reportsImg from "@assets/screenshots/bluebee_reports.png";

export function ReportsScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1600),
      setTimeout(() => setPhase(3), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 z-10 flex flex-col items-center justify-center"
      initial={{ opacity: 0, y: "10vh", filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(20px)" }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div 
        className="w-[70vw] h-[60vh] rounded-2xl overflow-hidden shadow-[0_40px_100px_rgba(255,255,255,0.05)] border border-white/20 relative z-20 mt-[5vh]"
        initial={{ opacity: 0, scale: 0.85, rotateX: -20 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          scale: phase >= 3 ? 1.05 : (phase >= 1 ? 1 : 0.85),
          rotateX: phase >= 1 ? 0 : -20 
        }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: 1500 }}
      >
        <img src={reportsImg} className="w-full h-full object-cover object-top" alt="Reports" />
        <div className="absolute inset-0 shadow-[inset_0_0_100px_rgba(0,0,0,0.5)] pointer-events-none mix-blend-overlay" />
      </motion.div>

      <motion.div 
        className="mt-[6vh] text-center max-w-[60vw] z-30"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 40 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[4.5vw] font-display font-black tracking-tight drop-shadow-2xl">
          Relatórios Gerenciais
        </h2>
        <p className="text-[1.6vw] text-white/70 mt-4 font-light">
          Gere evidências em PDF com um clique. Auditoria completa de eventos e conformidade SLA.
        </p>
      </motion.div>
    </motion.div>
  );
}
