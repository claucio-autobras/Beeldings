import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import logoPng from "@assets/bluebee-logo.png";

export function IntroScene() {
  const [phase, setPhase] = useState(0);
  const buildingImage = `${import.meta.env.BASE_URL}beeldings-building-background.jpg`;

  useEffect(() => {
    // Total 21.4s
    const timers = [
      setTimeout(() => setPhase(1), 500),   // "Seu prédio está falando..."
      setTimeout(() => setPhase(2), 2500),  // "Temperatura..."
      setTimeout(() => setPhase(3), 3200),  // "Energia..."
      setTimeout(() => setPhase(4), 3900),  // "Equipamentos..."
      setTimeout(() => setPhase(5), 4700),  // "Ocupação..."
      setTimeout(() => setPhase(6), 5600),  // "Eventos..."
      setTimeout(() => setPhase(7), 6500),  // "Alarmes..."
      setTimeout(() => setPhase(8), 7500),  // "Desempenho."
      setTimeout(() => setPhase(9), 9000),  // "Todos os dias, milhares de informações..."
      setTimeout(() => setPhase(10), 14500), // "Mas o desafio não é ter dados."
      setTimeout(() => setPhase(11), 17500), // "É transformar dados em inteligência."
      setTimeout(() => setPhase(12), 20500), // exit prep
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const signalWords = [
    { label: "TEMPERATURA", p: 2, x: 1920 * 0.22, y: 1080 * 0.25 }, 
    { label: "ENERGIA", p: 3, x: 1920 * 0.78, y: 1080 * 0.25 },     
    { label: "EQUIPAMENTOS", p: 4, x: 1920 * 0.14, y: 1080 * 0.50 },
    { label: "OCUPAÇÃO", p: 5, x: 1920 * 0.86, y: 1080 * 0.50 },    
    { label: "EVENTOS", p: 6, x: 1920 * 0.25, y: 1080 * 0.75 },     
    { label: "ALARMES", p: 7, x: 1920 * 0.75, y: 1080 * 0.75 },     
    { label: "DESEMPENHO", p: 8, x: 1920 * 0.50, y: 1080 * 0.12 }   
  ];

  const buildingNodes = [
    { x: 1510, y: 205, p: 2 },
    { x: 1650, y: 350, p: 3 },
    { x: 1500, y: 505, p: 4 },
    { x: 1735, y: 675, p: 5 },
    { x: 1305, y: 805, p: 6 },
    { x: 735, y: 770, p: 7 },
    { x: 600, y: 610, p: 8 },
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-[#020617] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Building atmosphere: the data starts in the building itself */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-0 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 1 && phase < 9 ? 1 : 0 }}
        transition={{ duration: 1.5 }}
      >
        <motion.div
          className="absolute -inset-[3%] bg-cover bg-center"
          style={{ backgroundImage: `url("${buildingImage}")` }}
          initial={{ scale: 1.04, x: 0 }}
          animate={{
            scale: phase >= 1 && phase < 9 ? 1.09 : 1.04,
            x: phase >= 1 && phase < 9 ? "-1%" : 0,
          }}
          transition={{ duration: 18, ease: "easeOut" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.97)_0%,rgba(2,6,23,0.82)_35%,rgba(2,6,23,0.58)_72%,rgba(2,6,23,0.72)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(2,6,23,0.94)_0%,rgba(2,6,23,0.18)_48%,rgba(2,6,23,0.74)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(2,6,23,0.28)_0%,rgba(2,6,23,0.72)_58%,rgba(2,6,23,0.9)_100%)]" />
        <motion.div
          className="absolute inset-0 bg-cyan-400/10 mix-blend-screen"
          animate={{ opacity: [0.18, 0.28, 0.18] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      {/* Background Grid & Signals */}
      <motion.div 
        className="absolute inset-0 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 1 && phase < 9 ? 1 : 0 }}
        transition={{ duration: 1.5 }}
      >
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M 80 0 L 0 0 0 80" fill="none" stroke="rgba(34,211,238,0.04)" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          
          {/* Concentric Circles */}
          <g className="opacity-30">
            {[100, 250, 450, 650, 900, 1200].map((r, i) => (
              <motion.circle
                key={`ring-${r}`}
                cx="960" cy="540"
                r={r}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1"
                strokeDasharray="4 16"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ 
                  scale: phase >= 1 && phase < 9 ? 1 : 0.8, 
                  opacity: phase >= 1 && phase < 9 ? (1 - r/1500) * 0.4 : 0,
                  rotate: 360 
                }}
                transition={{ 
                  rotate: { duration: 80 + i * 20, repeat: Infinity, ease: "linear" },
                  opacity: { duration: 1.5 },
                  scale: { duration: 1.5 }
                }}
                style={{ transformOrigin: "960px 540px" }}
              />
            ))}
          </g>

          {/* Connection Lines */}
          {signalWords.map((word) => (
            <motion.line
              key={`line-${word.label}`}
              x1="960" y1="540"
              x2={word.x} y2={word.y}
              stroke="rgba(34, 211, 238, 0.15)"
              strokeWidth="2"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ 
                pathLength: phase >= word.p && phase < 9 ? 1 : 0, 
                opacity: phase >= word.p && phase < 9 ? 1 : 0 
              }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
            />
          ))}

          {/* Real building nodes: each point lights up on a facade zone */}
          {buildingNodes.map((node, i) => (
            <motion.g
              key={`building-node-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: phase >= node.p && phase < 9 ? 1 : 0 }}
              transition={{ duration: 0.7 }}
            >
              <motion.line
                x1={node.x}
                y1={node.y}
                x2="960"
                y2="540"
                stroke="rgba(34, 211, 238, 0.28)"
                strokeWidth="1.5"
                strokeDasharray="3 12"
              />
              <motion.circle
                cx={node.x}
                cy={node.y}
                r="7"
                fill="rgba(34, 211, 238, 0.18)"
                stroke="#67e8f9"
                strokeWidth="1.5"
                animate={{
                  r: [5, 10, 5],
                  opacity: [0.55, 1, 0.55],
                }}
                transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.14, ease: "easeInOut" }}
              />
              <motion.circle
                cx={node.x}
                cy={node.y}
                r="3"
                fill="#a5f3fc"
                style={{ filter: "drop-shadow(0 0 8px #22d3ee)" }}
              />
            </motion.g>
          ))}

          {/* Traveling Signals */}
          {signalWords.map((word, i) => (
            <motion.circle
              key={`signal-${word.label}`}
              r="4"
              fill="#22d3ee"
              style={{ filter: "drop-shadow(0 0 6px #22d3ee)" }}
              initial={{ cx: word.x, cy: word.y, opacity: 0 }}
              animate={
                phase >= word.p && phase < 9 ? {
                  cx: [word.x, 960],
                  cy: [word.y, 540],
                  opacity: [0, 1, 0]
                } : { opacity: 0 }
              }
              transition={{ duration: 2.5, repeat: Infinity, ease: "linear", delay: i * 0.3 }}
            />
          ))}
        </svg>
      </motion.div>

      {/* Phase 1: Seu prédio está falando */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ 
          opacity: phase >= 1 && phase < 9 ? 1 : 0, 
          scale: phase >= 1 && phase < 9 ? 1 : 1.05, 
          filter: phase >= 9 ? 'blur(15px)' : 'blur(0px)' 
        }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="relative">
          <div className="absolute inset-0 bg-cyan-500/10 blur-[80px] rounded-full" />
          <h1 className="text-[5.5vw] font-display font-black text-white text-center leading-[1.1] relative z-10 drop-shadow-2xl">
            Seu prédio está<br/>
            <span className="text-cyan-400" style={{ textShadow: "0 0 40px rgba(34,211,238,0.5)" }}>falando</span> o tempo todo.
          </h1>
        </div>
      </motion.div>

      {/* Phase 2-8: Signals around the center */}
      <div className="absolute inset-0 pointer-events-none z-20">
        {signalWords.map((word, i) => (
          <div 
            key={word.label}
            className="absolute w-0 h-0 flex items-center justify-center" 
            style={{ left: `${(word.x / 1920) * 100}%`, top: `${(word.y / 1080) * 100}%` }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ 
                opacity: phase >= word.p && phase < 9 ? 1 : 0,
                scale: phase >= word.p && phase < 9 ? 1 : 0.5,
              }}
              transition={{ duration: 0.8, type: "spring", stiffness: 100 }}
            >
              <motion.div
                animate={{ 
                  scale: [1, 1.03, 1], 
                  boxShadow: ["0 0 10px rgba(34,211,238,0.1)", "0 0 25px rgba(34,211,238,0.3)", "0 0 10px rgba(34,211,238,0.1)"] 
                }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
                className="text-[1.2vw] font-mono font-semibold text-cyan-300 tracking-widest px-6 py-2.5 border border-cyan-500/30 rounded-full bg-[#0f172a]/90 backdrop-blur-md whitespace-nowrap"
              >
                {word.label}
              </motion.div>
            </motion.div>
          </div>
        ))}
      </div>

      {/* Phase 9: Todos os dias... */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center z-30"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: phase >= 9 && phase < 10 ? 1 : 0, y: phase >= 9 && phase < 10 ? 0 : -30 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[4vw] font-display font-medium text-white text-center max-w-[80vw] leading-tight drop-shadow-lg">
          Todos os dias, <span className="text-cyan-400 font-bold">milhares de informações</span><br/> são geradas pela operação.
        </h2>
      </motion.div>

      {/* Phase 10: Mas o desafio... */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center z-30"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: phase >= 10 && phase < 11 ? 1 : 0, scale: phase >= 10 && phase < 11 ? 1 : 1.05 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2 className="text-[4.5vw] font-display font-bold text-white text-center drop-shadow-lg">
          Mas o desafio não é <span className="text-white/70">ter dados</span>.
        </h2>
      </motion.div>

      {/* Phase 11: Transformar dados em inteligência */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center z-30"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: phase >= 11 ? 1 : 0, scale: phase >= 11 ? 1 : 1.1 }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          className="mb-12 relative"
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.div 
            className="absolute inset-0 bg-cyan-400/20 blur-[80px] rounded-full"
            animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
          <img src={logoPng} alt="Logo" className="w-[32vw] object-contain relative z-10 drop-shadow-[0_0_40px_rgba(34,211,238,0.4)]" />
        </motion.div>
        
        <h1 className="text-[4.5vw] font-display font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/70 drop-shadow-lg text-center mt-4">
          É transformar dados em <span className="text-cyan-400" style={{ textShadow: "0 0 30px rgba(34,211,238,0.4)" }}>inteligência</span>.
        </h1>
      </motion.div>
      
    </motion.div>
  );
}
