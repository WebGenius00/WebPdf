/**
 * Client HTTP minimal pour l'API PDF Studio (apps/api, Fastify).
 *
 * Base par défaut : '' (chemin relatif) — en dev, le proxy Vite renvoie
 * /api/* vers http://localhost:4000, ce qui neutralise tout souci CORS.
 * En prod derrière un autre domaine, définir VITE_API_URL explicitement.
 */

import { isDoc, type Doc } from './doc'

const BASE = import.meta.env.VITE_API_URL ?? ''

/** Options de rendu transmises à /api/generate (thème & format papier). */
export interface RenderOptions {
  theme?: 'editorial' | 'corporate' | 'academic'
  paper?: 'a4' | 'letter'
}

async function jsonOrThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { error?: string; detail?: string }
      detail = [body.error, body.detail].filter(Boolean).join(' — ')
    } catch {
      /* corps non-JSON : on garde statusText */
    }
    throw new Error(`API ${res.status}: ${detail}`)
  }
  return res.json()
}

/** POST /api/structure — texte brut → Doc JSON (contrat doc/0.1). */
export async function structureText(text: string, signal?: AbortSignal): Promise<Doc> {
  const res = await fetch(`${BASE}/api/structure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  const data = await jsonOrThrow(res)
  if (!isDoc(data)) throw new Error('Réponse API invalide (schéma doc/0.1 attendu)')
  return data
}

/** POST /api/generate — texte (+ Doc JSON optionnel) → Blob PDF. */
export async function generatePdf(
  text: string,
  options: RenderOptions = {},
  doc?: Doc | null,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Si un Doc JSON est fourni (aperçu validé par l'utilisateur), le serveur
    // saute la re-structuration : le PDF généré est fidèle à l'aperçu affiché.
    body: JSON.stringify({ text, doc: doc ?? undefined, ...options }),
    signal,
  })
  if (!res.ok) {
    await jsonOrThrow(res) // normalise l'erreur
    throw new Error('échec inattendu de /api/generate')
  }
  return res.blob()
}

/** GET /api/health — sonde utilisée par l'UI pour afficher l'état du backend. */
export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}
