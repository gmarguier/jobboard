// Fetchers ATS partagés par scan.mjs et tag-source.mjs.
// Chaque fetcher prend UN endpoint {ats, url, method, body} et retourne
// [{key, title, url, locations: "texte brut"}].
import { normUrl } from './lib.mjs';

// Homoglyphes → ASCII. Lisu (U+A4D0–U+A4F4), cyrillique et grec majuscules.
const HOMOGLYPHS = {
  'ꓐ': 'B', 'ꓑ': 'P', 'ꓓ': 'D', 'ꓔ': 'T', 'ꓖ': 'G', 'ꓗ': 'K', 'ꓙ': 'J', 'ꓚ': 'C',
  'ꓝ': 'F', 'ꓟ': 'M', 'ꓠ': 'N', 'ꓡ': 'L', 'ꓢ': 'S', 'ꓣ': 'R', 'ꓤ': 'Z', 'ꓦ': 'V',
  'ꓧ': 'H', 'ꓫ': 'X', 'ꓪ': 'W', 'ꓬ': 'Y', 'ꓮ': 'A', 'ꓰ': 'E', 'ꓲ': 'I', 'ꓳ': 'O', 'ꓴ': 'U',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N',
  'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
};
const deobfuscate = s => String(s || '').replace(/[Ͱ-ϿЀ-ӿꓐ-꓿]/g, c => HOMOGLYPHS[c] ?? c);

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

