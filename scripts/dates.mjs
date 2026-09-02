// Extraction et interprétation des dates d'une offre.
// Partagé par parse-dates.mjs (reprise de la base) et apply-scan.mjs (veille).

/** Grégoire sort d'Oxford en septembre 2027 : rien avant ne lui est accessible. */
export const AVAILABLE_FROM = { year: 2027, month: 9 };

const MONTHS = {
  jan: 1, january: 1, janvier: 1, feb: 2, february: 2, février: 2, mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avril: 4, may: 5, mai: 5, jun: 6, june: 6, juin: 6, jul: 7, july: 7, juillet: 7,
  aug: 8, august: 8, août: 8, sep: 9, sept: 9, september: 9, septembre: 9, oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11, dec: 12, december: 12, décembre: 12,
};

// Saison → mois de démarrage typique (hémisphère nord, où sont ~toutes ces firms).
const SEASONS = { winter: 1, hiver: 1, spring: 4, printemps: 4, summer: 6, été: 6, fall: 9, autumn: 9, automne: 9 };

const YEAR = '(20[2-3][0-9])';

/**
 * Amorces signalant que les années qui suivent désignent l'année de DIPLÔME.
 * On masque toute la fenêtre qui suit, et pas seulement la première année :
 * « finishing Dec 2027-Jun 2028 » contient deux années de diplôme, et laisser
 * la seconde visible ferait passer un stage d'été 2027 pour un poste de 2028.
 */
const GRAD_ANCHOR = /(?:graduat(?:ing|ion|es?\s+in|ed)|class of|degree\s+(?:in|by)|diploma\s+in|obtention|dipl[ôo]m[ée]s?\s+en|finishing|completing|final[- ]year)/gi;
const GRAD_WINDOW = 55;

/** Remplace par #### les années situées dans une fenêtre « année de diplôme ». */
function maskGradYears(text) {
  const chars = [...text];
  for (const m of text.matchAll(GRAD_ANCHOR)) {
    const from = m.index + m[0].length;
    const slice = text.slice(from, from + GRAD_WINDOW);
    for (const y of slice.matchAll(/20[2-3][0-9]/g)) {
      for (let i = 0; i < 4; i++) chars[from + y.index + i] = '#';
    }
  }
  return chars.join('');
}

/** Années de diplôme exigées, lues dans ces mêmes fenêtres. */
function gradYearsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(GRAD_ANCHOR)) {
    const slice = text.slice(m.index + m[0].length, m.index + m[0].length + GRAD_WINDOW);
    for (const y of slice.match(/20[2-3][0-9]/g) || []) {
      const n = Number(y);
      if (n >= 2024 && n <= 2032) out.add(n);
    }
  }
  return [...out].sort();
}

function pushCandidate(list, year, month) {
  if (!year) return;
  const y = Number(year);
  if (y < 2024 || y > 2032) return;
  list.push({ year: y, month: month ?? null });
}

