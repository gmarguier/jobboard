---
description: Veille quotidienne — détecte les nouvelles offres chez les firms suivies et met à jour l'app
---

Tu exécutes la veille quotidienne du Quant Board. Objectif : détecter les NOUVELLES offres junior (QR/QT/ML/ENG) chez toutes les firms suivies, les publier dans l'app, et retirer celles qui ont disparu. Commence par `git pull --rebase`.

## Étapes

1. **Scan déterministe** : `node scripts/scan.mjs` → écrit `data/scan-candidates.json` :
   - `candidates` : postings jamais vus (tous boards ATS de chaque firm)
   - `removed` : offres `source: "api"` de jobs.json absentes des boards (donc réellement fermées)
   - `fetchErrors` : firms dont l'API a échoué
   - `customFirms` : firms sans API, à traiter à la main (étape 3)

2. **Classification des candidats** : lis `data/scan-candidates.json`. Pour chaque candidat, décide s'il est pertinent : rôle junior-accessible (stage toute saison / graduate / full-time 0–2 ans ; PAS de Senior/Lead/Head/3+ ans) dans les catégories QR (quant research), QT (trading), ML, ENG (quant dev / software / research engineering), OTHER (quant-adjacent junior). Si le titre ne suffit pas, WebFetch la page de l'offre. Construis pour chaque offre retenue : `{firm, title, url, locations:[{city,country}], type, category, posted, start, snippet, source: "api"}`.
   Types : `summer_internship`, `offcycle_internship`, `internship`, `graduate`, `fulltime_junior`. Pays en noms courts (UK, USA, France, Netherlands, Singapore, Hong Kong…).

   **Le champ `start` est déterminant** : `apply-scan.mjs` en déduit l'année de début et donc si l'offre est compatible avec la disponibilité de Grégoire (septembre 2027). Renseigne-le aussi précisément que la page le permet — « September 2027 », « Summer 2028 », « January 2027 or July 2027 », « October 2027 - March 2028 ». Ne confonds pas la date de DÉBUT avec l'année de DIPLÔME exigée : « stage été 2027 pour étudiants diplômés en 2028 » a `start` = « Summer 2027 » ; l'exigence de diplôme va dans le `snippet`. Si la page ne donne aucune date, laisse `start` à null plutôt que de deviner.

3. **Firms sans API** : pour chaque entrée de `customFirms` ayant un `careersUrl` exploitable, WebFetch la page carrières et compare aux offres déjà présentes dans `data/jobs.json` pour cette firm. Les nouvelles offres pertinentes suivent la même classification, avec **`source: "html"`** (indispensable : sans ça le scan API les croirait disparues et les archiverait). Une offre HTML absente de la page peut être proposée à la suppression.

4. **Application** : écris `data/scan-apply.json` = `{scanId: "<datetime ISO maintenant>", add: [offres classifiées], removeIds: [ids confirmés disparus]}` puis `node scripts/apply-scan.mjs`. Ne retire jamais une offre dont la firm figure dans `fetchErrors`.

5. **Index des vus** : `node scripts/scan.mjs --commit-seen` — intègre TOUS les candidats API (pertinents ou non) dans `seen.json`, pour ne pas les re-classifier demain.

6. **Réparations** : si des `fetchErrors` se répètent (board déplacé ou supprimé), retrouve le nouveau board et corrige `apiEndpoints` dans `data/firms.json`. Si une firm publie sur plusieurs boards, ajoute-les tous à `apiEndpoints` — c'est une liste.

6bis. **Nouvelle firm** : si tu ajoutes une firm au suivi, classe son type d'activité dans `data/firm-types.json` (`mm_hft`, `prop`, `hf_syst`, `hf_multistrat`, `hf_disc`, `am`, `crypto`, `autre` — voir CLAUDE.md) puis lance `node scripts/fix-endpoints.mjs`. Sans ça elle apparaîtra en « Autre » dans l'app.

7. **Publication** : `git add -A && git commit -m "scan YYYY-MM-DD: +N nouvelles, -M retirées" && git push`.

8. **Rapport** en français : nombre de nouvelles offres (firm + titre + lieu, **off-cycle en premier**), offres retirées, erreurs de fetch. Signale à part et en tête **les offres compatibles avec sa disponibilité** (`fit` valant `ok`) : ce sont les seules sur lesquelles il peut agir. S'il n'y a rien de nouveau, dis-le en une phrase.

## Règles

- N'invente JAMAIS une offre : chaque offre ajoutée vient d'une page ou d'une API réellement consultée, avec sa vraie URL.
- Le champ `source` est structurant : `"api"` = visible dans un board ATS interrogeable, `"html"` = trouvée sur une page maison. Une erreur ici fait disparaître des offres valides.
- Les summers sont collectés comme les autres (l'app les masque par défaut) — Grégoire ne peut pas les faire, mais ils signalent les firms actives.
- Ne modifie pas `firstSeen` / `seenScan` des offres existantes.
- Même sans nouveauté, lance apply-scan (le `scanId` avance, l'onglet « Nouvelles » se vide) et commite si des fichiers ont changé.
