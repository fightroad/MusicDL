import path from 'node:path'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { ROOT } from './db.js'
import sourcesRouter from './routes/sources.js'
import musicRouter from './routes/music.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 8000

const app = express()
app.use(express.json({ limit: '5mb' }))
app.use(express.static(path.join(ROOT, 'public')))

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'views', 'index.html'))
})

app.get('/sources', (_req, res) => {
  res.redirect('/#sources')
})

app.use('/api/sources', sourcesRouter)
app.use('/api/music', musicRouter)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ detail: err.message || 'Internal Server Error' })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`MusicDL running at http://127.0.0.1:${PORT}`)
})
