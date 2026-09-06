import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SceneBackdrop } from '../SceneBackdrop';

const autoImg = `${import.meta.env.BASE_URL}current-ui/automation.png`;

export function AutomationScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Total 16.2s
    const timers = [
      setTimeout(() => setPhase(1), 300),   // "E quando uma ação..."
      setTimeout(() => setPhase(2), 4000),  // "Crie regras..."
      setTimeout(() => setPhase(3), 9000),  // "Tudo isso..."
      setTimeout(() => setPhase(4), 12000), // "Captar."
      setTimeout(() => setPhase(5), 13000), // "Interpretar."
      setTimeout(() => setPhase(6), 14000), // "Conectar."
      setTimeout(() => setPhase(7), 15000), // "Agir."
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 z-10 flex items-center"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, x: "-10vw", filter: "blur(20px)" }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <SceneBackdrop image="beeldings-automation-background.jpg" accent="green" position="center" />
      <div className="absolute top-[22vh] right-[5vw] z-30 w-[34vw] rounded-3xl border border-white/10 bg-[#020617]/85 px-[2.4vw] py-[3vh] text-right flex flex-col items-end shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-md">
        <motion.div 
          className="w-20 h-1 bg-gradient-to-l from-success to-transparent mb-8"
          initial={{ scaleX: 0, transformOrigin: "right" }}
          animate={{ scaleX: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="overflow-hidden pb-4">
          <motion.h2 
            className="text-[4.2vw] font-display font-black leading-[1.08] tracking-tight drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)]"
            initial={{ y: "100%" }}
            animate={{ y: phase >= 1 ? "0%" : "100%" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          >
            Motor de <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-success to-green-400">Automações</span>
          </motion.h2>
        </div>
        
        <motion.p
          className="text-[1.45vw] text-white/90 mt-4 font-medium leading-[1.55] text-right min-h-[9vh] drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          {phase < 2 ? "A Beeldings pode agir por você." : 
           phase < 3 ? "Crie regras e agendamentos para automatizar rotinas." : 
           "Um ciclo contínuo e inteligente."}
        </motion.p>
        
        <div className="flex flex-wrap justify-end gap-x-4 gap-y-2 mt-5 text-[1.15vw] font-mono text-white/80 uppercase tracking-wider font-bold">
          <motion.span 
            className="text-white drop-shadow-[0_0_10px_#10b981]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: phase >= 4 ? 1 : 0, y: phase >= 4 ? 0 : 10 }}
          >
            Captar.
          </motion.span>
          <motion.span 
            className="text-white drop-shadow-[0_0_10px_#10b981]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: phase >= 5 ? 1 : 0, y: phase >= 5 ? 0 : 10 }}
          >
            Interpretar.
          </motion.span>
          <motion.span 
            className="text-white drop-shadow-[0_0_10px_#10b981]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: phase >= 6 ? 1 : 0, y: phase >= 6 ? 0 : 10 }}
          >
            Conectar.
          </motion.span>
          <motion.span 
            className="text-accent drop-shadow-[0_0_10px_#38bdf8]"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: phase >= 7 ? 1 : 0, scale: phase >= 7 ? 1.2 : 0.8 }}
            transition={{ type: "spring", stiffness: 100 }}
          >
            Agir.
          </motion.span>
        </div>
      </div>

      <motion.div 
        className="absolute left-[4vw] top-[11vh] w-[52vw] h-[78vh] rounded-2xl overflow-hidden shadow-[0_0_150px_rgba(16,185,129,0.25)] border border-success/30"
        initial={{ opacity: 0, x: "-15vw", rotateY: -25, scale: 0.9 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          x: phase >= 1 ? "0vw" : "-15vw", 
          rotateY: phase >= 1 ? 10 : -25,
          scale: phase >= 3 ? 1.05 : 0.95
        }}
        transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: 1500 }}
      >
        <img src={autoImg} className="w-full h-full object-cover object-left" alt="Automations" />
        
        {/* Logic flow overlay effect */}
        <motion.div 
          className="absolute inset-0 bg-gradient-to-tr from-success/10 to-transparent pointer-events-none mix-blend-screen"
        />
      </motion.div>
    </motion.div>
  );
}
