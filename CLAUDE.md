# Quant Board

Jobboard personnel de Grégoire : offres junior (stages off-cycle en priorité, graduate, full-time 0–2 ans) en Quant Research / Quant Trading / ML / Engineering chez ~171 trading firms & hedge funds. Hébergé sur GitHub Pages (`https://gmarguier.github.io/jobboard/`), consulté comme PWA sur téléphone. Contexte : sortie d'Oxford en sept 2027, cherche un off-cycle à partir d'oct 2027 — les summer internships sont hors scope (collectés mais masqués par défaut).

## Architecture

- **Front statique** : `index.html` + `app.js` + `style.css` (vanilla, pas de build). PWA via `manifest.webmanifest` + `sw.js` (network-first). UI en français, thème sombre.
- **Données** : `data/jobs.json` (offres + meta `{generated, lastScanId}`), `data/firms.json` (les 171 firms avec leur *recette de scraping* : `ats`, `apiEndpoint`, `apiMethod`, `apiBody`, `notes`), `data/seen.json` (index de TOUS les postings déjà vus, pertinents ou non — évite de re-classifier), `data/archive.json` (offres retirées).
- **Onglet « Nouvelles »** : offres dont `seenScan === lastScanId` (et `lastScanId !== 'baseline'`). Chaque scan fait avancer `lastScanId`, donc les nouveautés d'hier rejoignent le flux commun au scan suivant.
- **Types** : `offcycle_internship` · `internship` · `graduate` · `fulltime_junior` · `summer_internship` (masqué par défaut dans l'app). **Catégories** : `QR` · `QT` · `ML` · `ENG` · `OTHER`.
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
