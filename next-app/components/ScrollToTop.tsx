'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ScrollToTop() {
  const [isVisible, setIsVisible] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  const [isAtFooter, setIsAtFooter] = useState(false);
  const [activeStyle, setActiveStyle] = useState<'A' | 'C'>('A');

  // OPTION A: DRS Wing
  const [isHoveredA, setIsHoveredA] = useState(false);
  const [speedA, setSpeedA] = useState(315);
  const speedIntervalRefA = useRef<NodeJS.Timeout | null>(null);

  // OPTION C: Steering Wheel
  const [isHoveredC, setIsHoveredC] = useState(false);
  const [rpmStepC, setRpmStepC] = useState(0);
  const rpmIntervalRefC = useRef<NodeJS.Timeout | null>(null);

  // Monitor scroll depth and footer collision
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setIsVisible((prev) => {
          if (!prev) {
            // Select style randomly when button appears
            setActiveStyle(Math.random() > 0.5 ? 'A' : 'C');
          }
          return true;
        });
      } else {
        setIsVisible(false);
        setIsClicked(false);
      }

      // Check if we hit the footer area
      const threshold = 110;
      const scrolledToBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - threshold;
      setIsAtFooter(scrolledToBottom);
    };
    
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // OPTION A: Rev up speed speedometer on hover
  useEffect(() => {
    if (isHoveredA) {
      speedIntervalRefA.current = setInterval(() => {
        setSpeedA((prev) => {
          if (prev >= 358) return 358;
          return prev + Math.floor(Math.random() * 3) + 2;
        });
      }, 30);
    } else {
      if (speedIntervalRefA.current) clearInterval(speedIntervalRefA.current);
      speedIntervalRefA.current = setInterval(() => {
        setSpeedA((prev) => {
          if (prev <= 315) {
            if (speedIntervalRefA.current) clearInterval(speedIntervalRefA.current);
            return 315;
          }
          return prev - Math.floor(Math.random() * 4) - 3;
        });
      }, 30);
    }
    return () => {
      if (speedIntervalRefA.current) clearInterval(speedIntervalRefA.current);
    };
  }, [isHoveredA]);

  // OPTION C: Step shift LEDs sequentially on hover
  useEffect(() => {
    if (isHoveredC) {
      setRpmStepC(0);
      let step = 0;
      rpmIntervalRefC.current = setInterval(() => {
        step += 1;
        if (step > 9) {
          setRpmStepC(9);
        } else {
          setRpmStepC(step);
        }
      }, 90);
    } else {
      if (rpmIntervalRefC.current) clearInterval(rpmIntervalRefC.current);
      setRpmStepC(0);
    }
    return () => {
      if (rpmIntervalRefC.current) clearInterval(rpmIntervalRefC.current);
    };
  }, [isHoveredC]);

  const handleScrollToTop = () => {
    setIsClicked(true);
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
    setTimeout(() => {
      setIsClicked(false);
    }, 850);
  };

  // Flow line animation variants
  const flowLineVariants = {
    animate: (custom: number) => ({
      y: ['-100%', '200%'],
      transition: {
        duration: custom,
        repeat: Infinity,
        ease: 'linear',
      }
    })
  };

  // Steering Wheel shift light color mapper
  const getShiftLightColor = (index: number) => {
    const isActive = rpmStepC > index;
    if (rpmStepC === 9) {
      if (index >= 6) return "#0088ff";
      if (index >= 3) return "#ff0000";
      return "#00ff00";
    }
    if (!isActive) {
      if (index >= 6) return "#001133";
      if (index >= 3) return "#330000";
      return "#003300";
    }
    if (index >= 6) return "#0088ff";
    if (index >= 3) return "#ff0000";
    return "#00ff00";
  };

  return (
    <>
      {/* Fullscreen Speed Lines warp overlay on click */}
      <AnimatePresence>
        {isClicked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden bg-f1-black/10"
          >
            {/* Warp speed lines */}
            <div className="absolute inset-0 flex justify-around opacity-50">
              {[...Array(16)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ y: '-50%', height: '15vh' }}
                  animate={{ y: '100vh', height: '40vh' }}
                  transition={{
                    duration: 0.3 + Math.random() * 0.25,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                  className="w-[1px] bg-gradient-to-b from-transparent via-white to-transparent"
                  style={{
                    marginLeft: `${Math.random() * 30}px`,
                    opacity: 0.15 + Math.random() * 0.4,
                  }}
                />
              ))}
            </div>

            {/* Tactical border flash */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 border-[6px] border-f1-red/10 pointer-events-none"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic F1 Scroll to Top Button */}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 30 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className={`fixed right-4 sm:right-6 z-40 select-none transition-all duration-300 ${
              isAtFooter ? 'bottom-20 sm:bottom-24' : 'bottom-4 sm:bottom-6'
            }`}
          >
            {activeStyle === 'A' ? (
              /* ── OPTION A: DRS WING ──────────────────────────────── */
              <motion.button
                onClick={handleScrollToTop}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="flex flex-col items-center bg-[#080808]/90 hover:bg-[#0b0b0b]/95 backdrop-blur border border-f1-grid hover:border-f1-red p-1.5 rounded-xl shadow-2xl transition-colors duration-200 group overflow-hidden"
                onMouseEnter={() => setIsHoveredA(true)}
                onMouseLeave={() => setIsHoveredA(false)}
                aria-label="Scroll via DRS Wing"
              >
                {isHoveredA && (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <motion.div custom={0.4} variants={flowLineVariants} animate="animate" className="absolute left-[25%] w-[1px] h-4 bg-gradient-to-b from-transparent via-[#27F4D2]/40 to-transparent" />
                    <motion.div custom={0.6} variants={flowLineVariants} animate="animate" className="absolute left-[50%] w-[1px] h-6 bg-gradient-to-b from-transparent via-white/20 to-transparent" />
                    <motion.div custom={0.5} variants={flowLineVariants} animate="animate" className="absolute left-[75%] w-[1px] h-4 bg-gradient-to-b from-transparent via-[#27F4D2]/40 to-transparent" />
                  </div>
                )}
                <div className="relative z-10">
                  <svg width="60" height="30" viewBox="0 0 120 60" fill="none" className="drop-shadow-[0_0_4px_rgba(225,6,0,0.15)] transition-all duration-300">
                    <path d="M10 5 L22 5 L18 50 L6 50 Z" fill="#0f0f0f" stroke={isHoveredA ? "#27F4D2" : "#E10600"} strokeWidth="1.5" className="transition-colors duration-300" />
                    <path d="M110 5 L98 5 L102 50 L114 50 Z" fill="#0f0f0f" stroke={isHoveredA ? "#27F4D2" : "#E10600"} strokeWidth="1.5" className="transition-colors duration-300" />
                    <line x1="8" y1="15" x2="19" y2="15" stroke={isHoveredA ? "#27F4D2" : "#E10600"} strokeWidth="1" opacity="0.4" />
                    <line x1="7" y1="30" x2="18" y2="30" stroke={isHoveredA ? "#27F4D2" : "#E10600"} strokeWidth="1" opacity="0.4" />
                    <line x1="102" y1="15" x2="112" y2="15" stroke={isHoveredA ? "#27F4D2" : "#E10600"} strokeWidth="1" opacity="0.4" />
                    <line x1="103" y1="30" x2="113" y2="30" stroke={isHoveredA ? "#27F4D2" : "#E10600"} strokeWidth="1" opacity="0.4" />
                    <path d="M52 35 L48 50 L52 54 L68 54 L72 50 L68 35 Z" fill="#151515" stroke="#222" strokeWidth="1" />
                    <path d="M20 35 C 40 40, 80 40, 100 35 L98 40 C 80 45, 40 45, 22 40 Z" fill="#0a0a0a" stroke="#1a1a1a" strokeWidth="1.5" />
                    <motion.path
                      d="M20 15 C 40 19, 80 19, 100 15 L99 22 C 80 26, 40 26, 21 22 Z"
                      fill="#111111"
                      stroke={isHoveredA ? "#27F4D2" : "#ffffff"}
                      strokeWidth="1.5"
                      style={{ transformOrigin: '50% 15px', transformPerspective: 200 }}
                      animate={{ rotateX: isHoveredA ? -75 : 0, y: isHoveredA ? -4 : 0 }}
                      transition={{ type: 'spring', stiffness: 180, damping: 12 }}
                    />
                    <motion.line x1="60" y1="35" x2="60" animate={{ y2: isHoveredA ? 10 : 22 }} stroke={isHoveredA ? "#27F4D2" : "#E10600"} strokeWidth="2.5" transition={{ type: 'spring', stiffness: 180, damping: 12 }} />
                    <rect x="54" y="47" width="12" height="6" rx="1" fill="#080808" stroke="#1f1f1f" strokeWidth="1" />
                    <motion.circle cx="60" cy="50" r="2.5" animate={{ fill: isHoveredA ? "#27F4D2" : "#E10600", opacity: isHoveredA ? [1, 0.1, 1] : [1, 0.4, 1] }} transition={{ duration: isHoveredA ? 0.25 : 1.2, repeat: Infinity, ease: 'easeInOut' }} />
                  </svg>
                </div>

                <div className="relative z-10 mt-1 w-16 bg-[#0a0a0a]/90 border border-f1-grid rounded-lg p-1 font-mono text-center group-hover:border-f1-red/30">
                  <div className="flex justify-between items-center text-[6px] leading-none mb-0.5">
                    <span className="text-white/40 font-black">DRS</span>
                    <span className={`font-black ${isHoveredA ? 'text-[#27F4D2]' : 'text-f1-red'}`}>
                      {isHoveredA ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div className="text-[9px] font-black text-white flex justify-center items-baseline gap-0.5 leading-none">
                    <span className="text-xs font-extrabold text-white">{speedA}</span>
                    <span className="text-[5px] text-white/30 font-normal">KM/H</span>
                  </div>
                  <div className="w-full h-[1.5px] bg-f1-grid rounded-full overflow-hidden mt-1">
                    <motion.div
                      className="h-full bg-gradient-to-r"
                      style={{ backgroundImage: isHoveredA ? 'linear-gradient(to right, #E10600, #FFD700, #27F4D2)' : 'linear-gradient(to right, #E10600, #FFD700)' }}
                      animate={{ width: isHoveredA ? '100%' : '75%' }}
                      transition={{ type: 'spring', stiffness: 100, damping: 15 }}
                    />
                  </div>
                </div>
              </motion.button>
            ) : (
              /* ── OPTION C: STEERING WHEEL ────────────────────────── */
              <motion.button
                onClick={handleScrollToTop}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="flex flex-col items-center bg-[#080808]/90 hover:bg-[#0b0b0b]/95 backdrop-blur border border-f1-grid hover:border-f1-red p-1.5 rounded-xl shadow-2xl transition-colors duration-200 group overflow-hidden"
                onMouseEnter={() => setIsHoveredC(true)}
                onMouseLeave={() => setIsHoveredC(false)}
                aria-label="Scroll via Steering Wheel"
              >
                <div className="relative z-10">
                  <svg width="60" height="30" viewBox="0 0 100 50" fill="none">
                    <path
                      d="M20 10 L80 10 C85 10, 90 14, 90 20 L86 42 C84 46, 78 48, 50 48 C22 48, 16 46, 14 42 L10 20 C10 14, 15 10, 20 10 Z"
                      fill="#121212"
                      stroke="#2a2a2a"
                      strokeWidth="1.5"
                    />
                    <path d="M10 20 L13 40 C14 43, 18 45, 22 45 L20 10 C15 10, 10 14, 10 20 Z" fill="#252525" />
                    <path d="M90 20 L87 40 C86 43, 82 45, 78 45 L80 10 C85 10, 90 14, 90 20 Z" fill="#252525" />
                    <rect x="34" y="22" width="32" height="18" rx="2" fill="#041210" stroke="#222" strokeWidth="1" />
                    <text x="50" y="34" fill={isHoveredC ? "#27F4D2" : "#555"} fontSize="12" fontWeight="900" fontFamily="monospace" textAnchor="middle">
                      {isHoveredC ? '8' : 'N'}
                    </text>
                    <text x="50" y="39" fill="#fff" fontSize="5" opacity={isHoveredC ? 0.8 : 0} fontFamily="monospace" textAnchor="middle">
                      360 KM/H
                    </text>
                    {[...Array(9)].map((_, i) => {
                      const cx = 23 + i * 6.7;
                      const fill = getShiftLightColor(i);
                      return (
                        <motion.circle
                          key={i}
                          cx={cx}
                          cy="15"
                          r="1.8"
                          fill={fill}
                          animate={rpmStepC === 9 ? { opacity: [1, 0.1, 1] } : { opacity: 1 }}
                          transition={rpmStepC === 9 ? { duration: 0.12, repeat: Infinity } : {}}
                        />
                      );
                    })}
                    <circle cx="28" cy="24" r="1.5" fill="#E10600" />
                    <circle cx="28" cy="30" r="1.5" fill="#27F4D2" />
                    <circle cx="72" cy="24" r="1.5" fill="#FFD700" />
                    <circle cx="72" cy="30" r="1.5" fill="#0088ff" />
                  </svg>
                </div>

                <div className="relative z-10 mt-1 w-16 bg-[#0a0a0a]/90 border border-f1-grid rounded-lg p-1 font-mono text-center group-hover:border-f1-red/30">
                  <div className="flex justify-between items-center text-[6px] leading-none mb-0.5">
                    <span className="text-white/40 font-black">GEAR</span>
                    <span className={`font-black ${isHoveredC ? 'text-f1-accent' : 'text-f1-red'}`}>
                      {isHoveredC ? '8TH' : 'N'}
                    </span>
                  </div>
                  <div className="text-[8px] font-black text-white flex justify-center items-baseline gap-0.5 leading-none">
                    <span className="text-[10px] font-extrabold text-white">{isHoveredC ? '18' : '0'}</span>
                    <span className="text-[5px] text-white/30 font-normal">K RPM</span>
                  </div>
                  <div className="w-full h-[1.5px] bg-f1-grid rounded-full overflow-hidden mt-1">
                    <motion.div
                      className="h-full bg-gradient-to-r from-green-500 via-red-500 to-blue-500"
                      animate={{ width: isHoveredC ? '100%' : '10%' }}
                      transition={{ type: 'spring', stiffness: 100, damping: 15 }}
                    />
                  </div>
                </div>
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
