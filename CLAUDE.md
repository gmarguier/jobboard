# Quant Board

Jobboard personnel de Grégoire : offres junior (stages off-cycle en priorité, graduate, full-time 0–2 ans) en Quant Research / Quant Trading / ML / Engineering chez ~171 trading firms & hedge funds. Hébergé sur GitHub Pages (`https://gmarguier.github.io/jobboard/`), consulté comme PWA sur téléphone. Contexte : sortie d'Oxford en sept 2027, cherche un off-cycle à partir d'oct 2027 — les summer internships sont hors scope (collectés mais masqués par défaut).

## Architecture

- **Front statique** : `index.html` + `app.js` + `style.css` (vanilla, pas de build). PWA via `manifest.webmanifest` + `sw.js` (network-first). UI en français, thème sombre.
- **Données** : `data/jobs.json` (offres + meta `{generated, lastScanId}`), `data/firms.json` (les 171 firms avec leur *recette de scraping* : `ats`, `apiEndpoint`, `apiMethod`, `apiBody`, `notes`), `data/seen.json` (index de TOUS les postings déjà vus, pertinents ou non — évite de re-classifier), `data/archive.json` (offres retirées).
- **Onglet « Nouvelles »** : offres dont `seenScan === lastScanId` (et `lastScanId !== 'baseline'`). Chaque scan fait avancer `lastScanId`, donc les nouveautés d'hier rejoignent le flux commun au scan suivant.
- **Types** : `offcycle_internship` · `internship` · `graduate` · `fulltime_junior` · `summer_internship` (masqué par défaut dans l'app). **Catégories** : `QR` · `QT` · `ML` · `ENG` · `OTHER`.
- **Type d'activité des firms** (`firmType`, source de vérité `data/firm-types.json`, réappliqué par `fix-endpoints.mjs`) : `mm_hft` (market maker / HFT) · `prop` (prop trading hors HFT) · `hf_syst` (hedge fund systématique) · `hf_multistrat` (plateforme à pods) · `hf_disc` (discrétionnaire / macro) · `am` (asset management institutionnel) · `crypto` · `autre`. Sert de filtre et de badge dans l'app, et regroupe l'onglet Firms.
- **Dates** : `scripts/dates.mjs` extrait de chaque offre `startYear`, `startMonth`, `gradYears` et un verdict `fit` — `ok` (démarre après sa disponibilité de sept. 2027) · `too_early` · `uncertain` (bonne année, mois inconnu) · `rolling` (poste permanent) · `unknown`. Les offres `too_early` sont masquées par défaut dans l'app. Piège central : ne pas confondre la date de DÉBUT et l'année de DIPLÔME exigée.
- **Fiches de firms** (`data/firm-profiles.json`, réappliqué par `fix-endpoints.mjs`) : `tier` (S/A/B/C), `selectivity` et `compensation` (1–5), `sizeBand`, `positioning`, `knownFor`, `juniorPath`, `interview`. Ce sont des estimations issues de la réputation publique du secteur — l'app le dit explicitement. Alimentent la modale de fiche et l'onglet Paysage.
- Les ids de jobs sont `sha1(firm|url normalisée|titre)[:12]` — calculés par les scripts, ne pas les fabriquer à la main.

## Scripts

- `node scripts/scan.mjs` — fetch déterministe de toutes les APIs ATS → `data/scan-candidates.json` (`--seed` initialise seen.json ; `--commit-seen` y intègre les candidats traités).
- `node scripts/apply-scan.mjs` — applique `data/scan-apply.json` (`{scanId, add, removeIds}`) à jobs.json/firms.json/archive.json.
- `node scripts/merge.mjs` — fusion initiale des `data/raw/batch-*.json` (one-shot, déjà fait).

## Veille quotidienne

La commande `/scan` (`.claude/commands/scan.md`) orchestre tout : scan déterministe → classification des candidats par Claude → firms custom via WebFetch → apply → commit + push. Une tâche planifiée l'exécute chaque jour ; on peut aussi la lancer à la main.

## Conventions

- Ne jamais inventer une offre ; toute offre ajoutée provient d'une page/API réellement consultée.
- Pays en noms courts (UK, USA, France, Netherlands, Singapore, Hong Kong…) ; régions calculées par les scripts.
- Commits de veille : `scan YYYY-MM-DD: +N nouvelles, -M retirées`.
