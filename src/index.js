import path from 'node:path'
import express from 'express'
import { ROOT } from './db.js'
import {
  authEnabled,
  authMiddleware,
  isAuthed,
  loginHandler,
  logoutHandler,
  statusHandler,
} from './auth.js'
import sourcesRouter from './routes/sources.js'
import musicRouter from './routes/music.js'

const PORT = Number(process.env.PORT) || 8000
const HOST = process.env.HOST || '127.0.0.1'
const views = path.join(ROOT, 'views')

const app = express()
app.use(express.json({ limit: '5mb' }))

app.get('/api/auth/status', statusHandler)
app.post('/api/login', loginHandler)
app.post('/api/logout', logoutHandler)

app.get('/login', (req, res) => {
  if (!authEnabled()) return res.redirect('/')
  if (isAuthed(req)) return res.redirect('/')
  res.sendFile(path.join(views, 'login.html'))
})

app.use(express.static(path.join(ROOT, 'public')))
app.use(authMiddleware)

app.get('/', (_req, res) => {
  res.sendFile(path.join(views, 'index.html'))
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

app.listen(PORT, HOST, () => {
  console.log(`MusicDL running at http://${HOST}:${PORT}`)
  if (authEnabled()) console.log('Auth enabled (AUTH_PASSWORD is set)')
})
