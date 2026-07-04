/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',  // FIX: added lib/ so F1AnalyticsHub.jsx classes are scanned
  ],
  theme: {
    extend: {
      colors: {
        f1: {
          red:    '#E10600',
          black:  '#080808',
          dark:   '#0c0c0c',
          grid:   '#1a1a1a',
          accent: '#27F4D2',
          gold:   '#FFD700',
        },
        team: {
          'red-bull':     '#3671C6',
          'ferrari':      '#E8002D',
          'mercedes':     '#27F4D2',
          'mclaren':      '#FF8000',
          'aston-martin': '#229971',
          'alpine':       '#FF87BC',
          'williams':     '#64C4FF',
          'rb':           '#6692FF',
          'audi':         '#C7CDD6',
          'cadillac':     '#AAB2BD',
          'sauber':       '#52E252',
          'haas':         '#B6BABD',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-f1':  'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'race-pulse':'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up':   'fadeUp 0.5s ease-out forwards',
        'bounce-dot':'bounce 1s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'hero-gradient': 'linear-gradient(to bottom, rgba(8,8,8,0.7), rgba(8,8,8,0.55), rgba(8,8,8,1))',
      },
      boxShadow: {
        'f1-red': '0 0 20px rgba(225, 6, 0, 0.3)',
        'f1-glow': '0 0 40px rgba(225, 6, 0, 0.15)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
