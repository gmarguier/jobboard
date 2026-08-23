#!/usr/bin/env node
// Fusionne data/raw/batch-*.json (scrape initial) en data/jobs.json + data/firms.json
// Usage: node scripts/merge.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { region, normUrl, jobId, normLocations, TYPES, CATEGORIES } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const TODAY = new Date().toISOString().slice(0, 10);

const files = readdirSync(RAW).filter(f => /^batch-.*\.json$/.test(f)).sort();
const firms = [];
const jobs = new Map();
const problems = [];

for (const f of files) {
  let arr;
  try {
    arr = JSON.parse(readFileSync(join(RAW, f), 'utf8'));
  } catch (e) {
    problems.push(`${f}: JSON invalide — ${e.message}`);
    continue;
  }
  if (!Array.isArray(arr)) { problems.push(`${f}: pas un tableau`); continue; }

  for (const fm of arr) {
    if (!fm || !fm.firm) { problems.push(`${f}: entrée sans nom de firm`); continue; }
    const rec = {
      name: fm.firm,
      website: fm.website || null,
      careersUrl: fm.careersUrl || null,
      ats: fm.ats || 'none_found',
      apiEndpoint: fm.apiEndpoint || null,
      apiMethod: fm.apiMethod || 'GET',
      apiBody: fm.apiBody || null,
      status: fm.status || 'ok',
      notes: fm.notes || '',
      jobCount: 0,
    };
    firms.push(rec);

    for (const j of (Array.isArray(fm.jobs) ? fm.jobs : [])) {
      if (!j || !j.title || !j.url) { problems.push(`${fm.firm}: offre sans titre/url ignorée`); continue; }
      const id = jobId(fm.firm, j.url, j.title);
      if (jobs.has(id)) continue; // doublon exact
      const locations = normLocations(j.locations);
      const regions = [...new Set(locations.map(l => region(l.country)))];
      jobs.set(id, {
        id,
        firm: fm.firm,
        title: String(j.title).trim(),
        url: j.url,
        locations,
        regions: regions.length ? regions : ['Non précisé'],
        type: TYPES.has(j.type) ? j.type : 'fulltime_junior',
        category: CATEGORIES.has(j.category) ? j.category : 'OTHER',
        posted: j.posted || null,
        start: j.start || null,
        snippet: (j.snippet || '').slice(0, 400),
        firstSeen: TODAY,
        seenScan: 'baseline',
      });
      rec.jobCount++;
    }
  }
}

// Dédoublonnage des firms (garde l'entrée la plus riche)
const byName = new Map();
for (const fm of firms) {
  const prev = byName.get(fm.name);
  if (!prev || fm.jobCount > prev.jobCount || (prev.status !== 'ok' && fm.status === 'ok')) byName.set(fm.name, fm);
}

const jobList = [...jobs.values()].sort((a, b) => a.firm.localeCompare(b.firm) || a.title.localeCompare(b.title));
const firmList = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(join(ROOT, 'data', 'jobs.json'), JSON.stringify({
  generated: new Date().toISOString(),
  lastScanId: 'baseline',
  jobs: jobList,
}, null, 1));
writeFileSync(join(ROOT, 'data', 'firms.json'), JSON.stringify({ firms: firmList }, null, 1));

const stats = {};
for (const j of jobList) stats[j.type] = (stats[j.type] || 0) + 1;
console.log(`Firms: ${firmList.length} (${firmList.filter(f => f.status === 'ok').length} ok, ${firmList.filter(f => f.apiEndpoint).length} avec API)`);
console.log(`Jobs: ${jobList.length}`, stats);
if (problems.length) console.log(`\nProblèmes (${problems.length}):\n- ` + problems.slice(0, 30).join('\n- '));
