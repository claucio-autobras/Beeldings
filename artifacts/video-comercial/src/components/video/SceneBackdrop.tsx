import { motion } from 'framer-motion';

type SceneBackdropProps = {
  image: string;
  accent?: 'cyan' | 'red' | 'amber' | 'green' | 'blue';
  visible?: boolean;
  emphasis?: boolean;
  position?: string;
};

const accentWash = {
  cyan: 'rgba(6, 182, 212, 0.16)',
  red: 'rgba(239, 68, 68, 0.13)',
  amber: 'rgba(245, 158, 11, 0.12)',
  green: 'rgba(16, 185, 129, 0.12)',
  blue: 'rgba(37, 99, 235, 0.14)',
};

export function SceneBackdrop({
  image,
  accent = 'cyan',
  visible = true,
  emphasis = false,
  position = 'center',
}: SceneBackdropProps) {
  const imageUrl = `${import.meta.env.BASE_URL}${image.replace(/^\/+/, '')}`;
  const opacity = emphasis ? 0.86 : 0.56;

  return (
    <motion.div
      className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 1.2, ease: 'easeOut' }}
      aria-hidden="true"
    >
      <motion.div
        className="absolute -inset-[5%] bg-cover"
        style={{
          backgroundImage: `url("${imageUrl}")`,
          backgroundPosition: position,
          opacity,
          filter: emphasis
            ? 'brightness(1.08) saturate(0.82) contrast(1.08)'
            : 'brightness(1.32) saturate(0.78) contrast(1.03)',
        }}
        initial={{ scale: 1.04, x: 0 }}
        animate={{ scale: emphasis ? 1.1 : 1.07, x: emphasis ? '-1%' : '0.5%' }}
        transition={{ duration: emphasis ? 24 : 32, ease: 'easeOut' }}
      />
      <div className="absolute inset-0 bg-[rgba(2,4,10,0.30)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_18%,rgba(2,4,10,0.22)_100%)]" />
      <div
        className="absolute inset-0 mix-blend-screen"
        style={{ background: `radial-gradient(ellipse at center, ${accentWash[accent]} 0%, transparent 58%)` }}
      />
      {emphasis && (
        <motion.div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(circle at center, rgba(34,211,238,0.18), transparent 42%)' }}
          animate={{ opacity: [0.45, 0.8, 0.45] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </motion.div>
  );
}