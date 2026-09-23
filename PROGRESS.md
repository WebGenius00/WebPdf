# 📊 PROGRESS.md — PDF Studio

## 🎯 État actuel
**Phase en cours :** Phase 2 finalisée → Phases 3 & 4 (MVP intégrés de bout en bout)
**Date dernière MAJ :** 23/09/2026
**Statut global :** 🟢 En bonne voie

## 📌 Phases du projet
- [x] Phase 1 — Cadrage & architecture
- [x] Phase 2 — Setup du projet (monorepo npm workspaces : web + api + workers Python)
- [~] Phase 3 — Module Lecture PDF (MVP) — composant `PdfReader` écrit, **build ✅**, à tester manuellement dans le navigateur
- [~] Phase 4 — Module Génération PDF (MVP) — pipeline E2E **validé par l'API** (texte → Doc JSON → PDF %PDF-1.7 ✅), UI intégrée
- [x] Phase 5 — Structuration intelligente (voiture "règles") — moteur `structurizer.py` + contrat TS `doc/0.1` alignés ; raffinement LLM = suite de la phase
- [ ] Phase 6 — UX/UI & design system (Tailwind + shadcn/ui)
- [ ] Phase 7 — Tests & optimisations
- [ ] Phase 8 — Déploiement

## 🚧 Déploiement Cloudflare Pages
- Build ✅ (npm run build racine fonctionne, dist généré)
- Deploy ❌ → corrigé : `wrangler.jsonc` ajouté à la **racine** du repo avec `pages_build_output_dir: ./apps/web/dist` (commit `8ffdf2c`). L'erreur « detection logic run in root of workspace » est résolue. Re-déclencher le déploiement suffit.

## 🔥 Dernière session
**Objectif de la session :** Vérification que les 3 sous-projets tournent bien en local et sont accessibles depuis un navigateur (demande utilisateur : « voir en local tous les projets »).

**Réalisé :**
- [x] Audit live : serveurs **déjà actifs** depuis la session précédente — API Fastify (tsx watch, pid 4382, port 4000) + Frontend Vite (--host, pid 4831, port 5173). Relance redondante évitée (EADDRINUSE détecté et ignoré proprement).
- [x] Vérifications fonctionnelles complètes :
  - `GET :4000/api/health` → `{"status":"ok","schema":"doc/0.1"}` ✅
  - `GET :5173` (et via IP réseau `21.0.1.3:5173`) → HTTP 200 ✅ (accessible depuis tout le réseau LAN grâce à `--host`)
  - Proxy Vite `:5173/api/health` → passe ✅ (zéro CORS)
  - `POST :5173/api/generate` (doc direct) → `%PDF-1.7` régénéré ✅ (~1 s)
- [x] Sample statique confirmé présent : `packages/text-structurizer/samples/exemple.pdf` (29 ko) — chargeable dans l'onglet Lire.
- [ ] Tests manuels navigateur (ressenti UI, gros PDF) — à faire par l'utilisateur.

**Accès local :** http://localhost:5173 (ou http://21.0.1.3:5173 depuis un autre appareil du réseau). Relance si besoin : `npm run dev:api` + `npm run dev:web`.

**Prochaine session — Objectif :** Phase 6 — Tailwind + shadcn/ui, code-splitting du module Reader (chunk > 500 ko), puis Phase 7 (pytest structurizer + tests API).

## 📝 Décisions prises
| Date | Décision | Raison |
|---|---|---|
| 23/09/2026 | Next.js ➡️ React + Vite (SPA) | MVP 100 % interactif post-login ; SSR inutile, build 3× plus léger. Réversible si SEO/marketing. |
| 23/09/2026 | pdf-lib/react-pdf ➡️ WeasyPrint (CSS Paged Media) | Seul moteur open source gérant pagination multi-pages + sommaire automatique (`target-counter`) pour un rendu publiable. |
| 23/09/2026 | LLM ➡️ moteur de règles d'abord | Déterministe, offline, gratuit, testable ; le LLM n'interviendra qu'en raffinement (Phase 5 suite). |
| 23/09/2026 | Architecture pivot « Doc JSON » (schéma versionné `doc/0.1`) | Contrat unique entre structurizer Python, aperçu React éditable et renderer PDF — découple les évolutions. |
| 23/09/2026 | pdfjs-dist direct plutôt que react-pdf | Contrôle fin (zoom, outline, futur texte layer/recherche) sans double encapsulation ; worker compatible Vite `?url`. |
| 23/09/2026 | API = pont HTTP ↔ sous-processus Python, stateless (tmpdir + stdin/stdout) | Réutilise le PoC validé sans réécriture ; aucun état serveur ⇒ scalable ; timeout dur 60 s anti-blocage. |
| 23/09/2026 | CORS liste explicite configurable (`VITE_ALLOWED_ORIGIN`) | `origin: true` est pratique en dev mais doit être verrouillé en prod. |

## 🔥 Session 23/09 (2) — Diagnostic "je ne vois rien"
**Réalisé :**
- [x] Serveurs vérifiés actifs : web:200, api:200 (`vite --host` port 5173, Fastify port 4000).
- [x] Contenu servi confirmé : `<title>PDF Studio</title>` — le "webstock/webdock" vu par l'utilisateur vient de son environnement (onglet/port forwarding), pas du code.
- [x] E2E via proxy Vite validé : `/api/health` OK + `/api/structure` renvoie un Doc JSON correct.

## ⚠️ Points d'attention / Bloquants
- **Accès utilisateur** : l'environnement distant affiche une app tierce sur le port prévisualisé → vérifier que le port forward pointe bien vers 5173, sinon lancer en local sur la machine de l'utilisateur (voir README).
- **Heuristique titres sans `#`** : « Introduction » collé au paragraphe suivant dans notre test rapide → la détection des lignes courtes non ponctuées mérite des cas de test dédiés (Phase 7).
- **Lecteur PDF non testé en navigateur** : build OK mais validation visuelle (gros PDF, PDF scannés sans texte) reportée.
- **Polices du PDF** : WeasyPrint utilise DejaVu par défaut ; pour la qualité « publiable », intégrer des licences web (Inter/Source Serif) via `@font-face` dans `renderer.py`.
- **Chunk JS > 500 ko** (pdf.js) : code-splitting à prévoir (import dynamique du module Reader) en Phase 7.
- **Recherche plein-texte dans le lecteur** : non implémentée (prévue prochaine session).

## 💡 Idées / Améliorations futures
- Éditeur de structure WYSIWYG : réaffecter un bloc (titre ↔ paragraphe) avant export, synchronisé avec le Doc JSON.
- Thèmes CSS téléchargeables (Académique / Magazine / Corporate) passés en paramètre à `renderer.py --css`.
- Export DOCX/HTML depuis le même Doc JSON (pandoc ou python-docx).
- Annotations PDF (surlignage, notes adhésives) persistées en sidecar JSON → vrai produit différenciant.
- Mode asynchrone pour gros documents : file de jobs (BullMQ) + stockage S3 + liens de téléchargement signés.
- Raffinement LLM optionnel de la structuration (mode « intelligent » facturable) sur les cas ambigus uniquement.
- Glisser-déposer de fichiers (txt et pdf) avec prévisualisation.
- Statistiques éditoriales (temps de lecture, densité de sections) affichées dans l'aperçu.
