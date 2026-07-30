import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import devicesImg from "@assets/screenshots/bluebee_devices.png";

export function DevicesScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
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
      <motion.div 
        className="absolute top-[8vh] z-30 text-center flex flex-col items-center w-full"
        initial={{ opacity: 0, y: -40, filter: 'blur(10px)' }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : -40, filter: phase >= 1 ? 'blur(0px)' : 'blur(10px)' }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[4.5vw] font-display font-black tracking-tight drop-shadow-2xl">
          Conectividade <span className="text-transparent bg-clip-text bg-gradient-to-r from-secondary to-accent">Universal</span>
        </h2>
        <motion.div 
          className="flex gap-8 mt-6 text-[1.2vw] font-mono text-white/60 uppercase tracking-widest"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 1 }}
        >
          <span className="text-white drop-shadow-[0_0_10px_#06b6d4]">BACnet</span>
          <span className="text-white/40">•</span>
          <span className="text-white drop-shadow-[0_0_10px_#06b6d4]">Modbus</span>
          <span className="text-white/40">•</span>
          <span className="text-white drop-shadow-[0_0_10px_#06b6d4]">MQTT</span>
          <span className="text-white/40">•</span>
          <span className="text-white drop-shadow-[0_0_10px_#06b6d4]">SNMP</span>
        </motion.div>
      </motion.div>

      <motion.div 
        className="w-[70vw] h-[60vh] mt-[25vh] rounded-2xl overflow-hidden shadow-[0_40px_120px_rgba(6,182,212,0.25)] border border-secondary/20 relative z-20"
        initial={{ opacity: 0, y: "30vh", rotateX: 45, scale: 0.8 }}
        animate={{ 
          opacity: phase >= 1 ? 1 : 0, 
          y: phase >= 1 ? "0vh" : "30vh",
          rotateX: phase >= 1 ? 0 : 45,
          scale: phase >= 3 ? 1 : 0.95
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
