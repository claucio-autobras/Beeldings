import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import logoPng from "@assets/bluebee-logo.png";

export function OutroScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2500),
      setTimeout(() => setPhase(3), 4500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0, filter: 'blur(20px)' }}
        animate={{ scale: phase >= 1 ? 1 : 0.7, opacity: phase >= 1 ? 1 : 0, filter: phase >= 1 ? 'blur(0px)' : 'blur(20px)' }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
        className="mb-10 relative"
      >
        <motion.div 
          className="absolute inset-0 bg-primary/40 blur-[100px] rounded-full"
          animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        <img src={logoPng} alt="BlueBee Logo" className="w-[40vw] object-contain drop-shadow-2xl relative z-10" />
      </motion.div>

      <div className="overflow-hidden">
        <motion.h1 
          className="text-[3.5vw] font-display font-bold tracking-tight text-white/90 mt-4"
          initial={{ y: "100%" }}
          animate={{ y: phase >= 2 ? "0%" : "100%" }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          O controle em suas mãos.
        </motion.h1>
      </div>

      <motion.div
        className="mt-16 bg-gradient-to-r from-primary to-secondary text-white px-10 py-5 rounded-full text-[1.4vw] font-bold tracking-[0.2em] shadow-[0_10px_40px_rgba(6,182,212,0.4)] border border-white/20 relative overflow-hidden"
        initial={{ opacity: 0, y: 30, scale: 0.9 }}
        animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 30, scale: phase >= 3 ? 1 : 0.9 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div 
          className="absolute inset-0 bg-white/20 w-full"
          initial={{ x: "-100%" }}
          animate={{ x: phase >= 3 ? ["-100%", "200%"] : "-100%" }}
          transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 4, ease: "easeInOut" }}
        />
        <span className="relative z-10">AGENDE UMA DEMONSTRAÇÃO</span>
      </motion.div>
    </motion.div>
  );
}
