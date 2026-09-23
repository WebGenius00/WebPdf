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

## 🔥 Dernière session
**Objectif de la session :** Persister les fichiers frontend manquants (dette de la session précédente), créer l'API Fastify d'orchestration et valider le pipeline complet texte → PDF via HTTP.

**Réalisé :**
- [x] `apps/web/src/lib/doc.ts` — typage complet du contrat `doc/0.1` (blocs, TOC, métadonnées, garde `isDoc`).
- [x] `apps/web/src/lib/api.ts` — client HTTP (`structureText`, `generatePdf`, `health`).
- [x] `apps/web/src/modules/reader/PdfReader.tsx` — visionneuse pdfjs-dist : zoom Ctrl+molette, pagination, sommaire/bookmarks résolu en n° de page, rendu HiDPI.
- [x] `apps/web/src/modules/generator/Generator.tsx` — saisie/import .txt/.md + appels API + téléchargement du PDF.
- [x] `apps/web/src/modules/generator/DocPreview.tsx` — aperçu "papier" fidèle au renderer (switch exhaustif sur les blocs).
- [x] `apps/web/src/App.tsx` + `app.css` — coquille à onglets, sonde API avec bandeau d'alerte, styles MVP.
- [x] `apps/api/` — serveur Fastify (TS, tsx) : `/api/health`, `/api/structure`, `/api/generate` ; orchestration des workers Python via spawn (timeout 60 s, tmpdir nettoyé, stateless).
- [x] Build frontend vérifié : `tsc -b && vite build` ✅ (worker pdf.js bundlé correctement via `?url`).
- [x] Test E2E API ✅ : POST /api/generate → PDF valide (`%PDF-1.7`, 10,7 ko) ; /api/structure renvoie un Doc JSON conforme.

**Prochaine session — Objectif :** Phase 6 — reprendre `PROGRESS.md`, passer l'UI en Tailwind + shadcn/ui, ajouter la barre de recherche texte dans le lecteur (page + surlignage via `page.streamTextContent()`), puis amorcer la Phase 7 (tests unitaires pytest du structurizer + tests d'API).

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

## ⚠️ Points d'attention / Bloquants
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
