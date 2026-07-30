import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import dashImg from "@assets/screenshots/bluebee_dashboard.png";

export function DashboardScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
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
      exit={{ opacity: 0, x: "-5vw", filter: "blur(15px)" }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="absolute top-[25vh] left-[8vw] z-30 max-w-[35vw]">
        <motion.div 
          className="w-20 h-1 bg-gradient-to-r from-accent to-transparent mb-8"
          initial={{ scaleX: 0, transformOrigin: "left" }}
          animate={{ scaleX: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="overflow-hidden">
          <motion.h2 
            className="text-[5vw] font-display font-black leading-[1.1] tracking-tight"
            initial={{ y: "100%" }}
            animate={{ y: phase >= 1 ? "0%" : "100%" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          >
            Visão 360°<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-primary">em Tempo Real</span>
          </motion.h2>
        </div>
        
        <motion.p
          className="text-[1.6vw] text-white/70 mt-8 font-light leading-relaxed"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 20 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          Acompanhe todos os KPIs críticos da sua operação em um dashboard customizável e altamente intuitivo.
        </motion.p>
      </div>

      <motion.div 
        className="absolute right-[-10vw] top-[5vh] w-[75vw] h-[90vh] rounded-2xl overflow-hidden shadow-[0_0_150px_rgba(14,116,144,0.4)] border border-white/10"
        initial={{ opacity: 0, x: "20vw", rotateY: 35, rotateX: 5, scale: 0.8 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          x: phase >= 1 ? "0vw" : "20vw", 
          rotateY: phase >= 1 ? -15 : 35,
          rotateX: phase >= 1 ? 0 : 5,
          scale: phase >= 3 ? 1.05 : 0.95
        }}
        transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <img src={dashImg} className="w-full h-full object-cover object-left-top" alt="Dashboard" />
        
        {/* Cinematic Reflection */}
        <motion.div 
          className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none mix-blend-overlay"
        />
        
        {/* Scanning Light Line */}
        <motion.div 
          className="absolute top-0 left-0 w-full h-[2px] bg-accent/80 shadow-[0_0_20px_#38bdf8]"
          animate={{ y: ["-10vh", "100vh"] }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
        />
      </motion.div>
    </motion.div>
  );
}
