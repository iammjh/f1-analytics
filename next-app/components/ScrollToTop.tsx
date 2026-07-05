'use client';

import { useEffect, useState } from 'react';

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 420);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={[
        'fixed bottom-6 right-4 sm:bottom-8 sm:right-8 z-50 group outline-none',
        'transition-all duration-500 ease-out focus-visible:ring-2 focus-visible:ring-f1-red/70 focus-visible:ring-offset-2 focus-visible:ring-offset-f1-black',
        visible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-6 pointer-events-none',
      ].join(' ')}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/f1-wheel-scroll.svg"
        alt=""
        width={88}
        height={88}
        aria-hidden
        draggable={false}
        className={[
          'h-[80px] w-[80px] sm:h-[88px] sm:w-[88px]',
          'transition-transform duration-200',
          'drop-shadow-[0_8px_22px_rgba(0,0,0,0.55)]',
          'group-hover:scale-[1.05] group-active:scale-95',
        ].join(' ')}
      />
    </button>
  );
}
