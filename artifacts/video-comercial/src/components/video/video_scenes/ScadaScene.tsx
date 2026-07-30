import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import scadaImg from "@assets/screenshots/bluebee_scada.png";

export function ScadaScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 z-10 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: "-10vh", filter: "blur(20px)" }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div 
        className="absolute top-[8vh] z-30 text-center flex flex-col items-center"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -30 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[5vw] font-display font-black tracking-tight drop-shadow-2xl">
          Supervisório <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">SCADA</span>
        </h2>
        <motion.p 
          className="text-[1.6vw] text-white/70 mt-4 font-light max-w-[50vw] leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 1 }}
        >
          Sinóticos personalizados e interativos diretamente no seu navegador, com renderização de alta performance.
        </motion.p>
      </motion.div>

      <motion.div 
        className="w-[85vw] h-[65vh] mt-[20vh] rounded-2xl overflow-hidden shadow-[0_0_120px_rgba(14,116,144,0.3)] border border-primary/40 relative z-20"
        initial={{ opacity: 0, y: "20vh", rotateX: 20 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          y: phase >= 1 ? "0vh" : "20vh",
          rotateX: phase >= 1 ? 0 : 20,
          scale: phase >= 3 ? 1.02 : 1
        }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
        style={{ perspective: 1500 }}
      >
        <img src={scadaImg} className="w-full h-full object-cover object-top" alt="SCADA" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#02040a]/50 pointer-events-none" />
      </motion.div>
    </motion.div>
  );
}
