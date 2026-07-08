import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from './providers';
import { getGoogleSiteVerification } from '@/lib/google-site-verification';
import ScrollToTop from '@/components/ScrollToTop';

const googleSiteVerification = getGoogleSiteVerification();

export const metadata: Metadata = {
  metadataBase: new URL('https://pitwall-analytics.vercel.app'),
  title: {
    default: 'Pitwall Analytics Hub — Real-Time Telemetry & Strategy',
    template: '%s | Pitwall Analytics Hub',
  },
  description: 'Unleash live Formula 1 telemetry, race strategy simulations, driver rankings, and head-to-head comparisons in a high-tech dashboard interface.',
  icons: {
    icon: '/F1-Logo.png',
    shortcut: '/F1-Logo.png',
    apple: '/F1-Logo.png',
  },
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
  verification: googleSiteVerification
    ? { google: googleSiteVerification }
    : undefined,
  alternates: {
    canonical: 'https://pitwall-analytics.vercel.app',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://pitwall-analytics.vercel.app',
    title: 'Pitwall Analytics Hub — Real-Time Telemetry & Strategy',
    description: 'Unleash live Formula 1 telemetry, race strategy simulations, driver rankings, and head-to-head comparisons in a high-tech dashboard interface.',
    siteName: 'Pitwall Analytics Hub',
    images: [
      {
        url: '/f1_home.png',
        width: 1200,
        height: 630,
        alt: 'Pitwall Analytics Hub Dashboard Preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pitwall Analytics Hub — Real-Time Telemetry & Strategy',
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" type="image/png" href="/favicon-32x32.png" sizes="32x32" />
      </head>
      <body className="bg-f1-black text-white">
        <AuthProvider>
          {children}
          <ScrollToTop />
        </AuthProvider>
      </body>
    </html>
  );
}

