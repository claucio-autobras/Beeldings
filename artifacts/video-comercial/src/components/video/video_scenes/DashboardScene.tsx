import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SceneBackdrop } from '../SceneBackdrop';

const dashImg = `${import.meta.env.BASE_URL}current-ui/dashboard.png`;

export function DashboardScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Total 18.8s
    const timers = [
      setTimeout(() => setPhase(1), 500),   // "Conheça a Beeldings."
      setTimeout(() => setPhase(2), 2500),  // "Um ecossistema inteligente..."
      setTimeout(() => setPhase(3), 7000),  // "Em uma única plataforma..."
      setTimeout(() => setPhase(4), 11500), // "Sites, dispositivos..."
      setTimeout(() => setPhase(5), 15000), // "tudo em uma única visão."
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
      <SceneBackdrop image="beeldings-dashboard-background.jpg" accent="cyan" position="center 35%" />
      {/* Dedicated reading zone: it ends before the product capture begins. */}
      <div className="absolute inset-y-0 left-0 z-20 w-[43vw] bg-gradient-to-r from-[#020617]/90 via-[#020617]/72 to-transparent pointer-events-none" />
      <div className="absolute top-[22vh] left-[4vw] z-40 w-[31vw] max-w-[31vw] overflow-hidden rounded-3xl border border-white/15 bg-[#020617]/95 px-[2.2vw] py-[3vh] shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-md">
        <motion.div 
          className="w-20 h-1 bg-gradient-to-r from-accent to-transparent mb-8"
          initial={{ scaleX: 0, transformOrigin: "left" }}
          animate={{ scaleX: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <div className="overflow-hidden">
          <motion.h2 
            className="text-[4.1vw] font-display font-black leading-[1.08] tracking-tight drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)]"
            initial={{ y: "100%" }}
            animate={{ y: phase >= 1 ? "0%" : "100%" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          >
            {phase < 3 ? (
              <>Conheça a<br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-primary">Beeldings</span></>
            ) : (
              <>Visão 360°<br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-primary">em Tempo Real</span></>
            )}
          </motion.h2>
        </div>
        
        <motion.p
          className="text-[1.35vw] text-white/95 mt-6 font-medium leading-[1.55] min-h-[10vh] max-w-full drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 20 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          {phase < 3 ? "Um ecossistema inteligente que conecta dados, sistemas e operação." : 
           phase < 4 ? "Você acompanha sua operação de ponta a ponta." : 
           "Sites, dispositivos, gateways, indicadores e alarmes."}
        </motion.p>
      </div>

      {/* Dashboard Image */}
      <motion.div 
        className="absolute left-[43vw] right-[-5vw] top-[7vh] w-auto h-[86vh] rounded-2xl overflow-hidden shadow-[0_0_150px_rgba(14,116,144,0.4)] border border-white/10"
        initial={{ opacity: 0, x: "20vw", rotateY: 35, rotateX: 5, scale: 0.8 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          x: phase >= 1 ? "0vw" : "20vw", 
          rotateY: phase >= 1 ? -15 : 35,
          rotateX: phase >= 1 ? 0 : 5,
          scale: phase >= 5 ? 1.05 : 0.95
        }}
        transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformStyle: "preserve-3d" }}
      >
        <img src={dashImg} className="w-full h-full object-cover object-left-top" alt="Dashboard" />
        
        <motion.div 
          className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent pointer-events-none mix-blend-overlay"
        />
        
        <motion.div 
          className="absolute top-0 left-0 w-full h-[2px] bg-accent/80 shadow-[0_0_20px_#38bdf8]"
          animate={{ y: ["-10vh", "100vh"] }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
        />
      </motion.div>
    </motion.div>
  );
}
