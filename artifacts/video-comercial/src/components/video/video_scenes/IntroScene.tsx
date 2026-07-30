import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import logoPng from "@assets/bluebee-logo.png";

export function IntroScene() {
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
      exit={{ opacity: 0, scale: 1.2, filter: 'blur(20px)' }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0, filter: 'blur(20px)' }}
        animate={{ scale: phase >= 1 ? 1 : 0.85, opacity: phase >= 1 ? 1 : 0, filter: phase >= 1 ? 'blur(0px)' : 'blur(20px)' }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }}
        className="mb-12 relative"
      >
        {/* Glow behind logo */}
        <motion.div 
          className="absolute inset-0 bg-primary/40 blur-[80px] rounded-full"
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        <img src={logoPng} alt="BlueBee Logo" className="w-[35vw] object-contain drop-shadow-2xl relative z-10" />
      </motion.div>

      <div className="overflow-hidden">
        <motion.h1 
          className="text-[4.5vw] font-display font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/70 drop-shadow-2xl"
          initial={{ y: "120%", rotateX: 45, opacity: 0 }}
          animate={{ y: phase >= 2 ? "0%" : "120%", rotateX: phase >= 2 ? 0 : 45, opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          O futuro da gestão predial
        </motion.h1>
      </div>

      <motion.div
        className="mt-8 flex items-center gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 20 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div className="h-[1px] w-[8vw] bg-gradient-to-r from-transparent to-accent" />
        <p className="text-[1.2vw] font-medium text-text-secondary tracking-[0.3em] uppercase">
          PLATAFORMA IoT & BMS UNIFICADA
        </p>
        <motion.div className="h-[1px] w-[8vw] bg-gradient-to-l from-transparent to-accent" />
      </motion.div>
    </motion.div>
  );
}
