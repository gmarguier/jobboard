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

  // Type d'activité de la firm. Label court pour le badge des cartes, label long
  // pour le filtre et l'onglet Firms.
  const FIRM_TYPES = {
    mm_hft: { short: 'HFT / MM', long: 'Market maker / HFT', color: 'var(--ft-mm)' },
    prop: { short: 'Prop', long: 'Prop trading', color: 'var(--ft-prop)' },
    hf_syst: { short: 'HF systématique', long: 'Hedge fund systématique', color: 'var(--ft-syst)' },
    hf_multistrat: { short: 'HF multi-strat', long: 'Hedge fund multi-strat (pods)', color: 'var(--ft-multi)' },
    hf_disc: { short: 'HF discrétionnaire', long: 'Hedge fund discrétionnaire / macro', color: 'var(--ft-disc)' },
    am: { short: 'Asset mgmt', long: 'Asset management', color: 'var(--ft-am)' },
    crypto: { short: 'Crypto', long: 'Crypto / actifs numériques', color: 'var(--ft-crypto)' },
    autre: { short: 'Autre', long: 'Autre', color: 'var(--other)' },
  };
  const FIRM_TYPE_ORDER = ['mm_hft', 'prop', 'hf_syst', 'hf_multistrat', 'hf_disc', 'am', 'crypto', 'autre'];

  // Compatibilité d'une offre avec la disponibilité de Grégoire (sept. 2027).
  // Calculée par scripts/dates.mjs et stockée dans le champ `fit`.
  const FITS = {
    ok:        { short: 'Compatible',   long: 'Démarre après septembre 2027',            color: 'var(--accent)' },
    uncertain: { short: '2027 ?',       long: 'Bonne année, mois non précisé',           color: 'var(--fit-maybe)' },
    unknown:   { short: 'Date ?',       long: 'Aucune date de début annoncée',           color: 'var(--other)' },
    rolling:   { short: 'Au fil de l\'eau', long: 'Poste permanent, sans session datée', color: 'var(--other)' },
    too_early: { short: 'Trop tôt',     long: 'Démarre avant sa disponibilité',          color: 'var(--danger)' },
  };
  const FIT_ORDER = ['ok', 'uncertain', 'unknown', 'rolling', 'too_early'];
  const MONTH_LABELS = ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  // Priorité de tri « Pertinence » : off-cycle d'abord (seuls compatibles avec
  // une sortie d'Oxford en sept. 2027), summers en dernier.
  const TYPE_PRIORITY = { offcycle_internship: 0, internship: 1, graduate: 2, fulltime_junior: 3, summer_internship: 4 };
  const PAGE_SIZE = 40;

  const state = {
    tab: 'new',
    search: '',
    cats: new Set(Object.keys(CAT_LABELS)),
    types: new Set(TYPE_ORDER.filter(t => t !== 'summer_internship')), // summers masqués par défaut
    firmTypes: new Set(FIRM_TYPE_ORDER),
    fits: new Set(FIT_ORDER.filter(f => f !== 'too_early')), // les offres déjà passées sont masquées
    region: '',
    firm: '',
    sort: 'priority',
    favsOnly: false,
    shown: PAGE_SIZE, // rendu incrémental : nombre de cartes affichées
  };

  /** Type d'activité d'une firm, résolu depuis firms.json (rempli au chargement). */
  const firmTypeOf = new Map();

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
    state.firmTypes = new Set(savedFilters.firmTypes || [...state.firmTypes]);
    state.fits = new Set(savedFilters.fits || [...state.fits]);
    state.region = savedFilters.region || '';
    state.sort = savedFilters.sort || 'priority';
  }

  let DATA = { jobs: [], lastScanId: 'baseline', generated: null };
  let FIRMS = [];

  const $ = id => document.getElementById(id);

  function saveFilters() {
    store.set('qb-filters', { cats: [...state.cats], types: [...state.types], firmTypes: [...state.firmTypes], fits: [...state.fits], region: state.region, sort: state.sort });
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
    if (!state.firmTypes.has(firmTypeOf.get(j.firm) || 'autre')) return false;
    if (!state.fits.has(j.fit || 'unknown')) return false;
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

  /** Libellé court et lisible de la date de début, dérivé du parsing. */
  function startLabel(j) {
    const fit = FITS[j.fit] || FITS.unknown;
    if (j.fit === 'rolling' || j.fit === 'unknown') return fit.short;
    if (j.startYear && j.startMonth) return `${MONTH_LABELS[j.startMonth]} ${j.startYear}`;
    if (j.startYear) return String(j.startYear);
    return fit.short;
  }

  function jobCard(j) {
    const isFav = favs.has(j.id);
    const tags = [
      `<span class="tag" style="--tag-color:${CAT_COLORS[j.category] || 'var(--other)'}">${esc(CAT_LABELS[j.category] || j.category)}</span>`,
      `<span class="tag" style="--tag-color:${j.type === 'offcycle_internship' ? 'var(--accent)' : 'var(--other)'}">${esc(TYPE_LABELS[j.type] || j.type)}</span>`,
    ];
    const fit = FITS[j.fit] || FITS.unknown;
    tags.push(`<span class="tag" style="--tag-color:${fit.color}" title="${esc(fit.long)}">${esc(startLabel(j))}</span>`);
    // Pas de badge pour "autre" : il n'apprend rien et alourdit chaque carte.
    const ftKey = firmTypeOf.get(j.firm);
    const ft = ftKey && ftKey !== 'autre' ? FIRM_TYPES[ftKey] : null;
    return `<article class="job-card${isNew(j) ? ' is-new' : ''}" data-id="${j.id}">
      <div class="job-firm">${esc(j.firm)}${ft ? `<span class="firm-type" style="--ft-color:${ft.color}">${esc(ft.short)}</span>` : ''}${isNew(j) ? '<span class="new-flag">NOUVEAU</span>' : ''}</div>
      <div class="job-title"><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a></div>
      <div class="job-loc">📍 ${esc(locText(j))}</div>
      <div class="tag-row">${tags.join('')}</div>
      ${j.snippet ? `<div class="job-snippet">${esc(j.snippet)}</div>` : ''}
      <div class="job-actions">
        <a class="apply-btn" href="${esc(j.url)}" target="_blank" rel="noopener">Postuler ↗</a>
        <button class="card-btn" data-act="firm" title="Fiche de la firm">La firm ⓘ</button>
        <button class="card-btn fav${isFav ? ' on' : ''}" data-act="fav" title="Favori">★</button>
        <button class="card-btn" data-act="hide" title="Masquer">✕</button>
        <span class="job-date">vue le ${esc(j.firstSeen || '?')}</span>
      </div>
    </article>`;
  }


  // ---------- Fiche firm : situer une firm dans le paysage quant ----------

  const TIER_LABELS = {
    S: 'Élite mondiale', A: 'Très réputée', B: 'Solide et reconnue', C: 'Boutique / peu visible',
  };
  const SIZE_LABELS = {
    mega: 'plus de 2000 personnes', grande: '500 à 2000 personnes', moyenne: '100 à 500 personnes',
    petite: '20 à 100 personnes', boutique: 'moins de 20 personnes',
  };

  /** Barre de score 1-5 comparée à la médiane des firms du même type. */
  function scoreBar(label, value, peerMedian) {
    if (value == null) return '';
    const pct = (value / 5) * 100;
    const medPct = peerMedian != null ? (peerMedian / 5) * 100 : null;
    return `<div class="score">
      <div class="score-head"><span>${esc(label)}</span><b>${value}/5</b></div>
      <div class="score-track">
        <div class="score-fill" style="width:${pct}%"></div>
        ${medPct != null ? `<div class="score-median" style="left:${medPct}%" title="médiane des firms du même type : ${peerMedian}"></div>` : ''}
      </div>
    </div>`;
  }

  const median = arr => {
    const v = arr.filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) * 10 / 2) / 10;
  };

  function openFirmModal(firmName) {
    const f = FIRMS.find(x => x.name === firmName);
    if (!f) return;
    const body = $('firm-modal-body');
    const ft = FIRM_TYPES[f.firmType || 'autre'];
    const peers = FIRMS.filter(x => x.firmType === f.firmType && x.tier);
    const medSel = median(peers.map(x => x.selectivity));
    const medComp = median(peers.map(x => x.compensation));

    const jobs = DATA.jobs.filter(j => j.firm === firmName && !hidden.has(j.id));
    const usable = jobs.filter(j => j.fit !== 'too_early');

    // Position relative dans son domaine. Un rang chiffré serait trompeur : beaucoup
    // de firms partagent la même note, l'ordre entre elles n'aurait aucun sens.
    const sel = f.selectivity;
    const above = sel != null ? peers.filter(x => (x.selectivity || 0) > sel).length : null;
    const tied = sel != null ? peers.filter(x => x.selectivity === sel && x.name !== firmName).length : null;

    const sameTier = FIRMS.filter(x => x.tier === f.tier && x.firmType === f.firmType && x.name !== firmName)
      .slice(0, 6).map(x => x.name);

    body.innerHTML = `
      <button class="modal-close" id="modal-close" aria-label="Fermer">✕</button>
      <div class="modal-head">
        ${f.tier ? `<span class="tier-pill tier-${f.tier}">${f.tier}</span>` : ''}
        <div>
          <h2>${esc(f.name)}</h2>
          <div class="modal-sub">${ft ? `<span class="firm-type" style="--ft-color:${ft.color}">${esc(ft.short)}</span>` : ''}
            ${f.tier ? `<span class="modal-tierlabel">${esc(TIER_LABELS[f.tier] || '')}</span>` : ''}</div>
        </div>
      </div>

      ${f.positioning ? `<p class="modal-positioning">${esc(f.positioning)}</p>` : '<p class="modal-positioning modal-muted">Fiche non encore documentée pour cette firm.</p>'}

      ${(f.knownFor || []).length ? `<div class="tag-row">${f.knownFor.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>` : ''}

      <dl class="modal-facts">
        ${f.hq ? `<div><dt>Siège</dt><dd>${esc(f.hq)}</dd></div>` : ''}
        ${f.founded ? `<div><dt>Créée en</dt><dd>${esc(f.founded)}</dd></div>` : ''}
        ${f.sizeBand ? `<div><dt>Taille</dt><dd>${esc(f.headcount || SIZE_LABELS[f.sizeBand] || f.sizeBand)}</dd></div>` : ''}
        <div><dt>Offres suivies</dt><dd>${jobs.length}${jobs.length ? ` · ${usable.length} exploitable${usable.length > 1 ? 's' : ''}` : ''}</dd></div>
      </dl>

      ${(f.selectivity || f.compensation) ? `<div class="modal-scores">
        ${scoreBar('Sélectivité du recrutement', f.selectivity, medSel)}
        ${scoreBar('Rémunération junior', f.compensation, medComp)}
        <p class="modal-hint">Le repère vertical est la médiane des firms du même type. Estimations à partir de la réputation publique, pas de données officielles.</p>
      </div>` : ''}

      ${above != null ? `<p class="modal-rank">Dans son domaine (${peers.length} firms suivies), ${above === 0
        ? `<b>aucune n'est plus sélective</b>${tied ? `, ${tied} sont au même niveau` : ''}`
        : `<b>${above}</b> ${above > 1 ? 'sont plus sélectives' : 'est plus sélective'}${tied ? ` et ${tied} ${tied > 1 ? 'sont' : 'est'} au même niveau` : ''}`}.</p>` : ''}

      ${f.juniorPath ? `<div class="modal-block"><h3>Entrée junior</h3><p>${esc(f.juniorPath)}</p></div>` : ''}
      ${f.interview ? `<div class="modal-block"><h3>Processus</h3><p>${esc(f.interview)}</p></div>` : ''}
      ${sameTier.length ? `<div class="modal-block"><h3>Firms comparables</h3><p class="modal-peers">${sameTier.map(esc).join(' · ')}</p></div>` : ''}

      <div class="modal-actions">
        ${f.careersUrl || f.website ? `<a class="apply-btn" href="${esc(f.careersUrl || f.website)}" target="_blank" rel="noopener">Page carrières ↗</a>` : ''}
        <button class="card-btn" data-firm-filter="${esc(f.name)}">Voir ses ${jobs.length} offres</button>
      </div>`;

    $('firm-modal').showModal();
  }


  /** Onglet Paysage : les firms rangées par tier au sein de chaque type d'activité. */
  function renderTiers() {
    const view = $('tier-view');
    const documented = FIRMS.filter(f => f.tier);
    if (!documented.length) {
      view.innerHTML = '<div class="empty">Les fiches de firms ne sont pas encore générées.</div>';
      return;
    }
    const jobsPerFirm = new Map();
    for (const j of DATA.jobs) {
      if (hidden.has(j.id)) continue;
      const cur = jobsPerFirm.get(j.firm) || { total: 0, usable: 0 };
      cur.total++;
      if (j.fit !== 'too_early') cur.usable++;
      jobsPerFirm.set(j.firm, cur);
    }

    const groups = FIRM_TYPE_ORDER
      .map(t => ({ t, list: documented.filter(f => (f.firmType || 'autre') === t) }))
      .filter(g => g.list.length);

    view.innerHTML = `<p class="tier-intro">Où se situe chaque firm dans son domaine. Le rang mêle notoriété, sélectivité du recrutement et rémunération junior : ce sont des estimations issues de la réputation publique du secteur, pas des données officielles.</p>` +
      groups.map(g => {
        const rows = ['S', 'A', 'B', 'C'].map(tier => {
          const firms = g.list.filter(f => f.tier === tier)
            .sort((a, b) => (b.selectivity || 0) - (a.selectivity || 0) || a.name.localeCompare(b.name));
          if (!firms.length) return '';
          return `<div class="tier-row">
            <div class="tier-badge tier-${tier}">${tier}</div>
            <div class="tier-firms">${firms.map(f => {
              const c = jobsPerFirm.get(f.name);
              return `<button class="tier-chip" data-firm-open="${esc(f.name)}" title="${esc(f.positioning || f.name)}">
                ${esc(f.name)}${c ? `<span>${c.usable}</span>` : ''}
              </button>`;
            }).join('')}</div>
          </div>`;
        }).join('');
        return `<section class="tier-group" style="--ft-color:${FIRM_TYPES[g.t].color}">
          <h2>${esc(FIRM_TYPES[g.t].long)} <span>${g.list.length}</span></h2>
          ${rows}
        </section>`;
      }).join('') +
      `<p class="tier-legend"><b>S</b> élite mondiale · <b>A</b> très réputée · <b>B</b> solide et reconnue · <b>C</b> boutique ou peu visible.
       Le nombre sur chaque firm est son nombre d'offres exploitables. Touche une firm pour sa fiche.</p>`;
  }

  function render() {
    const jobList = $('job-list'), firmList = $('firm-list'), empty = $('empty');
    $('loading').hidden = true;

    const newJobs = DATA.jobs.filter(isNew);
    const visible = DATA.jobs.filter(j => !hidden.has(j.id));
    $('badge-new').textContent = newJobs.length;
    $('badge-all').textContent = visible.length;

    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
    $('filters').style.display = (state.tab === 'firms' || state.tab === 'tiers') ? 'none' : '';

    if (state.tab === 'tiers') {
      jobList.hidden = true; empty.hidden = true; firmList.hidden = true;
      $('tier-view').hidden = false;
      renderTiers();
      return;
    }
    $('tier-view').hidden = true;

    if (state.tab === 'firms') {
      jobList.hidden = true; empty.hidden = true; firmList.hidden = false;
      const withJobs = FIRMS.filter(f => f.jobCount > 0).length;
      const firmRow = f => {
        const dot = f.status === 'ok' ? 'ok' : f.status === 'no_relevant_roles' ? 'warn' : 'bad';
        const href = f.careersUrl || f.website || '#';
        return `<div class="firm-row">
          <span class="status-dot ${dot}" title="${esc(f.status)}"></span>
          <span class="firm-name"><a href="${esc(href)}" target="_blank" rel="noopener">${esc(f.name)}</a></span>
          <span class="firm-count">${f.jobCount} offre${f.jobCount > 1 ? 's' : ''}</span>
        </div>`;
      };
      // Groupé par type d'activité : plus lisible que 177 lignes à plat.
      const groups = FIRM_TYPE_ORDER
        .map(t => ({ t, list: FIRMS.filter(f => (f.firmType || 'autre') === t) }))
        .filter(g => g.list.length);
      firmList.innerHTML = `<div class="loading" style="padding:10px">${FIRMS.length} firms suivies · ${withJobs} avec offres actuellement</div>` +
        groups.map(g => {
          const n = g.list.reduce((s, f) => s + f.jobCount, 0);
          return `<div class="firm-group" style="--ft-color:${FIRM_TYPES[g.t].color}">
            <h2>${esc(FIRM_TYPES[g.t].long)} <span>${g.list.length} firm${g.list.length > 1 ? 's' : ''} · ${n} offre${n > 1 ? 's' : ''}</span></h2>
            ${g.list.map(firmRow).join('')}
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

    $('fit-chips').innerHTML = FIT_ORDER.map(f =>
      `<button class="chip${state.fits.has(f) ? ' on' : ''}" data-fit="${f}" style="--chip-color:${FITS[f].color}" title="${esc(FITS[f].long)}">${esc(FITS[f].short)}</button>`).join('');

    // Un seul type de firm présent dans les données = filtre sans intérêt.
    const presentFirmTypes = FIRM_TYPE_ORDER.filter(t => FIRMS.some(f => f.firmType === t && f.jobCount > 0));
    $('firmtype-chips').innerHTML = presentFirmTypes.length > 1
      ? presentFirmTypes.map(t =>
          `<button class="chip${state.firmTypes.has(t) ? ' on' : ''}" data-firmtype="${t}" style="--chip-color:${FIRM_TYPES[t].color}">${FIRM_TYPES[t].short}</button>`).join('')
      : '';

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
    if (state.firmTypes.size !== FIRM_TYPE_ORDER.length) n++;
    if (state.fits.size !== FIT_ORDER.length - 1 || state.fits.has('too_early')) n++;
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
    state.firmTypes = new Set(FIRM_TYPE_ORDER);
    state.fits = new Set(FIT_ORDER.filter(f => f !== 'too_early'));
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

    $('fit-chips').addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      const f = chip.dataset.fit;
      state.fits.has(f) ? state.fits.delete(f) : state.fits.add(f);
      chip.classList.toggle('on');
      saveFilters(); updateFilterCount(); resetAndRender();
    });

    $('firmtype-chips').addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      const t = chip.dataset.firmtype;
      state.firmTypes.has(t) ? state.firmTypes.delete(t) : state.firmTypes.add(t);
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
      if (btn?.dataset.act === 'firm') {
        const j = DATA.jobs.find(x => x.id === id);
        if (j) openFirmModal(j.firm);
      } else if (btn?.dataset.act === 'fav') {
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

    // Ouvre une fiche depuis l'onglet Paysage ou la liste des firms.
    for (const id of ['tier-view', 'firm-list']) {
      $(id).addEventListener('click', e => {
        const btn = e.target.closest('[data-firm-open]');
        if (btn) { e.preventDefault(); openFirmModal(btn.dataset.firmOpen); }
      });
    }

    const modal = $('firm-modal');
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('#modal-close')) { modal.close(); return; }
      const jump = e.target.closest('[data-firm-filter]');
      if (jump) {
        modal.close();
        state.firm = jump.dataset.firmFilter;
        state.tab = 'all';
        buildFilters();
        window.scrollTo({ top: 0 });
        resetAndRender();
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
      for (const f of FIRMS) firmTypeOf.set(f.name, f.firmType || 'autre');
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
