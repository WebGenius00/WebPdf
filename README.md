# PDF Studio

Lecture et génération professionnelles de PDF à partir de texte brut.
Monorepo : SPA React (Vite) + API Fastify + workers Python (structurization & rendu WeasyPrint).

## Modules

| Module | Description |
|---|---|
| ✍️ **Générer** | Texte brut → Doc JSON (`doc/0.1`) → PDF paginé avec page de titre, sommaire automatique (target-counter), thèmes (Éditorial / Corporate / Académique), formats A4/Letter. L'aperçu HTML est fidèle au PDF : le Doc validé est renvoyé tel quel au renderer. |
| 📖 **Lire** | Visionneuse 100 % locale (pdfjs-dist) : glisser-déposer, rendu des pages à la demande (IntersectionObserver), zoom + presets, navigation clavier, sommaire/bookmarks, recherche plein-texte insensible aux accents. |

## Architecture

```
apps/web   → React 19 + Vite 8 (proxy /api → port 4000 : zéro souci CORS en dev)
apps/api   → Fastify 5 : pont HTTP ↔ sous-processus Python (stateless, stdin/stdout)
packages/text-structurizer → structurizer.py (stdlib only) + renderer.py (WeasyPrint)
```

## Lancement local

Prérequis : Node ≥ 20, Python 3 ≥ 3.10 avec `weasyprint` (`pip install weasyprint`).

```bash
npm install

# Terminal 1 — API (port 4000)
npm run dev:api

# Terminal 2 — Frontend (port 5173)
npm run dev:web
```

Ouvrir **http://localhost:5173** — bouton « ✨ Exemple » dans l'onglet Générer pour une démo immédiate.

Autres scripts : `npm run build` (application web), `npm run typecheck`, `npm test` (tests Python du structurizer + tests des workspaces disponibles).

## API

- `GET /api/health` → `{status:"ok", schema:"doc/0.1"}`
- `POST /api/structure` `{text}` → Doc JSON
- `POST /api/generate` `{text, doc?, theme?, paper?, header?, footer?}` → `application/pdf`
  (si `doc` fourni : rendu direct, sans re-structuration)

Les options `header` et `footer` acceptent `enabled`, `left`, `center`, `right` et `onCover`.
Les champs de texte peuvent utiliser `{title}`, `{section}`, `{page}` et `{pages}`.
Les valeurs par défaut conservent l'identité PDF Studio et la pagination existantes.

## Notes de conception

- Aucun fichier persistant côté serveur : tout transite par stdin/stdout + tmpdir nettoyé.
- Les imports de fichiers (.txt/.md, PDF) sont lus côté client : aucun document ne quitte la machine sauf génération PDF.
- L'interface utilise un design system CSS natif (tokens, thèmes auto/clair/sombre, composants) ; le PDF reste sur fond blanc avec une paire Liberation Serif/Sans, des marges d'impression dédiées, des en-têtes de section et une pagination courante.

  
