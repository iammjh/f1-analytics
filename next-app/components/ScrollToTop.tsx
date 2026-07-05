'use client';

import { useEffect, useState } from 'react';

/** Medium-compound yellow — matches Pirelli P Zero reference */
const COMPOUND = '#FFD700';
const SPOKE_COUNT = 10;

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 420);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cx = 40;
  const cy = 40;
  const outerR = 36;
  const rimR = 24;
  const hubR = 8.5;
  const sidewallR = 30.5;

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={scrollToTop}
      className={[
        'fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-50 group',
        'transition-all duration-500 ease-out',
        visible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-6 pointer-events-none',
      ].join(' ')}
    >
      <svg
        viewBox="0 0 80 80"
        aria-hidden
        className={[
          'h-[68px] w-[68px] transition-all duration-300 sm:h-[74px] sm:w-[74px]',
          'drop-shadow-[0_8px_20px_rgba(0,0,0,0.55)]',
          'group-hover:scale-105 group-hover:drop-shadow-[0_10px_28px_rgba(0,0,0,0.65)]',
          'group-active:scale-95',
        ].join(' ')}
      >
        <defs>
          <radialGradient id="f1TyreRubber" cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#181818" />
            <stop offset="100%" stopColor="#050505" />
          </radialGradient>

          <linearGradient id="f1RimSilver" x1="15%" y1="10%" x2="85%" y2="90%">
            <stop offset="0%" stopColor="#f4f6f8" />
            <stop offset="45%" stopColor="#c5ccd6" />
            <stop offset="100%" stopColor="#8b939f" />
          </linearGradient>

          <linearGradient id="f1SpokeSilver" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#aeb6c2" />
            <stop offset="50%" stopColor="#eef1f5" />
            <stop offset="100%" stopColor="#9aa3af" />
          </linearGradient>

          <path id="pirelliArcTop" d="M 18 40 A 22.5 22.5 0 0 1 62 40" fill="none" />
          <path id="pirelliArcBottom" d="M 62 40 A 22.5 22.5 0 0 1 18 40" fill="none" />
        </defs>

        {/* Outer tyre */}
        <circle cx={cx} cy={cy} r={outerR} fill="url(#f1TyreRubber)" />
        <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#0a0a0a" strokeWidth="0.5" />

        {/* Slim sidewall — black rubber inside tread */}
        <circle cx={cx} cy={cy} r={rimR + 1.5} fill="#080808" />

        {/* Compound colour ring (medium = yellow) */}
        <circle
          cx={cx}
          cy={cy}
          r={sidewallR}
          fill="none"
          stroke={COMPOUND}
          strokeWidth="4.8"
          strokeLinecap="round"
          strokeDasharray="86 18"
          transform={`rotate(-90 ${cx} ${cy})`}
        />

        {/* Sidewall branding */}
        <text
          fill={COMPOUND}
          fontSize="5.4"
          fontWeight="800"
          letterSpacing="0.85"
          fontFamily="Arial, Helvetica, sans-serif"
        >
          <textPath href="#pirelliArcTop" startOffset="50%" textAnchor="middle">
            PIRELLI
          </textPath>
        </text>
        <text
          fill={COMPOUND}
          fontSize="4.6"
          fontWeight="800"
          letterSpacing="0.65"
          fontFamily="Arial, Helvetica, sans-serif"
        >
          <textPath href="#pirelliArcBottom" startOffset="50%" textAnchor="middle">
            P ZERO
          </textPath>
        </text>

        {/* Rim barrel */}
        <circle cx={cx} cy={cy} r={rimR} fill="url(#f1RimSilver)" stroke="#6d7580" strokeWidth="0.45" />

        {/* 10 thin spokes — reference-style machined face */}
        {Array.from({ length: SPOKE_COUNT }).map((_, i) => {
          const angle = (i * 360) / SPOKE_COUNT - 90;
          const rad = (angle * Math.PI) / 180;
          const inner = hubR + 0.8;
          const outer = rimR - 1.2;
          const x1 = cx + inner * Math.cos(rad);
          const y1 = cy + inner * Math.sin(rad);
          const x2 = cx + outer * Math.cos(rad);
          const y2 = cy + outer * Math.sin(rad);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="url(#f1SpokeSilver)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          );
        })}

        {/* Rim lip */}
        <circle cx={cx} cy={cy} r={rimR} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.4" />
        <circle cx={cx} cy={cy} r={rimR - 1.5} fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="0.35" />

        {/* Centre hub / wheel nut */}
        <circle cx={cx} cy={cy} r={hubR} fill="#141618" stroke="#555b63" strokeWidth="0.45" />
        <circle cx={cx} cy={cy} r={hubR - 2} fill="#0a0b0c" stroke="#444" strokeWidth="0.3" />

        {/* Scroll-up chevron in hub */}
        <path
          d="M 40 32.5 L 35.5 39.5 L 37.5 39.5 L 37.5 44.5 L 42.5 44.5 L 42.5 39.5 L 44.5 39.5 Z"
          fill="#fff"
          opacity="0.92"
        />

        {/* Valve stem — 9 o'clock detail */}
        <rect
          x="14.5"
          y="38.6"
          width="3.2"
          height="1.4"
          rx="0.35"
          fill="#111"
          stroke="#333"
          strokeWidth="0.25"
        />
      </svg>
    </button>
  );
}
