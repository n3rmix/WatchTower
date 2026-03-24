export const UCDP_REGION_MAP = {
  '1': 'Europe',
  '2': 'Middle East',
  '3': 'Asia',
  '4': 'Africa',
  '5': 'Americas',
};

export function normalizeRegion(raw) {
  if (raw === null || raw === undefined || raw === '') return 'Unknown';
  const key = String(raw).trim();
  return UCDP_REGION_MAP[key] ?? (key || 'Unknown');
}
