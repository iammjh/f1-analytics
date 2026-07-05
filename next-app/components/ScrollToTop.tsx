'use client';

import { useEffect, useState } from 'react';

const SPOKE_ANGLES = [0, 72, 144, 216, 288];

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const [lit, setLit] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 420);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={scrollToTop}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
      className={[
        'fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-50 group',
        'transition-all duration-500 ease-out',
        visible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-6 pointer-events-none',
      ].join(' ')}
    >
      {/* Brake-light glow */}
      <span
        aria-hidden
        className={[
          'absolute left-1/2 top-[58%] h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-300 sm:h-[78px] sm:w-[78px]',
          lit ? 'opacity-100 scale-110' : 'opacity-60 scale-100',
        ].join(' ')}
        style={{
          background: 'radial-gradient(circle, rgba(255,0,0,0.5) 0%, rgba(225,6,0,0.2) 50%, transparent 72%)',
          boxShadow: lit
            ? '0 0 20px #ff0000, 0 0 40px rgba(225,6,0,0.55)'
            : '0 0 12px rgba(255,0,0,0.25)',
        }}
      />

      {/* Mini rear rain light / brake strip */}
      <span
        aria-hidden
        className="absolute -top-1 left-1/2 z-10 flex -translate-x-1/2 gap-[3px] rounded-md border border-white/10 bg-black/90 px-1.5 py-1 shadow-lg"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={[
              'h-[5px] w-[5px] rounded-full transition-all duration-300',
              lit || visible ? 'bg-red-600 shadow-[0_0_6px_#ff0000]' : 'bg-[#2a0505]',
            ].join(' ')}
            style={{
              animation: lit ? `f1-brake-pulse 1.2s ease-in-out ${i * 0.08}s infinite alternate` : undefined,
            }}
          />
        ))}
      </span>

      {/* F1 wheel — tyre + Pirelli sidewall + machined rim */}
      <svg
        viewBox="0 0 80 80"
        aria-hidden
        className={[
          'relative h-[68px] w-[68px] transition-transform duration-300 sm:h-[74px] sm:w-[74px]',
          'group-hover:scale-105 group-active:scale-95 drop-shadow-[0_10px_24px_rgba(0,0,0,0.65)]',
        ].join(' ')}
      >
        <defs>
          <radialGradient id="f1TyreRubber" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#1c1c1c" />
            <stop offset="55%" stopColor="#0a0a0a" />
            <stop offset="100%" stopColor="#050505" />
          </radialGradient>

          <linearGradient id="f1RimMetal" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#eceff3" />
            <stop offset="35%" stopColor="#b8bec8" />
            <stop offset="55%" stopColor="#8f98a6" />
            <stop offset="100%" stopColor="#5f6773" />
          </linearGradient>

          <linearGradient id="f1RimInner" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#dfe3ea" />
            <stop offset="100%" stopColor="#707986" />
          </linearGradient>

          <path
            id="pirelliArcTop"
            d="M 16 40 A 24 24 0 0 1 64 40"
            fill="none"
          />
          <path
            id="pirelliArcBottom"
            d="M 64 42 A 24 24 0 0 1 16 42"
            fill="none"
          />

          <clipPath id="f1RimClip">
            <circle cx="40" cy="40" r="21.5" />
          </clipPath>
        </defs>

        {/* Outer tyre */}
        <circle cx="40" cy="40" r="38" fill="url(#f1TyreRubber)" />
        <circle cx="40" cy="40" r="38" fill="none" stroke="#111" strokeWidth="0.6" />

        {/* Tread blocks */}
        {Array.from({ length: 24 }).map((_, i) => (
          <line
            key={i}
            x1={40 + 33 * Math.cos((i * 15 * Math.PI) / 180)}
            y1={40 + 33 * Math.sin((i * 15 * Math.PI) / 180)}
            x2={40 + 37 * Math.cos((i * 15 * Math.PI) / 180)}
            y2={40 + 37 * Math.sin((i * 15 * Math.PI) / 180)}
            stroke="#222"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        ))}

        {/* Sidewall band */}
        <circle cx="40" cy="40" r="29.5" fill="none" stroke="#151515" strokeWidth="7.5" />
        <circle cx="40" cy="40" r="29.5" fill="none" stroke="#262626" strokeWidth="0.5" />

        {/* Pirelli lettering on sidewall */}
        <text
          fill="#FFE033"
          fontSize="5.2"
          fontWeight="800"
          letterSpacing="0.9"
          fontFamily="Arial, Helvetica, sans-serif"
        >
          <textPath href="#pirelliArcTop" startOffset="50%" textAnchor="middle">
            PIRELLI
          </textPath>
        </text>
        <text
          fill="#FFE033"
          fontSize="4.2"
          fontWeight="800"
          letterSpacing="0.7"
          fontFamily="Arial, Helvetica, sans-serif"
          opacity="0.85"
        >
          <textPath href="#pirelliArcBottom" startOffset="50%" textAnchor="middle">
            P ZERO
          </textPath>
        </text>

        {/* Compound stripe */}
        <path
          d="M 40 12 A 28 28 0 0 1 40 68"
          fill="none"
          stroke="#FFD700"
          strokeWidth="1.4"
          strokeDasharray="2 54"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* Machined rim barrel */}
        <circle cx="40" cy="40" r="22" fill="url(#f1RimMetal)" stroke="#4a5260" strokeWidth="0.6" />

        {/* Spoke cutouts — F1-style 5-spoke machined face */}
        <g clipPath="url(#f1RimClip)">
          {SPOKE_ANGLES.map((deg) => (
            <g key={deg} transform={`rotate(${deg} 40 40)`}>
              <path
                d="M 40 40 L 34 22 Q 40 18 46 22 Z"
                fill="#090909"
                opacity="0.92"
              />
              <path
                d="M 40 40 L 33 24 L 40 20 L 47 24 Z"
                fill="none"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="0.4"
              />
            </g>
          ))}
        </g>

        {/* Rim lip + bolt detail ring */}
        <circle cx="40" cy="40" r="22" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.5" />
        <circle cx="40" cy="40" r="18.5" fill="none" stroke="#3a4048" strokeWidth="0.4" />

        {SPOKE_ANGLES.map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const bx = 40 + 19.5 * Math.cos(rad);
          const by = 40 + 19.5 * Math.sin(rad);
          return (
            <circle key={`bolt-${deg}`} cx={bx} cy={by} r="0.9" fill="#555b65" stroke="#888" strokeWidth="0.2" />
          );
        })}

        {/* Center lock / hub */}
        <circle cx="40" cy="40" r="11.5" fill="url(#f1RimInner)" stroke="#555" strokeWidth="0.5" />
        <circle cx="40" cy="40" r="8.5" fill="#101214" stroke="#666" strokeWidth="0.4" />
        <circle cx="40" cy="40" r="3.2" fill="#c8ccd2" stroke="#888" strokeWidth="0.3" />

        {/* Scroll-up chevron */}
        <path
          d="M 40 33 L 34 41 L 36.5 41 L 36.5 47 L 43.5 47 L 43.5 41 L 46 41 Z"
          fill="#fff"
          opacity="0.95"
        />
      </svg>
    </button>
  );
}
