#!/usr/bin/env node
// One-shot: passe data/firms.json au modèle `apiEndpoints` (liste) et complète les boards
// ATS manquants en les déduisant des URLs d'offres réellement collectées.
// Usage: node scripts/fix-endpoints.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = f => join(ROOT, 'data', f);

const firmsData = JSON.parse(readFileSync(p('firms.json'), 'utf8'));
const jobsData = JSON.parse(readFileSync(p('jobs.json'), 'utf8'));

const jobsByFirm = new Map();
for (const j of jobsData.jobs) {
  if (!jobsByFirm.has(j.firm)) jobsByFirm.set(j.firm, []);
  jobsByFirm.get(j.firm).push(j);
}

// Reconnaît l'ATS d'un endpoint d'API déjà enregistré. Les agents de scrape ont souvent
// noté un ats générique ('other', 'custom_html') alors que l'URL identifie une plateforme
// que le scan sait interroger — sans ça la firm resterait traitée à la main chaque jour.
function atsFromApiUrl(url) {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('boards-api.greenhouse.io')) return 'greenhouse';
  if (u.includes('api.lever.co')) return 'lever';
  if (u.includes('api.ashbyhq.com')) return 'ashby';
  if (u.includes('api.smartrecruiters.com')) return 'smartrecruiters';
  if (u.includes('.recruitee.com/api')) return 'recruitee';
  if (u.includes('myworkdayjobs.com/wday')) return 'workday';
  if (u.includes('apply.workable.com/api')) return 'workable';
  if (/\.breezy\.hr\/json/.test(u)) return 'breezy';
  if (u.includes('pinpointhq.com') && u.includes('.json')) return 'pinpoint';
  if (/wp-json\/wp\/v2\//.test(u)) return 'wordpress';
  return null;
}

