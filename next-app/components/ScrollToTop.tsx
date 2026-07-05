'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

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
      <Image
        src="/f1-wheel-scroll.svg"
        alt=""
        width={78}
        height={78}
        aria-hidden
        className={[
          'h-[72px] w-[72px] sm:h-[78px] sm:w-[78px]',
          'transition-transform duration-200',
          'drop-shadow-[0_6px_18px_rgba(0,0,0,0.5)]',
          'group-hover:scale-[1.06] group-active:scale-95',
        ].join(' ')}
      />
    </button>
  );
}
