import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard/'], // Keep dynamic API handlers and private dashboard routes private
    },
    sitemap: 'https://f1-analytic.vercel.app/sitemap.xml',
  };
}
