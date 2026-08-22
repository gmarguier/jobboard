#!/usr/bin/env node
// Applique le résultat d'une veille classifiée à data/jobs.json.
// Entrée : data/scan-apply.json = { scanId?: string, add: [job sans id/firstSeen/seenScan], removeIds: [string] }
// - add: [{firm, title, url, locations:[{city,country}], type, category, posted?, start?, snippet?}]
// - calcule les ids, regions ; archive les offres supprimées dans data/archive.json ; met à jour meta + jobCount des firms.
// Usage: node scripts/apply-scan.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = f => join(ROOT, 'data', f);
const TODAY = new Date().toISOString().slice(0, 10);

const EUROPE = new Set(['UK', 'Ireland', 'France', 'Netherlands', 'Germany', 'Switzerland', 'Spain', 'Italy', 'Sweden', 'Czechia', 'Poland', 'Austria', 'Belgium', 'Denmark', 'Norway', 'Finland', 'Portugal', 'Greece', 'Hungary', 'Romania', 'Bulgaria', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Cyprus', 'Gibraltar', 'Jersey', 'Guernsey', 'Monaco', 'Isle of Man']);
const NA = new Set(['USA', 'Canada', 'Mexico', 'Bermuda', 'Cayman Islands', 'Bahamas', 'Puerto Rico']);
const APAC = new Set(['Singapore', 'Hong Kong', 'Japan', 'China', 'India', 'Australia', 'New Zealand', 'South Korea', 'Taiwan', 'Vietnam', 'Thailand', 'Malaysia', 'Indonesia', 'Philippines']);
const CANON = { 'United Kingdom': 'UK', 'US': 'USA', 'United States': 'USA', 'Czech Republic': 'Czechia', 'Korea': 'South Korea' };
const region = c => !c ? 'Autre' : EUROPE.has(c) ? 'Europe' : NA.has(c) ? 'Amérique du Nord' : APAC.has(c) ? 'Asie-Pacifique' : 'Autre';

function normUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|gh_src|lever-|source|ref)/i.test(k)) url.searchParams.delete(k);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return (u || '').trim(); }
}
const jobId = (firm, url, title) => createHash('sha1').update(`${firm}|${normUrl(url)}|${title}`).digest('hex').slice(0, 12);

const apply = JSON.parse(readFileSync(p('scan-apply.json'), 'utf8'));
const jobsData = JSON.parse(readFileSync(p('jobs.json'), 'utf8'));
const firmsData = JSON.parse(readFileSync(p('firms.json'), 'utf8'));
const archive = existsSync(p('archive.json')) ? JSON.parse(readFileSync(p('archive.json'), 'utf8')) : { jobs: [] };

const scanId = apply.scanId || new Date().toISOString();
const existing = new Set(jobsData.jobs.map(j => j.id));

let added = 0;
for (const j of apply.add || []) {
  const locations = (j.locations || []).map(l => ({ city: l.city || null, country: CANON[l.country] || l.country || null }));
  const regions = [...new Set(locations.map(l => region(l.country)))];
  const id = jobId(j.firm, j.url, j.title);
  if (existing.has(id)) continue;
  jobsData.jobs.push({
    id, firm: j.firm, title: String(j.title).trim(), url: j.url,
    locations, regions: regions.length ? regions : ['Autre'],
    type: j.type || 'fulltime_junior', category: j.category || 'OTHER',
    posted: j.posted || null, start: j.start || null,
    snippet: (j.snippet || '').slice(0, 400),
    firstSeen: TODAY, seenScan: scanId,
  });
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

writeFileSync(p('jobs.json'), JSON.stringify(jobsData, null, 1));
writeFileSync(p('firms.json'), JSON.stringify(firmsData, null, 1));
writeFileSync(p('archive.json'), JSON.stringify(archive, null, 1));
console.log(`scanId=${scanId} · +${added} offres · -${dropped.length} archivées · total=${jobsData.jobs.length}`);
