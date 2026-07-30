import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import alarmsImg from "@assets/screenshots/bluebee_alarms.png";

export function AlarmsScene() {
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
      className="absolute inset-0 z-10 flex items-center justify-end"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: "10vh", filter: "blur(15px)" }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Background Red Ambient Glow */}
      <motion.div 
        className="absolute inset-0 bg-error/10 mix-blend-color-dodge z-0 pointer-events-none"
        animate={{ opacity: [0, 0.15, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="absolute top-[30vh] right-[8vw] z-30 max-w-[35vw] text-right flex flex-col items-end">
        <motion.div 
          className="w-20 h-1 bg-gradient-to-l from-error to-transparent mb-8"
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
            Gestão de <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-error to-red-400">Alarmes</span>
          </motion.h2>
        </div>
        
        <motion.p
          className="text-[1.6vw] text-white/70 mt-4 font-light leading-relaxed text-right"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 20 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          Seja notificado no exato momento de qualquer falha. Histórico completo e tratativas integradas.
        </motion.p>
      </div>

      <motion.div 
        className="absolute left-[-5vw] top-[10vh] w-[65vw] h-[80vh] rounded-2xl overflow-hidden shadow-[0_0_150px_rgba(239,68,68,0.3)] border border-error/30"
        initial={{ opacity: 0, x: "-20vw", rotateY: -35, rotateX: -5, scale: 0.8 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          x: phase >= 1 ? "0vw" : "-20vw", 
          rotateY: phase >= 1 ? 15 : -35,
          rotateX: phase >= 1 ? 0 : -5,
          scale: phase >= 3 ? 1.05 : 0.95
        }}
        transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <img src={alarmsImg} className="w-full h-full object-cover object-left-top" alt="Alarms" />
        
        <motion.div 
          className="absolute inset-0 bg-gradient-to-bl from-white/10 via-transparent to-transparent pointer-events-none mix-blend-overlay"
        />
      </motion.div>
    </motion.div>
  );
}
