import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function AiScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2500),
      setTimeout(() => setPhase(3), 4500),
      setTimeout(() => setPhase(4), 7000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 z-10 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: "blur(30px)", scale: 1.1 }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Background Neural Network Rings */}
      <motion.div 
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      >
        <div className="w-[45vw] h-[45vw] border-[1px] border-accent/30 rounded-full border-dashed opacity-50" />
        <div className="absolute w-[65vw] h-[65vw] border-[1px] border-accent/20 rounded-full border-dotted opacity-30" />
        <div className="absolute w-[85vw] h-[85vw] border-[1px] border-primary/20 rounded-full border-dashed opacity-20" />
      </motion.div>

      <motion.div 
        className="text-center z-30 mb-8"
        initial={{ opacity: 0, y: -40 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -40 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[5vw] font-display font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white to-white/70 drop-shadow-2xl">
          Inteligência Artificial
        </h2>
      </motion.div>

      <motion.div 
        className="w-[50vw] bg-[#0f172a]/90 backdrop-blur-xl rounded-3xl border border-white/10 p-8 relative shadow-[0_0_100px_rgba(6,182,212,0.15)] z-20"
        initial={{ opacity: 0, scale: 0.85, y: 50, rotateX: -15 }}
        animate={{ 
          opacity: phase >= 2 ? 1 : 0, 
          scale: phase >= 2 ? 1 : 0.85, 
          y: phase >= 2 ? 0 : 50,
          rotateX: phase >= 2 ? 0 : -15
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: 1000 }}
      >
        {/* Glow behind chat */}
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 to-transparent rounded-3xl pointer-events-none" />

        <div className="flex gap-2 mb-8 items-center border-b border-white/5 pb-4">
          <div className="flex gap-2">
            <div className="w-3.5 h-3.5 rounded-full bg-error/90 shadow-sm" />
            <div className="w-3.5 h-3.5 rounded-full bg-warning/90 shadow-sm" />
            <div className="w-3.5 h-3.5 rounded-full bg-success/90 shadow-sm" />
          </div>
          <div className="ml-4 text-xs font-mono text-white/30">BlueBee AI Assistant</div>
        </div>
        
        <div className="space-y-6">
          <motion.div 
            className="bg-[#020617] p-5 rounded-2xl rounded-tl-none w-[85%] border border-white/10 shadow-lg"
            initial={{ opacity: 0, x: -30, filter: 'blur(10px)' }}
            animate={{ opacity: phase >= 3 ? 1 : 0, x: phase >= 3 ? 0 : -30, filter: phase >= 3 ? 'blur(0px)' : 'blur(10px)' }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="text-[1.3vw] text-text-secondary leading-relaxed">Me dê um resumo do consumo de energia deste mês no Prédio A.</p>
          </motion.div>

          <motion.div 
            className="bg-gradient-to-br from-primary/30 to-primary/10 p-5 rounded-2xl rounded-tr-none w-[85%] ml-auto border border-primary/30 shadow-[0_10px_30px_rgba(14,116,144,0.2)] relative overflow-hidden"
            initial={{ opacity: 0, x: 30, filter: 'blur(10px)' }}
            animate={{ opacity: phase >= 4 ? 1 : 0, x: phase >= 4 ? 0 : 30, filter: phase >= 4 ? 'blur(0px)' : 'blur(10px)' }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* AI sparkle effect */}
            <motion.div 
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent w-[200%]"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 3 }}
            />
            <p className="text-[1.3vw] text-white leading-relaxed font-light">O consumo foi de <span className="font-bold text-accent">124 MWh</span>, <span className="text-success font-medium">5% abaixo da meta</span>. Não houve anomalias detectadas nos chillers.</p>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}
