export function normalizeWebsite(website: string): string {
  const raw = website.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}
