/**
 * Config Vite — PDF Studio (frontend).
 * - proxy /api → API Fastify (port 4000) : en dev, l'origine est la même,
 *   ce qui neutralise tout souci CORS et simplifie le déploiement.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // écoute sur toutes les interfaces (nécessaire en conteneur / accès réseau)
    port: 5173,
    allowedHosts: true, // accepte les hôtes de type proxy *.preview.app
    proxy: {
      '/api': {
        target: process.env.VITE_API_ORIGIN ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900, // pdfjs-dist est volumineux par nature
  },
})
