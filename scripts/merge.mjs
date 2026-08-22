#!/usr/bin/env node
// Merge data/raw/batch-*.json (initial scrape output) into data/jobs.json + data/firms.json
// Usage: node scripts/merge.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');

const EUROPE = new Set(['UK', 'United Kingdom', 'Ireland', 'France', 'Netherlands', 'Germany', 'Switzerland', 'Spain', 'Italy', 'Sweden', 'Czechia', 'Czech Republic', 'Poland', 'Austria', 'Belgium', 'Denmark', 'Norway', 'Finland', 'Portugal', 'Greece', 'Hungary', 'Romania', 'Bulgaria', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Cyprus', 'Gibraltar', 'Jersey', 'Guernsey', 'Monaco', 'Isle of Man']);
const NORTH_AMERICA = new Set(['USA', 'US', 'United States', 'Canada', 'Mexico', 'Bermuda', 'Cayman Islands', 'Bahamas', 'Puerto Rico']);
const APAC = new Set(['Singapore', 'Hong Kong', 'Japan', 'China', 'India', 'Australia', 'New Zealand', 'South Korea', 'Korea', 'Taiwan', 'Vietnam', 'Thailand', 'Malaysia', 'Indonesia', 'Philippines']);

const COUNTRY_CANON = { 'United Kingdom': 'UK', 'US': 'USA', 'United States': 'USA', 'Czech Republic': 'Czechia', 'Korea': 'South Korea' };

const TYPES = new Set(['summer_internship', 'offcycle_internship', 'internship', 'graduate', 'fulltime_junior']);
const CATS = new Set(['QR', 'QT', 'ML', 'ENG', 'OTHER']);

function region(country) {
  if (!country) return 'Autre';
  if (EUROPE.has(country)) return 'Europe';
  if (NORTH_AMERICA.has(country)) return 'Amérique du Nord';
  if (APAC.has(country)) return 'Asie-Pacifique';
  return 'Autre';
}

function normUrl(u) {
  try {
    const url = new URL(u);
    // strip tracking params so the id stays stable
    for (const p of [...url.searchParams.keys()]) {
      if (/^(utm_|gh_src|lever-|source|ref)/i.test(p)) url.searchParams.delete(p);
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return (u || '').trim(); }
}

function jobId(firm, url, title) {
  return createHash('sha1').update(`${firm}|${normUrl(url)}|${title}`).digest('hex').slice(0, 12);
}

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
    const fJobs = Array.isArray(fm.jobs) ? fm.jobs : [];
    firms.push({
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
    });
    const rec = firms[firms.length - 1];
    for (const j of fJobs) {
      if (!j || !j.title || !j.url) { problems.push(`${fm.firm}: job sans titre/url ignoré`); continue; }
      const locations = (Array.isArray(j.locations) ? j.locations : [])
        .filter(l => l && (l.city || l.country))
        .map(l => {
          const country = COUNTRY_CANON[l.country] || l.country || null;
          return { city: (l.city || '').trim() || null, country };
        });
      const regions = [...new Set(locations.map(l => region(l.country)))];
      const id = jobId(fm.firm, j.url, j.title);
      if (jobs.has(id)) continue; // duplicate posting
      jobs.set(id, {
        id,
        firm: fm.firm,
        title: String(j.title).trim(),
        url: j.url,
        locations,
        regions: regions.length ? regions : ['Autre'],
        type: TYPES.has(j.type) ? j.type : 'fulltime_junior',
        category: CATS.has(j.category) ? j.category : 'OTHER',
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

// Deduplicate firms (keep the record with the most jobs / best status)
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
