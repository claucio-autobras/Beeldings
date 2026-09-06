import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SceneBackdrop } from '../SceneBackdrop';

export function AiScene() {
  const [phase, setPhase] = useState(0);
  const mascotSrc = `${import.meta.env.BASE_URL}beeldings-bluebee-mascot-no-bg.png`;

  useEffect(() => {
    // Total 49.8s
    const timers = [
      setTimeout(() => setPhase(1), 0),      // 0.00 "Mas existe algo..."
      setTimeout(() => setPhase(2), 2580),   // 2.58 "Você não precisa mais procurar..."
      setTimeout(() => setPhase(3), 5420),   // 5.42 "Pode simplesmente perguntar."
      setTimeout(() => setPhase(4), 6640),   // Dramatic Pause - Dim/Converge
      setTimeout(() => setPhase(5), 7640),   // 7.64 "Olá, eu sou a BlueBee..." (Identity reveal)
      setTimeout(() => setPhase(6), 11980),  // 11.98 "Eu transformo a complexidade..." (Chat UI text)
      setTimeout(() => setPhase(7), 18240),  // 18.24 Q1
      setTimeout(() => setPhase(8), 22480),  // 22.48 Q2
      setTimeout(() => setPhase(9), 25420),  // 25.42 Q3
      setTimeout(() => setPhase(10), 27920), // 27.92 Q4
      setTimeout(() => setPhase(11), 30820), // 30.82 "Eu interpreto as informações..." 
      setTimeout(() => setPhase(12), 38520), // 38.52 "Porque você não precisa acompanhar..."
      setTimeout(() => setPhase(13), 45180), // 45.18 "Pergunte, entenda, decida e aja."
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const questions = [
    { p: 7, text: "Como está o consumo de energia hoje?" },
    { p: 8, text: "Existe alguma anomalia acontecendo?" },
    { p: 9, text: "Quais equipamentos precisam de atenção?" },
    { p: 10, text: "O que mudou na operação nas últimas horas?" }
  ];

  return (
    <motion.div 
      className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-bg-dark"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: "blur(30px)", scale: 1.1 }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <SceneBackdrop image="beeldings-building-background.jpg" accent="cyan" emphasis visible={phase >= 4} position="center 55%" />
      {/* Background Neural Network Rings */}
      <motion.div 
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        animate={{ 
          rotate: phase >= 4 ? 180 : 360,
          scale: phase >= 4 ? 0.8 : 1,
          opacity: phase >= 4 ? 0.2 : 1 
        }}
        transition={{ duration: phase >= 4 ? 2 : 60, repeat: phase >= 4 ? 0 : Infinity, ease: phase >= 4 ? "backOut" : "linear" }}
      >
        <div className="w-[45vw] h-[45vw] border-[1px] border-accent/30 rounded-full border-dashed opacity-50" />
        <div className="absolute w-[65vw] h-[65vw] border-[1px] border-accent/20 rounded-full border-dotted opacity-30" />
        <div className="absolute w-[85vw] h-[85vw] border-[1px] border-primary/20 rounded-full border-dashed opacity-20" />
      </motion.div>
      
      {/* Dim Overlay during Bluebee */}
      <motion.div 
        className="absolute inset-0 bg-black pointer-events-none z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 4 && phase < 13 ? 0.6 : 0 }}
        transition={{ duration: 1.5 }}
      />

      {/* Intro Text for Phase 1-3 */}
      <AnimatePresence>
        {phase >= 1 && phase < 4 && (
          <motion.div 
            className="absolute inset-0 flex flex-col items-center justify-center z-30"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40, filter: "blur(10px)" }}
            transition={{ duration: 1 }}
          >
            <h2 className="text-[4vw] font-display font-black text-center text-white max-w-[70vw] leading-tight drop-shadow-2xl">
              {phase < 2 ? "Mas existe algo ainda mais poderoso." : 
               phase < 3 ? "Você não precisa mais procurar a informação." : 
               <span className="text-transparent bg-clip-text bg-gradient-to-r from-secondary to-accent">Pode simplesmente perguntar.</span>}
            </h2>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BlueBee Identity Glow Reveal (Phase 5) */}
      <AnimatePresence>
        {phase >= 5 && phase < 6 && (
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center z-30 pointer-events-none"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.2, filter: "blur(10px)" }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          >
             <motion.div
               className="relative flex items-center justify-center"
               animate={{ 
                 y: [0, -25, 10, -15, 0],
                 x: [0, 20, -15, 12, 0]
               }}
               transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
             >
               {/* Orbiting Light Particles */}
               <motion.div
                 className="absolute z-40"
                 animate={{ rotate: 360 }}
                 transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
               >
                 <motion.div 
                   className="w-2.5 h-2.5 rounded-full bg-cyan-200 blur-[1px]"
                   initial={{ y: "-14vw" }}
                   animate={{ opacity: [0.2, 0.8, 0.2], scale: [0.8, 1.5, 0.8] }}
                   transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                 />
               </motion.div>

               <motion.div
                 className="absolute z-20"
                 animate={{ rotate: -360 }}
                 transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
               >
                 <motion.div 
                   className="w-4 h-4 rounded-full bg-cyan-400 blur-[2px]"
                   initial={{ x: "15vw" }}
                   animate={{ opacity: [0.1, 0.6, 0.1], scale: [0.6, 1.2, 0.6] }}
                   transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                 />
               </motion.div>

               <motion.div
                 className="absolute z-40"
                 animate={{ rotate: 360 }}
                 transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
               >
                 <motion.div 
                   className="w-1.5 h-1.5 rounded-full bg-white blur-[0.5px]"
                   initial={{ y: "11vw", x: "9vw" }}
                   animate={{ opacity: [0.3, 1, 0.3] }}
                   transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                 />
               </motion.div>

               {/* Breathing glow behind mascot */}
               <motion.div 
                 className="absolute w-[24vw] h-[24vw] rounded-full bg-cyan-400/30 blur-[60px]" 
                 animate={{ 
                   scale: [1, 1.2, 0.95, 1.1, 1],
                   opacity: [0.6, 0.9, 0.5, 0.8, 0.6]
                 }}
                 transition={{
                   duration: 4.5,
                   repeat: Infinity,
                   ease: "easeInOut"
                 }}
               />
               
               {/* Mascot with tilt and subtle scale */}
               <motion.div
                 animate={{ 
                   rotate: [0, 5, -3, 2, 0],
                   scale: [1, 1.04, 0.97, 1.02, 1]
                 }}
                 transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
               >
                 <motion.svg
                   viewBox="0 0 364 327"
                   className="relative w-[25vw] max-w-[360px] drop-shadow-[0_0_35px_rgba(34,211,238,0.7)]"
                   style={{
                     maskImage: 'radial-gradient(ellipse at center, black 48%, transparent 79%)',
                     WebkitMaskImage: 'radial-gradient(ellipse at center, black 48%, transparent 79%)',
                   }}
                   initial={{ opacity: 0, scale: 0.72 }}
                   animate={{ opacity: 1, scale: 1 }}
                   transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                 >
                   <defs>
                     <mask id="mascot-body-mask">
                       <rect x="0" y="0" width="364" height="327" fill="white" />
                       <polygon points="43,59 87,60 98,76 85,116 67,144 50,118 43,85" fill="black" />
                       <polygon points="229,116 253,91 303,65 333,70 341,92 327,120 293,152 251,181 222,190 210,173" fill="black" />
                       <polygon points="242,165 276,146 311,143 323,158 318,181 286,202 248,220 225,211 221,193" fill="black" />
                     </mask>
                     <clipPath id="mascot-left-wing">
                       <polygon points="43,59 87,60 98,76 85,116 67,144 50,118 43,85" />
                     </clipPath>
                     <clipPath id="mascot-right-upper-wing">
                       <polygon points="229,116 253,91 303,65 333,70 341,92 327,120 293,152 251,181 222,190 210,173" />
                     </clipPath>
                     <clipPath id="mascot-right-lower-wing">
                       <polygon points="242,165 276,146 311,143 323,158 318,181 286,202 248,220 225,211 221,193" />
                     </clipPath>
                   </defs>

                   {/* Body (Center) - Stable */}
                   <image href={mascotSrc} width="364" height="327" mask="url(#mascot-body-mask)" />

                   {/* Left Wing */}
                   <motion.g 
                     style={{ transformOrigin: '87px 96px', transformBox: 'view-box' }}
                     animate={{ 
                       scaleX: [1, 0.2, 1],
                       scaleY: [1, 1.05, 1],
                       rotate: [0, -12, 0],
                       opacity: [1, 0.8, 1]
                     }}
                     transition={{ duration: 0.16, repeat: Infinity, ease: "easeInOut" }}
                   >
                     <image href={mascotSrc} width="364" height="327" clipPath="url(#mascot-left-wing)" />
                   </motion.g>
                   
                   {/* Right Upper Wing */}
                   <motion.g 
                     style={{ transformOrigin: '218px 164px', transformBox: 'view-box' }}
                     animate={{ 
                       scaleX: [1, 0.15, 1],
                       scaleY: [1, 1.08, 1],
                       rotate: [0, 15, 0],
                       opacity: [1, 0.7, 1]
                     }}
                     transition={{ duration: 0.16, repeat: Infinity, ease: "easeInOut", delay: 0.04 }}
                   >
                     <image href={mascotSrc} width="364" height="327" clipPath="url(#mascot-right-upper-wing)" />
                   </motion.g>

                   {/* Right Lower Wing */}
                   <motion.g 
                     style={{ transformOrigin: '229px 192px', transformBox: 'view-box' }}
                     animate={{ 
                       scaleX: [1, 0.25, 1],
                       scaleY: [1, 1.05, 1],
                       rotate: [0, 8, 0],
                       opacity: [1, 0.8, 1]
                     }}
                     transition={{ duration: 0.16, repeat: Infinity, ease: "easeInOut", delay: 0.08 }}
                   >
                     <image href={mascotSrc} width="364" height="327" clipPath="url(#mascot-right-lower-wing)" />
                   </motion.g>
                 </motion.svg>
               </motion.div>
             </motion.div>

             {/* Identity Text */}
             <motion.h3
               className="mt-[6vw] text-[3vw] font-display text-white text-center drop-shadow-xl"
               initial={{ opacity: 0, y: 15 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ duration: 0.8, delay: 0.2 }}
             >
               Olá, eu sou a <span className="text-cyan-400 font-bold">BlueBee</span>,<br/>a inteligência da Beeldings.
             </motion.h3>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bluebee Chat Interface (Phase 6+) */}
      <motion.div 
        className="w-[65vw] bg-[#0f172a]/90 backdrop-blur-xl rounded-3xl border border-white/10 p-8 relative shadow-[0_0_100px_rgba(6,182,212,0.15)] z-20"
        initial={{ opacity: 0, scale: 0.85, y: 100, rotateX: -15 }}
        animate={{ 
          opacity: phase >= 13 ? 0 : (phase >= 6 ? 1 : 0), 
          scale: phase >= 13 ? 0.92 : (phase >= 6 ? (phase >= 12 ? 1.05 : 1) : 0.85), 
          y: phase >= 6 ? 0 : 100,
          rotateX: phase >= 6 ? 0 : -15,
          filter: phase >= 13 ? 'blur(18px)' : 'blur(0px)'
        }}
        transition={{ duration: phase >= 13 ? 0.9 : 1.5, ease: [0.16, 1, 0.3, 1] }}
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
          <div className="ml-4 flex items-center gap-3 text-[1.2vw] font-mono text-white/50 font-bold">
            <img
              src={mascotSrc}
              alt=""
              className="w-[3.4vw] h-[3.4vw] rounded-full object-cover object-[48%_28%] border border-cyan-300/50 shadow-[0_0_18px_rgba(34,211,238,0.45)]"
            />
            <span>BlueBee AI</span>
          </div>
        </div>
        
        <div className="space-y-4">
          <AnimatePresence>
            {phase >= 6 && phase < 11 && (
              <motion.div 
                className="bg-gradient-to-br from-primary/30 to-primary/10 p-5 rounded-2xl rounded-tr-none w-[85%] ml-auto border border-primary/30 shadow-[0_10px_30px_rgba(14,116,144,0.2)]"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, padding: 0 }}
                transition={{ duration: 0.8 }}
              >
                <p className="text-[1.3vw] text-white leading-relaxed font-light">Eu transformo a complexidade dos dados da operação em respostas simples, rápidas e relevantes.</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* User questions */}
          {questions.map((q, i) => (
            <AnimatePresence key={i}>
              {phase >= q.p && phase < 11 && (
                <motion.div 
                  className="bg-[#020617] p-4 rounded-2xl rounded-tl-none w-[80%] border border-white/10 shadow-lg"
                  initial={{ opacity: 0, x: -30, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: "auto" }}
                  exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, padding: 0 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                >
                  <p className="text-[1.3vw] text-text-secondary">{q.text}</p>
                </motion.div>
              )}
            </AnimatePresence>
          ))}

          {/* AI Final Answer */}
          <AnimatePresence>
            {phase >= 11 && (
              <motion.div 
                className="bg-gradient-to-br from-primary/30 to-primary/10 p-6 rounded-2xl rounded-tr-none w-[95%] ml-auto border border-primary/30 shadow-[0_10px_40px_rgba(14,116,144,0.3)] relative overflow-hidden mt-8"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <motion.div 
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent w-[200%]"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear', repeatDelay: 3 }}
                />
                <p className="text-[1.6vw] text-white leading-relaxed font-light">
                  {phase < 12 ? "Eu interpreto as informações disponíveis, identifico padrões e ajudo você a entender o que realmente está acontecendo." : 
                   "Você não precisa acompanhar milhares de dados. Precisa saber quais deles merecem a sua atenção."}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Final words: Pergunte, entenda, decida e aja. */}
      <AnimatePresence>
        {phase >= 13 && (
          <motion.div 
            className="absolute inset-0 flex items-center justify-center z-40"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="text-[6vw] font-display font-black text-transparent bg-clip-text bg-gradient-to-r from-secondary to-accent drop-shadow-2xl">
              Pergunte. Entenda.<br/>Decida. Aja.
            </h2>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
