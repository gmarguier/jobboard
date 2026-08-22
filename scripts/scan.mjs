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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = f => join(ROOT, 'data', f);
const MODE = process.argv.includes('--seed') ? 'seed' : process.argv.includes('--commit-seen') ? 'commit' : 'scan';
const TODAY = new Date().toISOString().slice(0, 10);

function normUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|gh_src|lever-|source|ref)/i.test(k)) url.searchParams.delete(k);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return (u || '').trim(); }
}

async function fetchJson(url, opts = {}, timeoutMs = 25000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (jobboard-scan)', Accept: 'application/json', ...(opts.headers || {}) } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      if (attempt === 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// Chaque fetcher retourne [{key, title, url, locations: "texte brut"}]
const FETCHERS = {
  async greenhouse(f) {
    const d = await fetchJson(f.apiEndpoint);
    return (d.jobs || []).map(j => ({ key: normUrl(j.absolute_url), title: j.title, url: j.absolute_url, locations: j.location?.name || (j.offices || []).map(o => o.name).join('; ') }));
  },
  async lever(f) {
    const d = await fetchJson(f.apiEndpoint);
    return (Array.isArray(d) ? d : []).map(j => ({ key: normUrl(j.hostedUrl), title: j.text, url: j.hostedUrl, locations: j.categories?.location || (j.categories?.allLocations || []).join('; ') }));
  },
  async ashby(f) {
    const d = await fetchJson(f.apiEndpoint);
    return (d.jobs || []).map(j => ({ key: normUrl(j.jobUrl || j.applyUrl), title: j.title, url: j.jobUrl || j.applyUrl, locations: [j.location, ...(j.secondaryLocations || []).map(l => l.location)].filter(Boolean).join('; ') }));
  },
  async smartrecruiters(f) {
    const out = [];
    let offset = 0;
    while (true) {
      const sep = f.apiEndpoint.includes('?') ? '&' : '?';
      const d = await fetchJson(`${f.apiEndpoint}${sep}limit=100&offset=${offset}`);
      const items = d.content || [];
      for (const j of items) {
        const company = j.company?.identifier || (f.apiEndpoint.match(/companies\/([^/]+)/) || [])[1];
        const url = `https://jobs.smartrecruiters.com/${company}/${j.id}`;
        out.push({ key: String(j.id), title: j.name, url, locations: [j.location?.city, j.location?.country].filter(Boolean).join(', ') });
      }
      offset += items.length;
      if (!items.length || offset >= (d.totalFound || 0)) break;
    }
    return out;
  },
  async recruitee(f) {
    const d = await fetchJson(f.apiEndpoint);
    return (d.offers || []).map(j => ({ key: normUrl(j.careers_url || j.url), title: j.title, url: j.careers_url || j.url, locations: [j.city, j.country].filter(Boolean).join(', ') }));
  },
  async workday(f) {
    // apiEndpoint: https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
    const m = f.apiEndpoint.match(/^(https:\/\/[^/]+)\/wday\/cxs\/[^/]+\/([^/]+)\/jobs/);
    const publicBase = m ? `${m[1]}/en-US/${m[2]}` : null;
    const out = [];
    let offset = 0;
    while (true) {
      const body = JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' });
      const d = await fetchJson(f.apiEndpoint, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      const items = d.jobPostings || [];
      for (const j of items) {
        const url = publicBase && j.externalPath ? publicBase + j.externalPath : f.careersUrl;
        out.push({ key: j.externalPath || j.title, title: j.title, url, locations: j.locationsText || '' });
      }
      offset += items.length;
      if (!items.length || offset >= (d.total || 0)) break;
    }
    return out;
  },
};

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

const apiFirms = firmsData.filter(f => f.apiEndpoint && FETCHERS[f.ats]);
const customFirms = firmsData.filter(f => !f.apiEndpoint || !FETCHERS[f.ats]).filter(f => !['careers_not_found', 'unreachable'].includes(f.status) || f.careersUrl);
console.log(`${apiFirms.length} firms avec API, ${customFirms.length} custom (à traiter par Claude)`);

const candidates = [], removed = [], fetchErrors = [];
const jobsData = existsSync(p('jobs.json')) ? JSON.parse(readFileSync(p('jobs.json'), 'utf8')) : { jobs: [] };

// Pool de 8 fetches concurrents
let idx = 0;
async function worker() {
  while (idx < apiFirms.length) {
    const f = apiFirms[idx++];
    try {
      const postings = await FETCHERS[f.ats](f);
      const current = new Map(postings.map(x => [x.key, x]));
      const known = seen[f.name] || {};
      if (MODE === 'seed') {
        seen[f.name] = Object.fromEntries(postings.map(x => [x.key, { title: x.title, firstSeen: TODAY }]));
      } else {
        for (const [key, x] of current) if (!known[key]) candidates.push({ firm: f.name, key, title: x.title, url: x.url, locations: x.locations });
        // disparitions: uniquement les offres retenues dans jobs.json
        const currentTitles = new Set(postings.map(x => x.title));
        for (const j of jobsData.jobs.filter(j => j.firm === f.name)) {
          if (!current.has(normUrl(j.url)) && !currentTitles.has(j.title)) removed.push({ firm: f.name, key: normUrl(j.url), id: j.id, title: j.title });
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
