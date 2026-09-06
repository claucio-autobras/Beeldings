import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SceneBackdrop } from '../SceneBackdrop';

const devicesImg = `${import.meta.env.BASE_URL}current-ui/devices.png`;

export function DevicesScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    // Total 16.3s
    const timers = [
      setTimeout(() => setPhase(1), 500),   // "A Beeldings se conecta..."
      setTimeout(() => setPhase(2), 5000),  // "BACnet..."
      setTimeout(() => setPhase(3), 6000),  // "Modbus..."
      setTimeout(() => setPhase(4), 7000),  // "MQTT..."
      setTimeout(() => setPhase(5), 9000),  // "Com descoberta automática..."
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 z-10 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: "blur(20px)", scale: 1.1 }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <SceneBackdrop image="beeldings-devices-background.jpg" accent="cyan" position="center" />
      <motion.div 
        className="absolute top-[4vh] z-30 text-center flex flex-col items-center w-auto max-w-[76vw] rounded-3xl border border-white/10 bg-[#020617]/82 px-[3vw] pt-[2vh] pb-[10vh] shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-md"
        initial={{ opacity: 0, y: -40, filter: 'blur(10px)' }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -40, filter: phase >= 1 ? 'blur(0px)' : 'blur(10px)' }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[3.8vw] font-display font-black tracking-tight drop-shadow-[0_3px_18px_rgba(0,0,0,0.95)]">
          Conectividade <span className="text-transparent bg-clip-text bg-gradient-to-r from-secondary to-accent">Universal</span>
        </h2>
        
        <motion.p
          className="text-[1.4vw] text-white/90 mt-2 font-medium leading-relaxed max-w-[60vw]"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 1 && phase < 5 ? 1 : (phase >= 5 ? 0 : 0) }}
          transition={{ duration: 1 }}
        >
          Integração de diferentes equipamentos e sistemas em um único ecossistema.
        </motion.p>
        
        <motion.p
          className="text-[1.4vw] text-white/90 mt-2 font-medium leading-relaxed max-w-[60vw] absolute top-[8vh]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: phase >= 5 ? 1 : 0, y: phase >= 5 ? 0 : 10 }}
          transition={{ duration: 1 }}
        >
          Com descoberta automática de pontos, a integração é ainda mais simples.
        </motion.p>

        <div className="flex gap-8 mt-12 text-[1.4vw] font-mono text-white/60 uppercase tracking-widest absolute top-[12vh]">
          <motion.span 
            className="text-white drop-shadow-[0_0_10px_#06b6d4]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 10 }}
            transition={{ type: "spring", stiffness: 100 }}
          >
            BACnet
          </motion.span>
          <motion.span 
            className="text-white/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 3 ? 1 : 0 }}
          >
            •
          </motion.span>
          <motion.span 
            className="text-white drop-shadow-[0_0_10px_#06b6d4]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 10 }}
            transition={{ type: "spring", stiffness: 100 }}
          >
            Modbus
          </motion.span>
          <motion.span 
            className="text-white/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 4 ? 1 : 0 }}
          >
            •
          </motion.span>
          <motion.span 
            className="text-white drop-shadow-[0_0_10px_#06b6d4]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: phase >= 4 ? 1 : 0, y: phase >= 4 ? 0 : 10 }}
            transition={{ type: "spring", stiffness: 100 }}
          >
            MQTT
          </motion.span>
        </div>
      </motion.div>

      <motion.div 
        className="w-[72vw] h-[57vh] mt-[30vh] rounded-2xl overflow-hidden shadow-[0_40px_120px_rgba(6,182,212,0.25)] border border-secondary/20 relative z-20 bg-bg-dark"
        initial={{ opacity: 0, y: "30vh", rotateX: 45, scale: 0.8 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          y: phase >= 1 ? "0vh" : "30vh",
          rotateX: phase >= 1 ? 0 : 45,
          scale: phase >= 5 ? 1 : 0.95
        }}
        transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
        style={{ transformOrigin: "bottom center", perspective: 1500 }}
      >
        <img src={devicesImg} className="w-full h-full object-cover object-top" alt="Devices" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#02040a] via-transparent to-transparent opacity-40" />
      </motion.div>
    </motion.div>
  );
}
