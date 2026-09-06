import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import logoPng from "@assets/bluebee-logo.png";
import { SceneBackdrop } from '../SceneBackdrop';

export function OutroScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Total 30.2s
    const timers = [
      setTimeout(() => setPhase(1), 500),    // "Com a Beeldings..."
      setTimeout(() => setPhase(2), 6500),   // "Mais visibilidade."
      setTimeout(() => setPhase(3), 7500),   // "Mais previsibilidade."
      setTimeout(() => setPhase(4), 9500),   // "Mais eficiência com redução de custo."
      setTimeout(() => setPhase(5), 11000),  // "Mais autonomia."
      setTimeout(() => setPhase(6), 13000),  // "Porque o futuro..."
      setTimeout(() => setPhase(7), 16000),  // "É saber o que fazer com eles!"
      setTimeout(() => setPhase(8), 20000),  // Logo + "Descubra tudo..."
      setTimeout(() => setPhase(9), 24000),  // CTA
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-bg-dark"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <SceneBackdrop image="beeldings-building-background.jpg" accent="cyan" position="center 55%" />
      {/* Intro Text phase 1-5 */}
      <AnimatePresence>
        {phase >= 1 && phase < 6 && (
          <motion.div 
            className="absolute inset-0 flex flex-col items-center justify-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, filter: "blur(10px)", scale: 1.05 }}
            transition={{ duration: 1 }}
          >
            <h2 className="text-[3.5vw] font-display font-light text-center text-white max-w-[70vw] leading-tight mb-12">
              Os dados passam a gerar inteligência para uma operação mais <span className="font-bold text-accent">preparada, previsível, eficiente e ágil.</span>
            </h2>
            
            <div className="flex flex-wrap justify-center gap-6 max-w-[80vw]">
              <motion.div 
                className="px-6 py-3 border border-white/20 rounded-full bg-white/5 backdrop-blur-md"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 20 }}
              >
                <span className="text-[1.5vw] font-display font-bold text-white tracking-wide">Visibilidade</span>
              </motion.div>
              <motion.div 
                className="px-6 py-3 border border-white/20 rounded-full bg-white/5 backdrop-blur-md"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 20 }}
              >
                <span className="text-[1.5vw] font-display font-bold text-white tracking-wide">Previsibilidade</span>
              </motion.div>
              <motion.div 
                className="px-6 py-3 border border-accent/40 rounded-full bg-accent/10 backdrop-blur-md shadow-[0_0_20px_rgba(56,189,248,0.2)]"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: phase >= 4 ? 1 : 0, y: phase >= 4 ? 0 : 20 }}
              >
                <span className="text-[1.5vw] font-display font-bold text-accent tracking-wide">Eficiência & Redução de Custo</span>
              </motion.div>
              <motion.div 
                className="px-6 py-3 border border-white/20 rounded-full bg-white/5 backdrop-blur-md"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: phase >= 5 ? 1 : 0, y: phase >= 5 ? 0 : 20 }}
              >
                <span className="text-[1.5vw] font-display font-bold text-white tracking-wide">Autonomia</span>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Philosophy phase 6-7 */}
      <AnimatePresence>
        {phase >= 6 && phase < 8 && (
          <motion.div 
            className="absolute inset-0 flex flex-col items-center justify-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, filter: "blur(10px)" }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="text-[4.2vw] font-display font-bold text-center text-white leading-tight max-w-[82vw] rounded-3xl border border-white/10 bg-[#020617]/84 px-[4vw] py-[4vh] shadow-[0_24px_90px_rgba(0,0,0,0.6)] backdrop-blur-md">
              O futuro da operação não é <span className="text-white/65">ter mais dados</span>.<br/>
              {phase >= 7 && (
                <motion.span 
                  className="text-transparent bg-clip-text bg-gradient-to-r from-secondary to-accent block mt-4 text-[5vw] drop-shadow-lg"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  É saber o que fazer com eles!
                </motion.span>
              )}
            </h2>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Final Logo and CTA phase 8-9 */}
      <AnimatePresence>
        {phase >= 8 && (
          <motion.div 
            className="absolute inset-0 flex flex-col items-center justify-center"
            initial={{ opacity: 0, filter: "blur(20px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
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

            <motion.h1 
              className="text-[2.5vw] font-display font-light text-white/80 mt-4 text-center max-w-[60vw]"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, delay: 0.5 }}
            >
              Descubra tudo o que a Beeldings pode fazer pela sua operação.
            </motion.h1>

            <motion.div
              className="mt-12 bg-gradient-to-r from-primary to-secondary text-white px-10 py-5 rounded-full text-[1.4vw] font-bold tracking-[0.2em] shadow-[0_10px_40px_rgba(6,182,212,0.4)] border border-white/20 relative overflow-hidden"
              initial={{ opacity: 0, y: 30, scale: 0.9 }}
              animate={{ opacity: phase >= 9 ? 1 : 0, y: phase >= 9 ? 0 : 30, scale: phase >= 9 ? 1 : 0.9 }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            >
              <motion.div 
                className="absolute inset-0 bg-white/20 w-full"
                initial={{ x: "-100%" }}
                animate={{ x: phase >= 9 ? ["-100%", "200%"] : "-100%" }}
                transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 4, ease: "easeInOut" }}
              />
              <span className="relative z-10">AGENDE UMA DEMONSTRAÇÃO</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
}
