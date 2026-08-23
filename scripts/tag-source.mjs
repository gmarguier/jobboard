#!/usr/bin/env node
// Marque chaque offre de data/jobs.json avec sa provenance : 'api' (visible dans un board
// ATS interrogeable) ou 'html' (trouvée sur une page du site, invisible pour le scan API).
//
// Pourquoi c'est nécessaire : certaines firms publient à la fois sur un board ATS et sur
// des pages maison. Sans ce marquage, le scan quotidien croirait disparues les offres HTML
// (absentes de l'API) et les archiverait à tort.
//
// Usage: node scripts/tag-source.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normUrl, titleKey } from './lib.mjs';
import { FETCHERS, fetchFirm } from './fetchers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = f => join(ROOT, 'data', f);

const firms = JSON.parse(readFileSync(p('firms.json'), 'utf8')).firms;
const jobsData = JSON.parse(readFileSync(p('jobs.json'), 'utf8'));

const hasApi = f => (f.apiEndpoints || []).some(e => FETCHERS[e.ats]);
const apiFirms = firms.filter(hasApi);
const apiFirmNames = new Set(apiFirms.map(f => f.name));

const jobsByFirm = new Map();
for (const j of jobsData.jobs) {
  if (!jobsByFirm.has(j.firm)) jobsByFirm.set(j.firm, []);
  jobsByFirm.get(j.firm).push(j);
}

let idx = 0, errors = [];
const stats = { api: 0, html: 0 };

async function worker() {
  while (idx < apiFirms.length) {
    const f = apiFirms[idx++];
    const mine = jobsByFirm.get(f.name) || [];
    if (!mine.length) continue;
    try {
      const postings = await fetchFirm(f);
      const urls = new Set(postings.map(x => normUrl(x.url)).filter(Boolean));
      const titles = new Set(postings.map(x => titleKey(x.title)));
      for (const j of mine) {
        j.source = urls.has(normUrl(j.url)) || titles.has(titleKey(j.title)) ? 'api' : 'html';
      }
      const n = mine.filter(j => j.source === 'html').length;
      if (n) console.log(`  ${f.name}: ${n}/${mine.length} offres hors API (page HTML)`);
    } catch (e) {
      errors.push({ firm: f.name, error: String(e.message || e) });
      for (const j of mine) j.source = 'api'; // recette connue, échec ponctuel
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

// Firms sans API : tout est forcément scrapé en HTML
for (const j of jobsData.jobs) {
  if (!j.source) j.source = apiFirmNames.has(j.firm) ? 'api' : 'html';
  stats[j.source]++;
}

jobsData.generated = new Date().toISOString();
writeFileSync(p('jobs.json'), JSON.stringify(jobsData, null, 1));
console.log(`\nMarquées: ${stats.api} via API · ${stats.html} via page HTML${errors.length ? ` · ${errors.length} erreurs de fetch` : ''}`);
for (const e of errors) console.log(`  ✗ ${e.firm}: ${e.error}`);
