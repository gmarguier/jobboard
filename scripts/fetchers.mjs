// Fetchers ATS partagés par scan.mjs et tag-source.mjs.
// Chaque fetcher prend UN endpoint {ats, url, method, body} et retourne
// [{key, title, url, locations: "texte brut"}].
import { normUrl } from './lib.mjs';

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
