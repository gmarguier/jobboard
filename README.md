# Quant Board

Jobboard personnel recensant les offres junior — **stages off-cycle en priorité**, graduate et full-time 0–2 ans — en Quant Research, Quant Trading, Machine Learning et Engineering chez **177 trading firms et hedge funds**, avec veille quotidienne automatique.

👉 **[gmarguier.github.io/jobboard](https://gmarguier.github.io/jobboard/)**

## L'app

Page statique servie par GitHub Pages, installable sur l'écran d'accueil (PWA) et consultable hors ligne.

- **Nouvelles** — les offres apparues au dernier scan. Elles rejoignent le flux commun au scan suivant.
- **Offres** — toute la base, triée par pertinence (off-cycle en tête). Filtres : catégorie, type, région, firm, recherche plein texte, favoris ⭐.
- **Firms** — les 177 firms suivies, leur ATS et leur nombre d'offres, avec lien direct vers leur page carrières.

Les summer internships sont collectés mais **masqués par défaut** (incompatibles avec une sortie d'Oxford en septembre 2027) ; le chip « Summer » les réaffiche.

### Installer sur iPhone

Ouvrir le lien dans Safari → Partager → « Sur l'écran d'accueil ».

## La veille

Une tâche planifiée (`quant-board-veille`, tous les jours à 7h23) lance la procédure décrite dans [.claude/commands/scan.md](.claude/commands/scan.md). Elle est aussi lançable à la main avec `/scan` depuis ce dossier.

Le scan combine deux étages :

1. **Déterministe** — `scripts/scan.mjs` interroge les APIs ATS de 87 firms (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Recruitee, Workable, Breezy, Pinpoint, WordPress) et compare à l'index `data/seen.json`.
2. **Claude** — classe les nouveaux postings (junior ? quel type ? quelle catégorie ?) et traite à la main les 64 firms sans API exploitable, en lisant leur page carrières.

Une offre n'est archivée que si elle a réellement disparu du board qui l'a publiée : les offres issues de pages maison (`source: "html"`) sont exclues de cette vérification, qui ne peut structurellement pas les voir.

## Fichiers de données

| Fichier | Rôle |
|---|---|
| `data/jobs.json` | Les offres + méta (`generated`, `lastScanId`) |
| `data/firms.json` | Les 177 firms et leur **recette de scraping** (`apiEndpoints`, notes) |
| `data/seen.json` | Index de tous les postings déjà vus, pour ne pas les re-classifier |
| `data/archive.json` | Offres retirées, conservées |
| `data/overrides.json` | Corrections manuelles de recettes, réappliquées après chaque fusion |

## Scripts

```bash
node scripts/scan.mjs           # scan des APIs → data/scan-candidates.json
node scripts/scan.mjs --seed    # (ré)initialise l'index seen.json
node scripts/apply-scan.mjs     # applique data/scan-apply.json à la base
node scripts/merge.mjs          # refusionne data/raw/batch-*.json (scrape initial)
node scripts/fix-endpoints.mjs  # reconstruit les recettes + applique les overrides
node scripts/tag-source.mjs     # marque chaque offre 'api' ou 'html'
```

Après le scrape initial, seuls les deux premiers et `apply-scan` servent au quotidien.
