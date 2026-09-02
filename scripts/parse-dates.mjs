#!/usr/bin/env node
// Extrait de chaque offre une date de début exploitable et juge sa compatibilité
// avec le calendrier de Grégoire (disponible à partir de septembre 2027).
//
// Deux dates coexistent dans les annonces et se confondent facilement :
//   - la date de DÉBUT du poste ("Summer 2027", "January 2027")
//   - l'année de DIPLÔME exigée ("for students graduating in 2028")
// Les mélanger fausse complètement le tri, d'où l'extraction séparée.
//
// Usage: node scripts/parse-dates.mjs [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVAILABLE_FROM, parseDates } from './dates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = f => join(ROOT, 'data', f);
const DRY = process.argv.includes('--dry');

const data = JSON.parse(readFileSync(p('jobs.json'), 'utf8'));
const stats = {};
for (const j of data.jobs) {
  const d = parseDates(j);
  Object.assign(j, d);
  stats[d.fit] = (stats[d.fit] || 0) + 1;
}

if (!DRY) {
  data.generated = new Date().toISOString();
  writeFileSync(p('jobs.json'), JSON.stringify(data, null, 1));
}
console.log(`Disponibilité de Grégoire : à partir de ${AVAILABLE_FROM.year}-${String(AVAILABLE_FROM.month).padStart(2, '0')}`);
console.log(`${data.jobs.length} offres :`, stats);
if (DRY) console.log('(--dry : rien écrit)');
