import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL('https://f1-analytic.vercel.app'),
  title: {
    default: 'F1 Analytics Hub — Real-Time Telemetry & Strategy',
    template: '%s | F1 Analytics Hub',
  },
  description: 'Unleash live Formula 1 telemetry, race strategy simulations, driver rankings, and head-to-head comparisons in a high-tech dashboard interface.',
  keywords: [
    'F1',
    'Formula 1',
    'Telemetry',
    'Race Analytics',
    'Championship Standings',
    'Lap Times',
    'Live Timing',
    'F1 Strategy',
    'OpenF1',
    'Motorsport Data',
  ],
  authors: [{ name: 'mjahid', url: 'https://iammjh.github.io' }],
  creator: 'mjahid',
  publisher: 'mjahid',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  },
  alternates: {
    canonical: 'https://f1-analytic.vercel.app',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://f1-analytic.vercel.app',
    title: 'F1 Analytics Hub — Real-Time Telemetry & Strategy',
    description: 'Unleash live Formula 1 telemetry, race strategy simulations, driver rankings, and head-to-head comparisons in a high-tech dashboard interface.',
    siteName: 'F1 Analytics Hub',
    images: [
      {
        url: '/f1_home.png',
        width: 1200,
        height: 630,
        alt: 'F1 Analytics Hub Dashboard Preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'F1 Analytics Hub — Real-Time Telemetry & Strategy',
    description: 'Unleash live Formula 1 telemetry, race strategy simulations, driver rankings, and head-to-head comparisons in a high-tech dashboard interface.',
    images: ['/f1_home.png'],
    creator: '@iammjh',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#E10600',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-f1-black text-white">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