/** Toutes les dates de début plausibles trouvées dans un texte. */
function extractStarts(text) {
  const out = [];
  if (!text) return out;

  const masked = maskGradYears(text);

  // ISO : 2027-01-11
  for (const m of masked.matchAll(/\b(20[2-3][0-9])-(\d{2})-\d{2}\b/g)) pushCandidate(out, m[1], Number(m[2]));
  // Mois AAAA  /  AAAA Mois
  for (const m of masked.matchAll(new RegExp(`\\b([A-Za-zéûôà]+)\\.?\\s+${YEAR}\\b`, 'gi'))) {
    const k = m[1].toLowerCase();
    if (MONTHS[k]) pushCandidate(out, m[2], MONTHS[k]);
    else if (SEASONS[k]) pushCandidate(out, m[2], SEASONS[k]);
  }
  for (const m of masked.matchAll(new RegExp(`\\b${YEAR}\\s+([A-Za-zéûôà]+)`, 'gi'))) {
    const k = m[2].toLowerCase();
    if (MONTHS[k]) pushCandidate(out, m[1], MONTHS[k]);
    else if (SEASONS[k]) pushCandidate(out, m[1], SEASONS[k]);
  }
  // Saison séparée de l'année par un mot : « Winter quarter 2027 », « Fall semester 2027 »
  for (const m of masked.matchAll(new RegExp(`\\b(${Object.keys(SEASONS).join('|')})\\s+\\w+\\s+${YEAR}\\b`, 'gi'))) {
    pushCandidate(out, m[2], SEASONS[m[1].toLowerCase()]);
  }
  // « January 11-14, 2027 » : jour(s) intercalés entre le mois et l'année
  for (const m of masked.matchAll(new RegExp(`\\b([A-Za-zéûôà]+)\\.?\\s+\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?,?\\s+${YEAR}\\b`, 'gi'))) {
    const k = m[1].toLowerCase();
    if (MONTHS[k]) pushCandidate(out, m[2], MONTHS[k]);
  }
  // Trimestres : H1 2027, Q3 2027
  for (const m of masked.matchAll(new RegExp(`\\bQ([1-4])\\s*${YEAR}\\b`, 'gi'))) pushCandidate(out, m[2], (Number(m[1]) - 1) * 3 + 1);
  for (const m of masked.matchAll(new RegExp(`\\bH([12])\\s*${YEAR}\\b`, 'gi'))) pushCandidate(out, m[2], m[1] === '1' ? 1 : 7);
  // Années nues restantes : début imprécis dans l'année
  for (const m of masked.matchAll(new RegExp(`\\b${YEAR}\\b`, 'g'))) pushCandidate(out, m[1], null);

  // Une année nue restée dans le texte (souvent un millésime parasite) ne doit pas
  // concurrencer une date explicite : dès qu'un mois est connu, on ignore les années seules.
  const precise = out.filter(c => c.month != null);
  const kept = precise.length ? precise : [...out];

  // Dédoublonne en gardant la version la plus précise de chaque année.
  const byYear = new Map();
  for (const c of kept) {
    const prev = byYear.get(c.year);
    if (!prev) byYear.set(c.year, c);
    else if (prev.month == null && c.month != null) byYear.set(c.year, c);
    else if (prev.month != null && c.month != null && c.month < prev.month) byYear.set(c.year, c);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year || (a.month ?? 13) - (b.month ?? 13));
}

/**
 * Détecte « juin 2027 - juin 2028 » : une plage de dates, pas deux sessions au choix.
 * Dans ce cas seule la borne de gauche est une date de début possible ; sans ça un
 * placement démarrant en juin 2027 passerait pour un poste de 2028.
 */
const RANGE_SEP = /\s*(?:-|–|—|to|until|through|jusqu'au?|à)\s*/i;
function isRange(text) {
  const re = new RegExp(
    `(?:[A-Za-zéûôà]+\\.?\\s+)?20[2-3][0-9]${RANGE_SEP.source}(?:[A-Za-zéûôà]+\\.?\\s+)?20[2-3][0-9]`, 'i');
  return re.test(text || '');
}

const atOrAfter = c =>
  c.year > AVAILABLE_FROM.year ||
  (c.year === AVAILABLE_FROM.year && c.month != null && c.month >= AVAILABLE_FROM.month);

const strictlyBefore = c =>
  c.year < AVAILABLE_FROM.year ||
  (c.year === AVAILABLE_FROM.year && c.month != null && c.month < AVAILABLE_FROM.month);

/**
 * Renvoie { startYear, startMonth, startCandidates, gradYears, fit }.
 * fit : "ok" (démarre après sa disponibilité) · "too_early" (toutes les sessions
 * sont passées pour lui) · "uncertain" (bonne année, mois inconnu) ·
 * "rolling" (poste permanent sans session datée) · "unknown" (poste daté, date illisible).
 */
export function parseDates(job) {
  const text = [job.title, job.start, job.snippet].filter(Boolean).join(' . ');
  const gradYears = gradYearsIn(text);
  // Le champ `start` a été isolé comme date de début à la collecte : s'il donne une
  // date, elle fait foi. Titre et résumé ne servent que de repli.
  let candidates = extractStarts(job.start);
  if (!candidates.length) candidates = extractStarts(text);

  // Sur une plage (« juin 2027 - juin 2028 »), seule la borne de gauche démarre le poste.
  if (candidates.length > 1 && isRange(job.start) && !/\bor\b|\bou\b|cohort|session/i.test(job.start || '')) {
    candidates = [candidates[0]];
  }

  let fit;
  if (!candidates.length) {
    fit = job.type === 'fulltime_junior' ? 'rolling' : 'unknown';
  } else if (candidates.some(atOrAfter)) {
    fit = 'ok';
  } else if (candidates.every(strictlyBefore)) {
    fit = 'too_early';
  } else {
    fit = 'uncertain'; // année de disponibilité atteinte mais mois inconnu
  }

  const best = candidates.find(atOrAfter) || candidates[0] || null;
  return {
    startYear: best?.year ?? null,
    startMonth: best?.month ?? null,
    startCandidates: candidates,
    gradYears,
    fit,
  };
}
