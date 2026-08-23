/* Quant Board — logique de l'app */
(() => {
  const TYPE_LABELS = {
    offcycle_internship: 'Off-cycle',
    internship: 'Stage',
    graduate: 'Graduate',
    fulltime_junior: 'Full-time',
    summer_internship: 'Summer',
  };
  const TYPE_ORDER = ['offcycle_internship', 'internship', 'graduate', 'fulltime_junior', 'summer_internship'];
  const CAT_LABELS = { QR: 'Quant Research', QT: 'Trading', ML: 'Machine Learning', ENG: 'Engineering', OTHER: 'Autre' };
  const CAT_COLORS = { QR: 'var(--qr)', QT: 'var(--qt)', ML: 'var(--ml)', ENG: 'var(--eng)', OTHER: 'var(--other)' };

  // Priorité de tri « Pertinence » : off-cycle d'abord (seuls compatibles avec
  // une sortie d'Oxford en sept. 2027), summers en dernier.
  const TYPE_PRIORITY = { offcycle_internship: 0, internship: 1, graduate: 2, fulltime_junior: 3, summer_internship: 4 };
  const PAGE_SIZE = 40;

  const state = {
    tab: 'new',
    search: '',
    cats: new Set(Object.keys(CAT_LABELS)),
    types: new Set(TYPE_ORDER.filter(t => t !== 'summer_internship')), // summers masqués par défaut
    region: '',
    firm: '',
    sort: 'priority',
    favsOnly: false,
    shown: PAGE_SIZE, // rendu incrémental : nombre de cartes affichées
  };

  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  };

  let favs = new Set(store.get('qb-favs', []));
  let hidden = new Set(store.get('qb-hidden', []));
  const savedFilters = store.get('qb-filters', null);
  if (savedFilters) {
    state.cats = new Set(savedFilters.cats || [...state.cats]);
    state.types = new Set(savedFilters.types || [...state.types]);
    state.region = savedFilters.region || '';
    state.sort = savedFilters.sort || 'priority';
  }

  let DATA = { jobs: [], lastScanId: 'baseline', generated: null };
  let FIRMS = [];

  const $ = id => document.getElementById(id);

  function saveFilters() {
    store.set('qb-filters', { cats: [...state.cats], types: [...state.types], region: state.region, sort: state.sort });
  }

  function isNew(j) {
    return DATA.lastScanId !== 'baseline' && j.seenScan === DATA.lastScanId;
  }

  function locText(j) {
    if (!j.locations || !j.locations.length) return 'Localisation non précisée';
    return j.locations.map(l => [l.city, l.country].filter(Boolean).join(', ')).join(' · ');
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function matches(j) {
    if (hidden.has(j.id)) return false;
    if (state.favsOnly && !favs.has(j.id)) return false;
    if (!state.cats.has(j.category)) return false;
    if (!state.types.has(j.type)) return false;
    if (state.region && !(j.regions || []).includes(state.region)) return false;
    if (state.firm && j.firm !== state.firm) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const hay = `${j.firm} ${j.title} ${locText(j)} ${j.snippet || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function sortJobs(arr) {
    const copy = [...arr];
    if (state.sort === 'firm') {
      copy.sort((a, b) => a.firm.localeCompare(b.firm) || a.title.localeCompare(b.title));
    } else if (state.sort === 'recent') {
      copy.sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '') || a.firm.localeCompare(b.firm));
    } else {
      copy.sort((a, b) =>
        (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9) ||
        (b.firstSeen || '').localeCompare(a.firstSeen || '') ||
        a.firm.localeCompare(b.firm));
    }
    return copy;
  }

  function jobCard(j) {
    const isFav = favs.has(j.id);
    const tags = [
      `<span class="tag" style="--tag-color:${CAT_COLORS[j.category] || 'var(--other)'}">${esc(CAT_LABELS[j.category] || j.category)}</span>`,
      `<span class="tag" style="--tag-color:${j.type === 'offcycle_internship' ? 'var(--accent)' : 'var(--other)'}">${esc(TYPE_LABELS[j.type] || j.type)}</span>`,
    ];
    if (j.start) tags.push(`<span class="tag">Début : ${esc(j.start)}</span>`);
    return `<article class="job-card${isNew(j) ? ' is-new' : ''}" data-id="${j.id}">
      <div class="job-firm">${esc(j.firm)}${isNew(j) ? '<span class="new-flag">NOUVEAU</span>' : ''}</div>
      <div class="job-title"><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a></div>
      <div class="job-loc">📍 ${esc(locText(j))}</div>
      <div class="tag-row">${tags.join('')}</div>
      ${j.snippet ? `<div class="job-snippet">${esc(j.snippet)}</div>` : ''}
      <div class="job-actions">
        <a class="apply-btn" href="${esc(j.url)}" target="_blank" rel="noopener">Postuler ↗</a>
        <button class="card-btn fav${isFav ? ' on' : ''}" data-act="fav" title="Favori">★</button>
        <button class="card-btn" data-act="hide" title="Masquer">✕</button>
        <span class="job-date">vue le ${esc(j.firstSeen || '?')}</span>
      </div>
    </article>`;
  }

  function render() {
    const jobList = $('job-list'), firmList = $('firm-list'), empty = $('empty');
    $('loading').hidden = true;

    const newJobs = DATA.jobs.filter(isNew);
    const visible = DATA.jobs.filter(j => !hidden.has(j.id));
    $('badge-new').textContent = newJobs.length;
    $('badge-all').textContent = visible.length;

    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
    $('filters').style.display = state.tab === 'firms' ? 'none' : '';

    if (state.tab === 'firms') {
      jobList.hidden = true; empty.hidden = true; firmList.hidden = false;
      const withJobs = FIRMS.filter(f => f.jobCount > 0).length;
      firmList.innerHTML = `<div class="loading" style="padding:10px">${FIRMS.length} firms suivies · ${withJobs} avec offres actuellement</div>` +
        FIRMS.map(f => {
          const dot = f.status === 'ok' ? 'ok' : f.status === 'no_relevant_roles' ? 'warn' : 'bad';
          const href = f.careersUrl || f.website || '#';
          return `<div class="firm-row">
            <span class="status-dot ${dot}" title="${esc(f.status)}"></span>
            <span class="firm-name"><a href="${esc(href)}" target="_blank" rel="noopener">${esc(f.name)}</a></span>
            <span class="firm-ats">${esc(f.ats || '?')}</span>
            <span class="firm-count">${f.jobCount} offre${f.jobCount > 1 ? 's' : ''}</span>
          </div>`;
        }).join('');
      return;
    }

    firmList.hidden = true;
    const pool = state.tab === 'new' ? newJobs : DATA.jobs;
    const shown = sortJobs(pool.filter(matches));

    if (!shown.length) {
      jobList.hidden = true;
      empty.hidden = false;
      empty.textContent = state.tab === 'new'
        ? 'Aucune nouvelle offre depuis le dernier scan. Reviens après la prochaine veille ✨'
        : 'Aucune offre ne correspond aux filtres.';
      return;
    }

    empty.hidden = true;
    jobList.hidden = false;
    // Rendu incrémental : au-delà de quelques dizaines de cartes, tout injecter
    // d'un coup rend le scroll poussif sur téléphone.
    const slice = shown.slice(0, state.shown);
    const rest = shown.length - slice.length;
    jobList.innerHTML = slice.map(jobCard).join('') +
      (rest > 0 ? `<button class="more-btn" id="more-btn">Afficher ${Math.min(rest, PAGE_SIZE)} offres de plus <span>(${rest} restantes)</span></button>` : '');

    if (rest > 0) observeSentinel();
  }

  // Charge la page suivante quand le bouton « Afficher plus » approche du viewport.
  let sentinelObserver = null;
  function observeSentinel() {
    const btn = $('more-btn');
    if (!btn) return;
    sentinelObserver?.disconnect();
    sentinelObserver = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        state.shown += PAGE_SIZE;
        render();
      }
    }, { rootMargin: '400px' });
    sentinelObserver.observe(btn);
  }

  /** Remet la pagination à zéro : tout changement de filtre repart du haut. */
  function resetAndRender() {
    state.shown = PAGE_SIZE;
    render();
  }

  function buildFilters() {
    const catChips = $('cat-chips');
    catChips.innerHTML = Object.entries(CAT_LABELS).map(([k, label]) =>
      `<button class="chip${state.cats.has(k) ? ' on' : ''}" data-cat="${k}" style="--chip-color:${CAT_COLORS[k]}">${label}</button>`).join('');
    const typeChips = $('type-chips');
    typeChips.innerHTML = TYPE_ORDER.map(t =>
      `<button class="chip${state.types.has(t) ? ' on' : ''}" data-type="${t}">${TYPE_LABELS[t]}</button>`).join('');

    const regions = [...new Set(DATA.jobs.flatMap(j => j.regions || []))].sort();
    $('region-select').innerHTML = '<option value="">Toutes régions</option>' +
      regions.map(r => `<option${r === state.region ? ' selected' : ''}>${esc(r)}</option>`).join('');

    const firmNames = [...new Set(DATA.jobs.map(j => j.firm))].sort();
    $('firm-select').innerHTML = '<option value="">Toutes les firms</option>' +
      firmNames.map(f => `<option${f === state.firm ? ' selected' : ''}>${esc(f)}</option>`).join('');

    $('sort-select').value = state.sort;
    $('fav-toggle').classList.toggle('on', state.favsOnly);
    updateFilterCount();
  }

  const DEFAULT_TYPES = TYPE_ORDER.filter(t => t !== 'summer_internship');

  /** Nombre de filtres qui s'écartent de la vue par défaut, affiché sur le bouton « Filtres ». */
  function updateFilterCount() {
    let n = 0;
    if (state.cats.size !== Object.keys(CAT_LABELS).length) n++;
    if (state.types.size !== DEFAULT_TYPES.length || DEFAULT_TYPES.some(t => !state.types.has(t))) n++;
    if (state.region) n++;
    if (state.firm) n++;
    if (state.sort !== 'priority') n++;
    const badge = $('filter-count');
    badge.hidden = n === 0;
    badge.textContent = n;
  }

  function resetFilters() {
    state.cats = new Set(Object.keys(CAT_LABELS));
    state.types = new Set(DEFAULT_TYPES);
    state.region = '';
    state.firm = '';
    state.sort = 'priority';
    state.search = '';
    $('search').value = '';
    saveFilters();
    buildFilters();
    resetAndRender();
  }

  function wireEvents() {
    $('tabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      state.tab = btn.dataset.tab;
      window.scrollTo({ top: 0 });
      resetAndRender();
    });

    $('search').addEventListener('input', e => { state.search = e.target.value.trim(); resetAndRender(); });

    $('filters-toggle').addEventListener('click', () => {
      const panel = $('filter-panel');
      const open = panel.hidden;
      panel.hidden = !open;
      $('filters-toggle').setAttribute('aria-expanded', String(open));
      store.set('qb-panel-open', open);
    });

    $('reset-filters').addEventListener('click', resetFilters);

    $('cat-chips').addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      const k = chip.dataset.cat;
      state.cats.has(k) ? state.cats.delete(k) : state.cats.add(k);
      chip.classList.toggle('on');
      saveFilters(); updateFilterCount(); resetAndRender();
    });

    $('type-chips').addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      const t = chip.dataset.type;
      state.types.has(t) ? state.types.delete(t) : state.types.add(t);
      chip.classList.toggle('on');
      saveFilters(); updateFilterCount(); resetAndRender();
    });

    $('region-select').addEventListener('change', e => { state.region = e.target.value; saveFilters(); updateFilterCount(); resetAndRender(); });
    $('firm-select').addEventListener('change', e => { state.firm = e.target.value; updateFilterCount(); resetAndRender(); });
    $('sort-select').addEventListener('change', e => { state.sort = e.target.value; saveFilters(); updateFilterCount(); resetAndRender(); });
    $('fav-toggle').addEventListener('click', () => {
      state.favsOnly = !state.favsOnly;
      $('fav-toggle').classList.toggle('on', state.favsOnly);
      resetAndRender();
    });

    $('job-list').addEventListener('click', e => {
      const btn = e.target.closest('.card-btn');
      const card = e.target.closest('.job-card');
      if (!card) return;
      const id = card.dataset.id;
      if (btn?.dataset.act === 'fav') {
        favs.has(id) ? favs.delete(id) : favs.add(id);
        store.set('qb-favs', [...favs]);
        btn.classList.toggle('on');
      } else if (btn?.dataset.act === 'hide') {
        hidden.add(id);
        store.set('qb-hidden', [...hidden]);
        render();
      } else if (!e.target.closest('a')) {
        card.classList.toggle('expanded');
      }
    });

    $('job-list').addEventListener('click', e => {
      if (e.target.closest('#more-btn')) {
        state.shown += PAGE_SIZE;
        render();
      }
    });
  }

  async function load() {
    try {
      const bust = `?t=${Date.now()}`;
      const [jobsRes, firmsRes] = await Promise.all([
        fetch(`data/jobs.json${bust}`),
        fetch(`data/firms.json${bust}`),
      ]);
      DATA = await jobsRes.json();
      FIRMS = (await firmsRes.json()).firms || [];
    } catch (e) {
      $('loading').textContent = 'Impossible de charger les données 😕 — vérifie ta connexion.';
      return;
    }

    const d = DATA.generated ? new Date(DATA.generated) : null;
    $('meta-info').innerHTML = d
      ? `${DATA.jobs.length} offres<br>maj ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
      : `${DATA.jobs.length} offres`;
    $('footer').textContent = `Quant Board · ${FIRMS.length} firms sous veille · données mises à jour via Claude Code`;

    // Si aucune nouvelle offre, ouvrir directement l'onglet "Offres"
    if (!DATA.jobs.some(isNew)) state.tab = 'all';

    buildFilters();
    wireEvents();
    if (store.get('qb-panel-open', false)) {
      $('filter-panel').hidden = false;
      $('filters-toggle').setAttribute('aria-expanded', 'true');
    }
    render();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  load();
})();
