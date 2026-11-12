import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return [];

  return ['', '/components'].map((path) => ({
    url: new URL(path, siteUrl).toString(),
  }));
}
