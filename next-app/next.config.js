/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',

  async redirects() {
    return [
      {
        source: '/',
        destination: '/home',
        permanent: false,
      },
    ];
  },

  // BUG FIX: `swcMinify` was removed in Next.js 14 — it's on by default and
  // the option throws a warning. Removed.

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    // Allow local public/ images (hero-f1-car.jpg etc.)
    // No extra config needed — Next.js serves public/ automatically.
  },

  experimental: {
    // This Next.js version still expects the Prisma package allowlist under
    // `experimental.serverComponentsExternalPackages`.
    serverComponentsExternalPackages: ['prisma', '@prisma/client'],
  },
};

module.exports = nextConfig;
