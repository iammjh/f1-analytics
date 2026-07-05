/**
 * Google Search Console expects only the token in the meta content attribute,
 * e.g. C-Hzeen43HshnvJRemjpn_xB49WaMF2TjGDc0WZMnJw
 * (not the full <meta name="google-site-verification" ... /> tag).
 */
export function getGoogleSiteVerification(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  if (!raw) return undefined;

  const contentMatch = raw.match(/content=["']([^"']+)["']/i);
  if (contentMatch?.[1]) {
    const inner = contentMatch[1].trim();
    if (!inner.includes('google-site-verification')) return inner;
  }

  const tokenMatch = raw.match(/([A-Za-z0-9_-]{20,})/);
  if (tokenMatch?.[1]) return tokenMatch[1];

  return raw.includes('<') ? undefined : raw;
}
