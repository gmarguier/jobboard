#!/usr/bin/env node
// Applique le résultat d'une veille classifiée à data/jobs.json.
// Entrée : data/scan-apply.json = { scanId?: string, add: [...], removeIds: [...] }
// - add: [{firm, title, url, locations:[{city,country}], type, category, posted?, start?, snippet?}]
// - calcule ids + régions ; archive les offres retirées ; met à jour meta et jobCount des firms.
// Usage: node scripts/apply-scan.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { region, jobId, normLocations, TYPES, CATEGORIES } from './lib.mjs';
import { parseDates } from './dates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = f => join(ROOT, 'data', f);
const TODAY = new Date().toISOString().slice(0, 10);

const apply = JSON.parse(readFileSync(p('scan-apply.json'), 'utf8'));
const jobsData = JSON.parse(readFileSync(p('jobs.json'), 'utf8'));
const firmsData = JSON.parse(readFileSync(p('firms.json'), 'utf8'));
const archive = existsSync(p('archive.json')) ? JSON.parse(readFileSync(p('archive.json'), 'utf8')) : { jobs: [] };

const scanId = apply.scanId || new Date().toISOString();
const existing = new Set(jobsData.jobs.map(j => j.id));

let added = 0;
for (const j of apply.add || []) {
  if (!j || !j.firm || !j.title || !j.url) continue;
  const id = jobId(j.firm, j.url, j.title);
  if (existing.has(id)) continue;
  const locations = normLocations(j.locations);
  const regions = [...new Set(locations.map(l => region(l.country)))];
  const job = {
    id,
    firm: j.firm,
    title: String(j.title).trim(),
    url: j.url,
    locations,
    regions: regions.length ? regions : ['Non précisé'],
    type: TYPES.has(j.type) ? j.type : 'fulltime_junior',
    category: CATEGORIES.has(j.category) ? j.category : 'OTHER',
    posted: j.posted || null,
    start: j.start || null,
    snippet: (j.snippet || '').slice(0, 400),
    source: j.source === 'html' ? 'html' : 'api',
    firstSeen: TODAY,
    seenScan: scanId,
  };
  // Date de début et compatibilité avec la disponibilité de Grégoire.
  Object.assign(job, parseDates(job));
  jobsData.jobs.push(job);
  existing.add(id);
  added++;
}

const removeSet = new Set(apply.removeIds || []);
const kept = [], dropped = [];
for (const j of jobsData.jobs) (removeSet.has(j.id) ? dropped : kept).push(j);
for (const j of dropped) archive.jobs.push({ ...j, archivedAt: TODAY });
jobsData.jobs = kept;

jobsData.lastScanId = scanId;
jobsData.generated = new Date().toISOString();

const counts = {};
for (const j of jobsData.jobs) counts[j.firm] = (counts[j.firm] || 0) + 1;
for (const f of firmsData.firms) f.jobCount = counts[f.name] || 0;

// Journal des scans : alimente la carte d'état de l'onglet « Nouvelles ».
// Borné à 60 entrées, le fichier est servi au chargement de l'app.
const logPath = p('scan-log.json');
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : { scans: [] };
log.scans.unshift({
  scanId,
  at: new Date().toISOString(),
  added,
  removed: dropped.length,
  total: jobsData.jobs.length,
});
log.scans = log.scans.slice(0, 60);
writeFileSync(logPath, JSON.stringify(log, null, 1));

writeFileSync(p('jobs.json'), JSON.stringify(jobsData, null, 1));
writeFileSync(p('firms.json'), JSON.stringify(firmsData, null, 1));
writeFileSync(p('archive.json'), JSON.stringify(archive, null, 1));
console.log(`scanId=${scanId} · +${added} offres · -${dropped.length} archivées · total=${jobsData.jobs.length}`);
