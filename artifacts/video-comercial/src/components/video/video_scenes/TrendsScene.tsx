import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SceneBackdrop } from '../SceneBackdrop';

const trendsImg = `${import.meta.env.BASE_URL}current-ui/trends.png`;

export function TrendsScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Total 10.6s
    const timers = [
      setTimeout(() => setPhase(1), 300),   // "Mas monitorar é apenas o começo..."
      setTimeout(() => setPhase(2), 2500),  // "Com o módulo de Trends..."
      setTimeout(() => setPhase(3), 5500),  // "...compara tendências..."
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
      <SceneBackdrop image="beeldings-trends-background.jpg" accent="amber" position="center" />
      <div className="absolute top-[24vh] left-[5vw] z-30 w-[31vw] rounded-3xl border border-white/10 bg-[#020617]/85 px-[2.4vw] py-[3vh] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-md">
        <motion.div 
          className="w-20 h-1 bg-gradient-to-r from-warning to-transparent mb-8"
          initial={{ scaleX: 0, transformOrigin: "left" }}
          animate={{ scaleX: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="overflow-hidden">
          <motion.h2 
            className="text-[4.2vw] font-display font-black leading-[1.08] tracking-tight drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)]"
            initial={{ y: "100%" }}
            animate={{ y: phase >= 1 ? "0%" : "100%" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          >
            Análise de <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-warning to-amber-500">Trends</span>
          </motion.h2>
        </div>
        
        <motion.p
          className="text-[1.45vw] text-white/90 mt-6 font-medium leading-[1.55] min-h-[12vh] drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 20 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          {phase < 3 ? "Analise o histórico das variáveis do seu prédio." : "Compare tendências, identifique comportamentos e tome decisões com base em dados."}
        </motion.p>
      </div>

      <motion.div 
        className="absolute right-[3vw] top-[15vh] w-[57vw] h-[70vh] rounded-2xl overflow-hidden shadow-[0_0_150px_rgba(245,158,11,0.2)] border border-warning/30"
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
