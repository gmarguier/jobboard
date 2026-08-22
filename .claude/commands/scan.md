---
description: Veille quotidienne — détecte les nouvelles offres chez les 171 firms et met à jour l'app
---

Tu exécutes la veille quotidienne du Quant Board. Objectif : détecter les NOUVELLES offres junior (QR/QT/ML/ENG) chez toutes les firms suivies, les publier dans l'app, et retirer les offres disparues. Travaille dans ce repo (`git pull` d'abord si un remote existe).

## Étapes

1. **Scan déterministe** : `node scripts/scan.mjs` — interroge toutes les APIs ATS (recettes dans `data/firms.json`) et écrit `data/scan-candidates.json` avec : `candidates` (postings jamais vus), `removed` (offres de jobs.json disparues), `fetchErrors`, `customFirms`.

2. **Classification des candidats** : lis `data/scan-candidates.json`. Pour chaque candidat, décide s'il est pertinent : rôle junior-accessible (stage toute saison / graduate / full-time 0–2 ans, PAS de Senior/Lead/3+ yrs) dans les catégories QR (quant research), QT (trading), ML, ENG (quant dev / software / research engineering), OTHER (quant-adjacent junior). Si le titre ne suffit pas pour classifier, WebFetch la page de l'offre. Pour chaque candidat pertinent, construis l'objet job : `{firm, title, url, locations:[{city,country}], type, category, posted, start, snippet}`. Types : `summer_internship`, `offcycle_internship`, `internship`, `graduate`, `fulltime_junior`. Pays en noms courts (UK, USA, France, Netherlands, Singapore, Hong Kong…).

3. **Firms custom (sans API)** : pour chaque entrée de `customFirms` avec un `careersUrl` exploitable (status ≠ unreachable/careers_not_found, sauf si notes récentes disent le contraire), WebFetch la page carrières et compare avec `data/seen.json` (section de la firm — tu la maintiens toi-même pour ces firms : clé = URL normalisée de l'offre, valeur = {title, firstSeen}). Nouvelles offres pertinentes → même classification qu'à l'étape 2. Offres de jobs.json disparues → à retirer. Mets à jour `data/seen.json` pour ces firms directement.

4. **Application** : écris `data/scan-apply.json` = `{scanId: "<ISO datetime maintenant>", add: [jobs classifiés], removeIds: [ids des offres disparues confirmées]}` puis `node scripts/apply-scan.mjs`. Ne considère une offre comme disparue que si sa firm a été fetchée avec succès (pas dans fetchErrors).

5. **Index des vus** : `node scripts/scan.mjs --commit-seen` (intègre TOUS les candidats API — pertinents ou non — dans seen.json pour ne pas les re-traiter demain).

6. **Réparations éventuelles** : si des `fetchErrors` se répètent (API morte, board déplacé), corrige la recette (`apiEndpoint`, `ats`, `notes`) dans `data/firms.json` en retrouvant le nouveau board.

7. **Publication** : `git add -A && git commit -m "scan YYYY-MM-DD: +N nouvelles, -M retirées" && git push` (si un remote est configuré).

8. **Rapport** : résume en français — nombre de nouvelles offres (avec firm + titre + lieu, les off-cycle en premier), offres retirées, erreurs de fetch. S'il n'y a rien de nouveau, dis-le simplement.

## Règles

- N'invente JAMAIS une offre ; chaque job ajouté doit venir d'une page/API réellement consultée, avec sa vraie URL.
- Les offres `summer_internship` sont collectées comme les autres (l'app les masque par défaut).
- Ne touche pas à `firstSeen`/`seenScan` des offres existantes.
- Même s'il n'y a aucune nouveauté, exécute quand même apply-scan (scanId avance, l'onglet « Nouvelles » se vide) et commit si des fichiers ont changé.
