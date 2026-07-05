'use client';

import { useEffect, useState } from 'react';

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
      {/* Brake-light glow behind the tyre */}
      <span
        aria-hidden
        className={[
          'absolute inset-0 rounded-full transition-all duration-300',
          lit ? 'opacity-100 scale-110' : 'opacity-70 scale-100',
        ].join(' ')}
        style={{
          background: 'radial-gradient(circle, rgba(255,0,0,0.55) 0%, rgba(225,6,0,0.25) 45%, transparent 70%)',
          boxShadow: lit
            ? '0 0 18px #ff0000, 0 0 36px rgba(225,6,0,0.65), 0 0 56px rgba(255,0,0,0.25)'
            : '0 0 10px rgba(255,0,0,0.35), 0 0 22px rgba(225,6,0,0.2)',
        }}
      />

      {/* F1 tyre */}
      <span
        className={[
          'relative flex h-[58px] w-[58px] sm:h-[64px] sm:w-[64px] items-center justify-center rounded-full',
          'border-[3px] border-[#1a1a1a] bg-[#0a0a0a]',
          'transition-transform duration-300 group-hover:scale-105 group-active:scale-95',
          'shadow-[inset_0_0_12px_rgba(0,0,0,0.9),0_8px_24px_rgba(0,0,0,0.55)]',
        ].join(' ')}
        style={{
          backgroundImage: [
            'repeating-conic-gradient(from 0deg, #141414 0deg 8deg, #0c0c0c 8deg 16deg)',
            'radial-gradient(circle at 50% 50%, transparent 52%, #111 53%, #222 58%, #0a0a0a 62%, transparent 63%)',
          ].join(', '),
        }}
      >
        {/* Sidewall band */}
        <span
          aria-hidden
          className="absolute inset-[7px] rounded-full border border-white/15 bg-[#111]"
          style={{
            background: 'radial-gradient(circle, #161616 35%, #0d0d0d 70%, #050505 100%)',
          }}
        />

        {/* Compound stripe + up chevron */}
        <span className="relative flex flex-col items-center gap-0.5">
          <span
            aria-hidden
            className="h-[3px] w-5 rounded-full bg-gradient-to-r from-yellow-300 via-white to-yellow-300 opacity-90"
          />
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="h-4 w-4 text-white/90 drop-shadow-[0_0_4px_rgba(255,255,255,0.35)]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </span>

        {/* Rim highlight */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: 'conic-gradient(from 210deg, transparent 0deg, rgba(255,255,255,0.08) 40deg, transparent 80deg)',
          }}
        />
      </span>

      {/* Mini brake-light strip */}
      <span
        aria-hidden
        className="absolute -top-2 left-1/2 flex -translate-x-1/2 gap-[3px] rounded-full bg-black/80 px-1.5 py-1 border border-white/10"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={[
              'h-[6px] w-[6px] rounded-full transition-all duration-300',
              lit || visible ? 'bg-red-600 shadow-[0_0_6px_#ff0000]' : 'bg-[#2a0505]',
            ].join(' ')}
            style={{
              animation: lit ? `f1-brake-pulse 1.2s ease-in-out ${i * 0.08}s infinite alternate` : undefined,
            }}
          />
        ))}
      </span>
    </button>
  );
}
