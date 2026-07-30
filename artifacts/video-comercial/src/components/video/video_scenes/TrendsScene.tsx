import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import trendsImg from "@assets/screenshots/bluebee_trends.png";

export function TrendsScene() {
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
      className="absolute inset-0 z-10 flex items-center justify-end"
      initial={{ opacity: 0, scale: 1.1, filter: "blur(15px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: "10vw", filter: "blur(20px)" }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="absolute top-[30vh] left-[8vw] z-30 max-w-[35vw]">
        <motion.div 
          className="w-20 h-1 bg-gradient-to-r from-warning to-transparent mb-8"
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
            Análise de <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-warning to-amber-500">Trends</span>
          </motion.h2>
        </div>
        
        <motion.p
          className="text-[1.6vw] text-white/70 mt-6 font-light leading-relaxed"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 20 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          Compare variáveis históricas, identifique anomalias e otimize o consumo energético das suas instalações com precisão cirúrgica.
        </motion.p>
      </div>

      <motion.div 
        className="absolute right-[5vw] top-[15vh] w-[55vw] h-[70vh] rounded-2xl overflow-hidden shadow-[0_0_150px_rgba(245,158,11,0.2)] border border-warning/30"
        initial={{ opacity: 0, x: "15vw", rotateY: 25, scale: 0.9 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          x: phase >= 1 ? "0vw" : "15vw", 
          rotateY: phase >= 1 ? -5 : 25,
          scale: phase >= 3 ? 1.05 : 0.95
        }}
        transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: 1500 }}
      >
        <img src={trendsImg} className="w-full h-full object-cover object-left-top scale-105" alt="Trends" />
        
        {/* Subtle data flow effect overlay */}
        <motion.div 
          className="absolute inset-0 bg-gradient-to-tr from-warning/10 via-transparent to-transparent pointer-events-none mix-blend-screen"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
    </motion.div>
  );
}
