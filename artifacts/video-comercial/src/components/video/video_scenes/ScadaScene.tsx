import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SceneBackdrop } from '../SceneBackdrop';

const scadaImg = `${import.meta.env.BASE_URL}current-ui/scada.png`;

export function ScadaScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Total 8.4s
    const timers = [
      setTimeout(() => setPhase(1), 300),   // "Crie telas SCADA..."
      setTimeout(() => setPhase(2), 2000),  // "...com sinóticos..."
      setTimeout(() => setPhase(3), 4500),  // "Supervisão de verdade..."
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
      <SceneBackdrop image="beeldings-scada-background.jpg" accent="cyan" position="center" />
      <motion.div 
        className="absolute top-[5vh] z-30 text-center flex flex-col items-center max-w-[66vw] rounded-3xl border border-white/10 bg-[#020617]/82 px-[3vw] py-[2vh] shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-md"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -30 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[4.1vw] font-display font-black tracking-tight drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)]">
          Supervisório <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">SCADA</span>
        </h2>
        <motion.p 
          className="text-[1.45vw] text-white/90 mt-2 font-medium max-w-[54vw] leading-relaxed min-h-[7vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 1 }}
        >
          {phase < 3 ? "Telas personalizadas com sinóticos animados e comandos diretos." : "Supervisão de verdade, direto pelo navegador."}
        </motion.p>
      </motion.div>

      <motion.div 
        className="w-[84vw] h-[61vh] mt-[25vh] rounded-2xl overflow-hidden shadow-[0_0_120px_rgba(14,116,144,0.3)] border border-primary/40 relative z-20"
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
