import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import autoImg from "@assets/screenshots/bluebee_automation.png";

export function AutomationScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1800),
      setTimeout(() => setPhase(3), 3500),
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
      <div className="absolute top-[30vh] right-[8vw] z-30 max-w-[35vw] text-right flex flex-col items-end">
        <motion.div 
          className="w-20 h-1 bg-gradient-to-l from-success to-transparent mb-8"
          initial={{ scaleX: 0, transformOrigin: "right" }}
          animate={{ scaleX: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="overflow-hidden pb-4">
          <motion.h2 
            className="text-[5vw] font-display font-black leading-[1.1] tracking-tight"
            initial={{ y: "100%" }}
            animate={{ y: phase >= 1 ? "0%" : "100%" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          >
            Motor de <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-success to-green-400">Automações</span>
          </motion.h2>
        </div>
        
        <motion.p
          className="text-[1.6vw] text-white/70 mt-4 font-light leading-relaxed text-right"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 20 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          Crie rotinas e ações encadeadas baseadas em eventos complexos, horários ou leituras avançadas de sensores.
        </motion.p>
      </div>

      <motion.div 
        className="absolute left-[5vw] top-[10vh] w-[55vw] h-[80vh] rounded-2xl overflow-hidden shadow-[0_0_150px_rgba(16,185,129,0.25)] border border-success/30"
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
