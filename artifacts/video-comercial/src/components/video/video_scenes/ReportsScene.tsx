import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SceneBackdrop } from '../SceneBackdrop';

const reportsImg = `${import.meta.env.BASE_URL}current-ui/reports.png`;

export function ReportsScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Total 6.9s
    const timers = [
      setTimeout(() => setPhase(1), 300),   // "Gere relatórios..."
      setTimeout(() => setPhase(2), 2000),  // "acompanhe indicadores..."
      setTimeout(() => setPhase(3), 4000),  // "...transforme o histórico..."
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
      <SceneBackdrop image="beeldings-reports-background.jpg" accent="blue" position="center 45%" />
      <motion.div 
        className="w-[72vw] h-[57vh] rounded-2xl overflow-hidden shadow-[0_40px_100px_rgba(255,255,255,0.05)] border border-white/20 relative z-20 mt-[2vh]"
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
        className="mt-[3vh] text-center max-w-[66vw] z-30 rounded-3xl border border-white/10 bg-[#020617]/84 px-[3vw] py-[2vh] shadow-[0_20px_70px_rgba(0,0,0,0.5)] backdrop-blur-md"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 40 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[4vw] font-display font-black tracking-tight drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)]">
          Relatórios Gerenciais
        </h2>
        <motion.p 
          className="text-[1.45vw] text-white/90 mt-2 font-medium min-h-[4vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
        >
          {phase < 3 ? "Gere relatórios profissionais e acompanhe indicadores." : "Transforme o histórico em informação útil."}
        </motion.p>
      </motion.div>
    </motion.div>
  );
}
