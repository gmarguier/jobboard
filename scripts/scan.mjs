#!/usr/bin/env node
// Veille quotidienne — partie déterministe.
// Interroge l'API ATS de chaque firm (recette dans data/firms.json), compare avec data/seen.json.
//
// Usage:
//   node scripts/scan.mjs           → écrit data/scan-candidates.json (nouveautés + disparitions + erreurs)
//   node scripts/scan.mjs --seed    → initialise data/seen.json avec TOUTES les offres actuelles (aucun candidat émis)
//   node scripts/scan.mjs --commit-seen → intègre les candidats de scan-candidates.json dans seen.json (à lancer une fois traités)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normUrl, titleKey } from './lib.mjs';
import { FETCHERS, fetchFirm } from './fetchers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = f => join(ROOT, 'data', f);
const MODE = process.argv.includes('--seed') ? 'seed' : process.argv.includes('--commit-seen') ? 'commit' : 'scan';
const TODAY = new Date().toISOString().slice(0, 10);

const firmsData = JSON.parse(readFileSync(p('firms.json'), 'utf8')).firms;
const seen = existsSync(p('seen.json')) ? JSON.parse(readFileSync(p('seen.json'), 'utf8')) : {};

if (MODE === 'commit') {
  const cand = JSON.parse(readFileSync(p('scan-candidates.json'), 'utf8'));
  for (const c of cand.candidates || []) {
    seen[c.firm] = seen[c.firm] || {};
    seen[c.firm][c.key] = { title: c.title, firstSeen: cand.scanAt?.slice(0, 10) || TODAY };
  }
  for (const r of cand.removed || []) {
    if (seen[r.firm]) delete seen[r.firm][r.key];
  }
  writeFileSync(p('seen.json'), JSON.stringify(seen, null, 1));
  console.log(`seen.json mis à jour: +${(cand.candidates || []).length} / -${(cand.removed || []).length}`);
  process.exit(0);
}

const hasApi = f => (f.apiEndpoints || []).some(e => FETCHERS[e.ats]);
const apiFirms = firmsData.filter(hasApi);
const customFirms = firmsData.filter(f => !hasApi(f)).filter(f => !['careers_not_found', 'unreachable'].includes(f.status) || f.careersUrl);
console.log(`${apiFirms.length} firms avec API, ${customFirms.length} custom (à traiter par Claude)`);

const candidates = [], removed = [], fetchErrors = [];
const jobsData = existsSync(p('jobs.json')) ? JSON.parse(readFileSync(p('jobs.json'), 'utf8')) : { jobs: [] };

// Pool de 8 fetches concurrents
let idx = 0;
async function worker() {
  while (idx < apiFirms.length) {
    const f = apiFirms[idx++];
    try {
      const postings = await fetchFirm(f);
      const current = new Map(postings.map(x => [x.key, x]));
      const known = seen[f.name] || {};
      if (MODE === 'seed') {
        seen[f.name] = Object.fromEntries(postings.map(x => [x.key, { title: x.title, firstSeen: TODAY }]));
      } else {
        for (const [key, x] of current) if (!known[key]) candidates.push({ firm: f.name, key, title: x.title, url: x.url, locations: x.locations });
        // Disparitions : seules les offres issues de l'API peuvent être jugées disparues
        // par l'API. Celles scrapées sur une page maison (source 'html') en sont
        // structurellement absentes et seraient archivées à tort.
        const currentTitles = new Set(postings.map(x => titleKey(x.title)));
        for (const j of jobsData.jobs.filter(j => j.firm === f.name && j.source !== 'html')) {
          if (!current.has(normUrl(j.url)) && !currentTitles.has(titleKey(j.title))) {
            removed.push({ firm: f.name, key: normUrl(j.url), id: j.id, title: j.title });
          }
        }
      }
      console.log(`  ✓ ${f.name} (${postings.length} postings)`);
    } catch (e) {
      fetchErrors.push({ firm: f.name, error: String(e.message || e) });
      console.log(`  ✗ ${f.name}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

if (MODE === 'seed') {
  writeFileSync(p('seen.json'), JSON.stringify(seen, null, 1));
  console.log(`seen.json initialisé pour ${Object.keys(seen).length} firms (erreurs: ${fetchErrors.length})`);
  if (fetchErrors.length) console.log(fetchErrors.map(e => ` - ${e.firm}: ${e.error}`).join('\n'));
} else {
  const out = {
    scanAt: new Date().toISOString(),
    apiFirmsChecked: apiFirms.length - fetchErrors.length,
    candidates, removed, fetchErrors,
    customFirms: customFirms.map(f => ({ name: f.name, careersUrl: f.careersUrl, ats: f.ats, status: f.status, notes: f.notes })),
  };
  writeFileSync(p('scan-candidates.json'), JSON.stringify(out, null, 1));
  console.log(`\nCandidats nouveaux: ${candidates.length} | Disparitions: ${removed.length} | Erreurs: ${fetchErrors.length}`);
  console.log('→ data/scan-candidates.json');
}