// Chaque fetcher prend UN endpoint {url, method, body} et retourne
// [{key, title, url, locations: "texte brut"}]. Une firm peut avoir plusieurs boards.
export const FETCHERS = {
  async greenhouse(ep) {
    const d = await fetchJson(ep.url);
    return (d.jobs || []).map(j => ({ key: normUrl(j.absolute_url), title: j.title, url: j.absolute_url, locations: j.location?.name || (j.offices || []).map(o => o.name).join('; ') }));
  },
  async lever(ep) {
    const d = await fetchJson(ep.url);
    return (Array.isArray(d) ? d : []).map(j => ({ key: normUrl(j.hostedUrl), title: j.text, url: j.hostedUrl, locations: j.categories?.location || (j.categories?.allLocations || []).join('; ') }));
  },
  async ashby(ep) {
    const d = await fetchJson(ep.url);
    return (d.jobs || []).map(j => ({ key: normUrl(j.jobUrl || j.applyUrl), title: j.title, url: j.jobUrl || j.applyUrl, locations: [j.location, ...(j.secondaryLocations || []).map(l => l.location)].filter(Boolean).join('; ') }));
  },
  async smartrecruiters(ep) {
    const out = [];
    let offset = 0;
    while (true) {
      const sep = ep.url.includes('?') ? '&' : '?';
      const d = await fetchJson(`${ep.url}${sep}limit=100&offset=${offset}`);
      const items = d.content || [];
      for (const j of items) {
        const company = j.company?.identifier || (ep.url.match(/companies\/([^/]+)/) || [])[1];
        const url = `https://jobs.smartrecruiters.com/${company}/${j.id}`;
        out.push({ key: String(j.id), title: j.name, url, locations: [j.location?.city, j.location?.country].filter(Boolean).join(', ') });
      }
      offset += items.length;
      if (!items.length || offset >= (d.totalFound || 0)) break;
    }
    return out;
  },
  async recruitee(ep) {
    const d = await fetchJson(ep.url);
    return (d.offers || []).map(j => ({ key: normUrl(j.careers_url || j.url), title: j.title, url: j.careers_url || j.url, locations: [j.city, j.country].filter(Boolean).join(', ') }));
  },
  async workday(ep) {
    // url: https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
    const m = ep.url.match(/^(https:\/\/[^/]+)\/wday\/cxs\/[^/]+\/([^/]+)\/jobs/);
    const publicBase = m ? `${m[1]}/en-US/${m[2]}` : null;
    const out = [];
    let offset = 0;
    while (true) {
      const body = JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' });
      const d = await fetchJson(ep.url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      const items = d.jobPostings || [];
      for (const j of items) {
        const url = publicBase && j.externalPath ? publicBase + j.externalPath : null;
        out.push({ key: j.externalPath || j.title, title: j.title, url, locations: j.locationsText || '' });
      }
      offset += items.length;
      if (!items.length || offset >= (d.total || 0)) break;
    }
    return out;
  },
  async workable(ep) {
    const d = await fetchJson(ep.url);
    return (d.jobs || []).map(j => ({
      key: j.shortcode || normUrl(j.url),
      title: j.title,
      url: j.url || j.shortlink,
      locations: [j.city, j.state, j.country].filter(Boolean).join(', '),
    }));
  },
  async breezy(ep) {
    const d = await fetchJson(ep.url);
    return (Array.isArray(d) ? d : []).map(j => ({
      key: j.id || normUrl(j.url),
      title: j.name,
      url: j.url,
      locations: [j.location?.city, j.location?.country?.name].filter(Boolean).join(', '),
    }));
  },
  async pinpoint(ep) {
    const d = await fetchJson(ep.url);
    const items = d.data || (Array.isArray(d) ? d : []);
    return items.map(j => {
      const a = j.attributes || j;
      return {
        key: String(j.id ?? a.id ?? normUrl(a.url)),
        title: a.title,
        url: a.url || a.apply_url,
        locations: a.location?.name || [a.location?.city, a.location?.country].filter(Boolean).join(', '),
      };
    });
  },
  async wordpress(ep) {
    // API REST WordPress : /wp-json/wp/v2/<type>?per_page=100
    const d = await fetchJson(ep.url);
    return (Array.isArray(d) ? d : []).map(j => ({
      key: String(j.id ?? normUrl(j.link)),
      title: (j.title?.rendered || j.title || '').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&amp;/g, '&'),
      url: j.link,
      locations: '',
    }));
  },

  // --- Recettes maison : firms sans ATS tiers, dont l'endpoint JSON a été
  // --- retrouvé en observant les requêtes de leur propre page carrières.
  //
  // Jane Street remplace parfois des lettres par des homoglyphes Unicode (Lisu,
  // cyrillique, grec) pour casser les scrapers : « ꓟachine ꓡearning ꓣesearcher ».
  // On rétablit les seules correspondances visuellement certaines ; tout glyphe
  // inconnu est laissé tel quel, pour qu'une nouvelle astuce se voie au lieu
  // d'être silencieusement transformée en n'importe quoi.

  async optiver(ep) {
    // https://www.optiver.com/en/api/v1/jobs?from=N&size=16 — `size` est plafonné à 16.
    const out = [];
    let total = null;
    for (let from = 0; total === null || from < total; from += 16) {
      const sep = ep.url.includes('?') ? '&' : '?';
      const d = await fetchJson(`${ep.url}${sep}from=${from}&size=16`);
      total = d.totalCount ?? 0;
      const items = d.items || [];
      if (!items.length) break;
      for (const j of items) {
        const url = new URL(j.href, 'https://www.optiver.com').toString();
        out.push({ key: normUrl(url), title: j.title, url, locations: j.location || '' });
      }
    }
    return out;
  },

  async janestreet(ep) {
    // https://www.janestreet.com/jobs/main.json — inclut stages ET postes permanents.
    const d = await fetchJson(ep.url);
    return (Array.isArray(d) ? d : []).map(j => {
      const url = `https://www.janestreet.com/join-jane-street/position/${j.id}/`;
      return { key: normUrl(url), title: deobfuscate(j.position), url, locations: j.city || '' };
    });
  },

  async phenom(ep) {
    // Plateforme Phenom People (ex. careers.sig.com/api/jobs).
    const out = [];
    const origin = new URL(ep.url).origin;
    let total = null;
    for (let page = 1; total === null || out.length < total; page++) {
      const sep = ep.url.includes('?') ? '&' : '?';
      const d = await fetchJson(`${ep.url}${sep}page=${page}&limit=100`);
      total = d.totalCount ?? 0;
      const items = d.jobs || [];
      if (!items.length) break;
      for (const j of items) {
        const a = j.data || j;
        const id = a.req_id || a.slug;
        const url = `${origin}/jobs/${id}`;
        const locs = [a.full_location || a.location_name, ...(a.multipleLocations || [])].filter(Boolean);
        out.push({ key: normUrl(url), title: a.title, url, locations: [...new Set(locs)].join('; ') });
      }
      if (page > 50) break;
    }
    return out;
  },

  async deshaw(ep) {
    // Pas d'API : la liste complète est sérialisée dans le __NEXT_DATA__ de la page.
    const res = await fetch(ep.url, { headers: { 'User-Agent': 'Mozilla/5.0 (jobboard-scan)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = (await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('__NEXT_DATA__ introuvable');
    const props = JSON.parse(m[1])?.props?.pageProps || {};
    const out = [];
    for (const j of [...(props.regularJobs || []), ...(props.internships || [])]) {
      const a = j.data || {};
      if (!a.jobUrl || a.activeOnJobsListing === false) continue;
      const url = `https://www.deshaw.com/careers/${String(a.jobUrl).toLowerCase()}`;
      const offices = (Array.isArray(j.office) ? j.office : [j.office]).filter(Boolean)
        .map(o => (typeof o === 'string' ? o : o.name || o.abbreviation)).filter(Boolean);
      out.push({ key: normUrl(url), title: a.displayName || j.displayName, url, locations: [...new Set(offices)].join('; ') });
    }
    return out;
  },

  async icims(ep) {
    // iCIMS ne sert pas de JSON public : on lit les liens de la page de résultats.
    const res = await fetch(ep.url, { headers: { 'User-Agent': 'Mozilla/5.0 (jobboard-scan)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const origin = new URL(ep.url).origin;
    const out = new Map();
    const re = /<a[^>]+href="([^"]*\/jobs\/\d+\/[^"]*\/job[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const url = new URL(m[1].split('?')[0], origin).toString();
      const title = m[2].replace(/<[^>]+>/g, ' ').replace(/^\s*Job Title\s*/i, '').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/\s+/g, ' ').trim();
      if (title && !out.has(normUrl(url))) out.set(normUrl(url), { key: normUrl(url), title, url, locations: '' });
    }
    return [...out.values()];
  },
};

/** Interroge tous les boards d'une firm et fusionne les postings. */
export async function fetchFirm(f) {
  const endpoints = (f.apiEndpoints || []).filter(e => FETCHERS[e.ats]);
  const merged = new Map();
  for (const ep of endpoints) {
    for (const post of await FETCHERS[ep.ats](ep)) {
      if (post.key && !merged.has(post.key)) merged.set(post.key, { ...post, url: post.url || f.careersUrl });
    }
  }
  return [...merged.values()];
}
