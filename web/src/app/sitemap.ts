import type { MetadataRoute } from 'next';

const BASE = 'https://meetingmind.org';
const PATHS = ['/', '/privacy', '/terms', '/delete-account'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({ url: `${BASE}${path}` }));
}
