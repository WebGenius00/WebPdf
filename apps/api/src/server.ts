/**
 * PDF Studio — API Fastify
 * ------------------------------------------------------------------
 * Rôle : orchestrer les workers Python du package `text-structurizer`
 *   - POST /api/structure  : texte brut → Doc JSON (contrat "doc/0.1")
 *   - POST /api/generate   : texte brut → PDF (pipeline complet)
 *   - GET  /api/health     : sonde de disponibilité
 *
 * Choix d'architecture :
 *   - Le parsing/rendu est délégué à Python (structurizer.py + renderer.py
 *     + WeasyPrint), déjà validé en PoC. L'API reste fine : pont HTTP ↔
 *     sous-processus, avec timeouts et sanitisation.
 *   - Aucun fichier persistant côté serveur : tout transite par
 *     stdin/stdout + répertoire temporaire nettoyé en finally, ce qui
 *     garde l'API stateless (scalable derrière un load balancer).
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Fastify, { type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'

const ROOT = resolve(import.meta.dirname, '../../..')
const PY_DIR = join(ROOT, 'packages', 'text-structurizer')
const PYTHON = process.env.PYTHON_BIN ?? 'python3'
const PORT = Number(process.env.PORT ?? 4000)

/** Timeout global d'un worker (gros textes / gros PDF). */
const WORKER_TIMEOUT_MS = 60_000

interface WorkerResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

/**
 * Exécute un worker Python en capturant stdout/stderr, avec timeout dur.
 * `stdinData` est envoyé sur l'entrée standard du processus.
 */
function runPython(args: string[], stdinData?: string): Promise<WorkerResult> {
  return new Promise((done) => {
    const child = spawn(PYTHON, args, { cwd: PY_DIR })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done({ ok: false, stdout, stderr: stderr + '\n[timeout worker]', code: -1 })
    }, WORKER_TIMEOUT_MS)

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      done({ ok: false, stdout: '', stderr: String(err), code: -1 })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ ok: code === 0, stdout, stderr, code })
    })

    if (stdinData !== undefined) child.stdin.write(stdinData)
    child.stdin.end()
  })
}

/** Lit le corps de requête : soit JSON {text}, soit champ multipart `file`. */
async function extractText(request: FastifyRequest): Promise<string> {
  if (request.isMultipart()) {
    const data = await request.file({ limits: { fileSize: 10 * 1024 * 1024 } })
    if (!data) throw Object.assign(new Error('Champ "file" ou "text" requis'), { statusCode: 400 })
    const buf = await data.toBuffer()
    return buf.toString('utf-8')
  }
  const body = request.body as { text?: unknown } | undefined
  const text = body?.text
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw Object.assign(new Error('Champ "text" (string non vide) requis'), { statusCode: 400 })
  }
  return text
}

/** Whitelist des options de rendu — toute valeur inconnue retombe sur le défaut. */
const THEMES = new Set(['editorial', 'corporate', 'academic'])
const PAPERS = new Set(['a4', 'letter'])

interface GenerateBody {
  text?: string
  /** Doc JSON déjà validé par l'utilisateur (aperçu) : si présent, on saute la re-structuration. */
  doc?: unknown
  theme?: string
  paper?: string
}

const app = Fastify({ logger: { level: 'info' } })
// CORS large en dev ; en prod behind proxy, les appels sont same-origin (proxy Vite).
await app.register(cors, { origin: true })
await app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } })

app.get('/api/health', async () => ({ status: 'ok', schema: 'doc/0.1' }))

/**
 * POST /api/structure
 * Corps : { text: string } (JSON) ou multipart (champ file)
 * Réponse : Doc JSON (schéma "doc/0.1") — contrat partagé avec le frontend.
 */
app.post('/api/structure', async (request, reply) => {
  let text: string
  try {
    text = await extractText(request)
  } catch (err) {
    const e = err as { statusCode?: number; message: string }
    return reply.code(e.statusCode ?? 400).send({ error: e.message })
  }
  const res = await runPython(['structurizer.py', '--pretty'], text)
  if (!res.ok) {
    return reply.code(500).send({ error: 'worker structurizer en échec', detail: res.stderr })
  }
  try {
    return JSON.parse(res.stdout)
  } catch {
    return reply.code(500).send({ error: 'sortie structurizer non-JSON', detail: res.stdout.slice(0, 500) })
  }
})

/**
 * POST /api/generate
 * Corps JSON : { text: string, doc?: Doc, theme?, paper? }
 *   - si `doc` (Doc JSON de l'aperçu) est fourni → rendu direct du doc
 *     (fidélité stricte entre ce que l'utilisateur voit et le PDF livré) ;
 *   - sinon → pipeline complet structurize(text) → render.
 * Réponse : application/pdf.
 */
app.post('/api/generate', async (request, reply) => {
  const body = request.body as GenerateBody | undefined
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!text.trim() && !body?.doc) {
    return reply.code(400).send({ error: 'Champ "text" (ou "doc") requis' })
  }
  const theme = THEMES.has(body?.theme ?? '') ? body!.theme : 'editorial'
  const paper = PAPERS.has(body?.paper ?? '') ? body!.paper : 'a4'

  // 1) Obtention du Doc JSON : soit celui validé par le client, soit re-structuration.
  let docJson: string
  if (body?.doc && typeof body.doc === 'object') {
    docJson = JSON.stringify(body.doc)
  } else {
    const struct = await runPython(['structurizer.py'], text)
    if (!struct.ok) {
      return reply.code(500).send({ error: 'structurization impossible', detail: struct.stderr })
    }
    docJson = struct.stdout
  }

  // 2) Rendu PDF — le doc transite par stdin (aucun fichier intermédiaire côté serveur).
  const dir = await mkdtemp(join(tmpdir(), 'pdfstudio-'))
  try {
    const pdfPath = join(dir, 'out.pdf')
    const render = await runPython(
      ['renderer.py', '--stdin', pdfPath, '--theme', theme!, '--paper', paper!],
      docJson,
    )
    if (!render.ok) {
      return reply.code(500).send({ error: 'rendu PDF en échec', detail: render.stderr })
    }
    const pdf = await readFile(pdfPath)
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', 'attachment; filename="document.pdf"')
    return reply.send(pdf)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Gestion centralisée des erreurs (ex : corps trop volumineux).
app.setErrorHandler((err, _req, reply) => {
  const e = err as { statusCode?: number; message: string }
  reply.code(e.statusCode ?? 500).send({ error: e.message })
})

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`API PDF Studio prête sur http://localhost:${PORT}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
