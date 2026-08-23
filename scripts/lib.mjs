// Logique partagée entre merge.mjs, apply-scan.mjs et scan.mjs
import { createHash } from 'node:crypto';

// Noms de pays canoniques (les agents écrivent des variantes)
export const COUNTRY_CANON = {
  'United Kingdom': 'UK', 'England': 'UK', 'Great Britain': 'UK', 'Scotland': 'UK',
  'US': 'USA', 'United States': 'USA', 'United States of America': 'USA', 'U.S.': 'USA',
  'Czech Republic': 'Czechia', 'Korea': 'South Korea', 'Republic of Korea': 'South Korea',
  'UAE': 'UAE', 'United Arab Emirates': 'UAE', 'Netherlands (the)': 'Netherlands',
  'Hong Kong SAR': 'Hong Kong', 'PRC': 'China', 'Global': 'Worldwide', 'Remote': 'Worldwide',
};

const REGIONS = {
  Europe: ['UK', 'Ireland', 'France', 'Netherlands', 'Germany', 'Switzerland', 'Spain', 'Italy', 'Sweden',
    'Czechia', 'Poland', 'Austria', 'Belgium', 'Denmark', 'Norway', 'Finland', 'Portugal', 'Greece',
    'Hungary', 'Romania', 'Bulgaria', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta',
    'Cyprus', 'Gibraltar', 'Jersey', 'Guernsey', 'Monaco', 'Isle of Man', 'Slovakia', 'Slovenia', 'Serbia', 'Ukraine'],
  'Amérique du Nord': ['USA', 'Canada', 'Mexico', 'Bermuda', 'Cayman Islands', 'Bahamas', 'Puerto Rico'],
  'Asie-Pacifique': ['Singapore', 'Hong Kong', 'Japan', 'China', 'India', 'Australia', 'New Zealand',
    'South Korea', 'Taiwan', 'Vietnam', 'Thailand', 'Malaysia', 'Indonesia', 'Philippines'],
  'Moyen-Orient': ['UAE', 'Israel', 'Saudi Arabia', 'Qatar', 'Bahrain', 'Kuwait', 'Turkey'],
  'Amérique latine': ['Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Uruguay'],
  Afrique: ['South Africa', 'Nigeria', 'Kenya', 'Egypt', 'Morocco', 'Mauritius'],
  'Remote / Monde': ['Worldwide', 'Unspecified'],
};

const COUNTRY_TO_REGION = new Map();
for (const [region, countries] of Object.entries(REGIONS)) {
  for (const c of countries) COUNTRY_TO_REGION.set(c, region);
}

export function canonCountry(c) {
  if (!c) return null;
  const t = String(c).trim();
  return COUNTRY_CANON[t] || t;
}

export function region(country) {
  return COUNTRY_TO_REGION.get(canonCountry(country)) || 'Autre';
}

/** Normalise une URL d'offre : retire les paramètres de tracking et le fragment. */
export function normUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|gh_src|lever-|source|ref)/i.test(k)) url.searchParams.delete(k);
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return (u || '').trim();
  }
}

/** Identifiant stable d'une offre. Doit rester identique entre scans. */
export function jobId(firm, url, title) {
  return createHash('sha1').update(`${firm}|${normUrl(url)}|${title}`).digest('hex').slice(0, 12);
}

/**
 * Clé de comparaison d'un titre d'offre, tolérante aux variations d'affichage :
 * les ATS alternent tirets cadratins et demi-cadratins, espaces insécables et
 * espaces terminaux d'un rendu à l'autre. Sans cette normalisation, une offre
 * toujours en ligne serait vue comme disparue et archivée à tort.
 */
export function titleKey(title) {
  return String(title || '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Nettoie et normalise la liste de localisations d'une offre. */
export function normLocations(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter(l => l && (l.city || l.country))
    .map(l => ({
      city: (l.city || '').trim() || null,
      country: canonCountry(l.country),
    }));
}

export const TYPES = new Set(['summer_internship', 'offcycle_internship', 'internship', 'graduate', 'fulltime_junior']);
export const CATEGORIES = new Set(['QR', 'QT', 'ML', 'ENG', 'OTHER']);
