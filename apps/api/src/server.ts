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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

const app = Fastify({ logger: { level: 'info' } })
// CORS : le frontend (Vite, port 5173) appelle l'API (port 4000).
// On autorise explicitement localhost + VITE_ALLOWED_ORIGIN pour la prod.
const allowedOrigin = (process.env.VITE_ALLOWED_ORIGIN ?? 'http://localhost:5173').split(',')
await app.register(cors, { origin: [...allowedOrigin, true] })
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
 * Corps : { text: string } (JSON) ou multipart (champ file)
 * Réponse : application/pdf (pipeline structurize → render via tmpdir).
 */
app.post('/api/generate', async (request, reply) => {
  let text: string
  try {
    text = await extractText(request)
  } catch (err) {
    const e = err as { statusCode?: number; message: string }
    return reply.code(e.statusCode ?? 400).send({ error: e.message })
  }

  // 1) Structuration : Doc JSON sur stdout
  const struct = await runPython(['structurizer.py'], text)
  if (!struct.ok) {
    return reply.code(500).send({ error: 'structurization impossible', detail: struct.stderr })
  }

  const dir = await mkdtemp(join(tmpdir(), 'pdfstudio-'))
  try {
    const docPath = join(dir, 'doc.json')
    const pdfPath = join(dir, 'out.pdf')
    await writeFile(docPath, struct.stdout, 'utf-8')

    // 2) Rendu PDF (WeasyPrint)
    const render = await runPython(['renderer.py', docPath, pdfPath])
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
  const status = (err as { statusCode?: number }).statusCode ?? 500
  reply.code(status).send({ error: err.message })
})

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`API PDF Studio prête sur http://localhost:${PORT}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