// Déduit l'endpoint API d'une URL d'offre publique, quand c'est possible.
function endpointFromJobUrl(url) {
  let m;
  if ((m = url.match(/(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)/))) {
    return { ats: 'greenhouse', url: `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs?content=true` };
  }
  if ((m = url.match(/jobs\.lever\.co\/([^/?#]+)/))) {
    return { ats: 'lever', url: `https://api.lever.co/v0/postings/${m[1]}?mode=json` };
  }
  if ((m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/))) {
    return { ats: 'ashby', url: `https://api.ashbyhq.com/posting-api/job-board/${m[1]}?includeCompensation=true` };
  }
  if ((m = url.match(/jobs\.smartrecruiters\.com\/([^/?#]+)/))) {
    return { ats: 'smartrecruiters', url: `https://api.smartrecruiters.com/v1/companies/${m[1]}/postings` };
  }
  if ((m = url.match(/^https:\/\/([^/]+)\/en-US\/([^/]+)\//)) && /myworkdayjobs\.com$/.test(m[1])) {
    const tenant = m[1].split('.')[0];
    return { ats: 'workday', url: `https://${m[1]}/wday/cxs/${tenant}/${m[2]}/jobs`, method: 'POST' };
  }
  return null;
}

// Endpoints supplémentaires explicitement documentés dans les notes.
const NOTE_URL = /https?:\/\/[^\s,;"')\]]+/g;
function endpointsFromNotes(notes) {
  const out = [];
  for (const raw of (notes || '').match(NOTE_URL) || []) {
    const u = raw.replace(/[.,;)]+$/, '');
    if (/\{[^}]+\}/.test(u)) continue; // gabarit, pas une URL réelle
    if (/boards-api\.greenhouse\.io\/v1\/boards\/[^/]+\/jobs/.test(u)) out.push({ ats: 'greenhouse', url: u });
    else if (/api\.lever\.co\/v0\/postings\//.test(u)) out.push({ ats: 'lever', url: u });
    else if (/api\.ashbyhq\.com\/posting-api\/job-board\//.test(u)) out.push({ ats: 'ashby', url: u });
    else if (/api\.smartrecruiters\.com\/v1\/companies\/[^/]+\/postings/.test(u)) out.push({ ats: 'smartrecruiters', url: u });
    else if (/myworkdayjobs\.com\/wday\/cxs\/[^/]+\/[^/]+\/jobs/.test(u)) out.push({ ats: 'workday', url: u, method: 'POST' });
  }
  return out;
}

let changed = 0;
for (const f of firmsData.firms) {
  const seen = new Map(); // url -> {ats, url, method}
  const add = e => {
    if (!e || !e.url) return;
    const key = e.url.replace(/\?.*$/, '');
    if (!seen.has(key)) seen.set(key, { ats: e.ats, url: e.url, method: e.method || 'GET', body: e.body || null });
  };

  if (f.apiEndpoint) add({ ats: atsFromApiUrl(f.apiEndpoint) || f.ats, url: f.apiEndpoint, method: f.apiMethod, body: f.apiBody });
  for (const e of endpointsFromNotes(f.notes)) add(e);
  for (const j of jobsByFirm.get(f.name) || []) add(endpointFromJobUrl(j.url));

  const list = [...seen.values()];
  if (list.length > 1) changed++;
  f.apiEndpoints = list;
  // champs hérités conservés pour lisibilité (le scan utilise apiEndpoints)
  f.apiEndpoint = list[0]?.url || null;
  f.apiMethod = list[0]?.method || 'GET';
  f.apiBody = list[0]?.body || null;
  if (list.length && (!f.ats || f.ats === 'none_found' || f.ats === 'custom_html' || f.ats === 'other')) {
    // si toutes les entrées pointent vers le même ATS connu, adopte-le
    const kinds = new Set(list.map(e => e.ats).filter(Boolean));
    if (kinds.size === 1) f.ats = [...kinds][0];
  }
}

// Corrections manuelles (data/overrides.json) : elles doivent survivre à chaque
// re-fusion, sinon une recette réparée à la main serait réécrasée au scrape suivant.
if (existsSync(p('overrides.json'))) {
  const ov = JSON.parse(readFileSync(p('overrides.json'), 'utf8')).firms || {};
  for (const [name, rule] of Object.entries(ov)) {
    const f = firmsData.firms.find(x => x.name === name);
    if (!f) { console.warn(`  ⚠ override ignoré, firm absente : ${name}`); continue; }
    if (rule.clearEndpoints) f.apiEndpoints = [];
    for (const e of rule.addEndpoints || []) {
      if (!f.apiEndpoints.some(x => x.url === e.url)) {
        f.apiEndpoints.push({ ats: e.ats, url: e.url, method: e.method || 'GET', body: e.body || null });
      }
    }
    Object.assign(f, rule.set || {});
    f.apiEndpoint = f.apiEndpoints[0]?.url || null;
    f.apiMethod = f.apiEndpoints[0]?.method || 'GET';
    f.apiBody = f.apiEndpoints[0]?.body || null;
    console.log(`  ✎ override appliqué : ${name}`);
  }
}

// Type d'activité de chaque firm (data/firm-types.json fait foi). Comme firms.json est
// reconstruit à chaque fusion, la classification doit être réappliquée ici.
if (existsSync(p('firm-types.json'))) {
  const types = JSON.parse(readFileSync(p('firm-types.json'), 'utf8')).types || {};
  let tagged = 0, missing = [];
  for (const f of firmsData.firms) {
    if (types[f.name]) { f.firmType = types[f.name]; tagged++; }
    else { f.firmType = 'autre'; missing.push(f.name); }
  }
  console.log(`  ⊙ types d'activité : ${tagged}/${firmsData.firms.length} firms classées`);
  if (missing.length) console.log(`     non classées → "autre" : ${missing.join(', ')}`);
}

writeFileSync(p('firms.json'), JSON.stringify(firmsData, null, 1));
const withApi = firmsData.firms.filter(f => f.apiEndpoints?.length).length;
console.log(`${firmsData.firms.length} firms · ${withApi} avec API · ${changed} avec plusieurs boards`);
for (const f of firmsData.firms.filter(x => x.apiEndpoints?.length > 1)) {
  console.log(`  ${f.name}: ${f.apiEndpoints.map(e => e.url.replace('https://boards-api.greenhouse.io/v1/boards/', 'gh:').replace('/jobs?content=true', '')).join('  +  ')}`);
}
