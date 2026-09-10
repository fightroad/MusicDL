import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'musicdl_session'
const MAX_AGE_SEC = 7 * 24 * 60 * 60

function authPassword() {
  return String(process.env.AUTH_PASSWORD || '')
}

export function authEnabled() {
  return authPassword().length > 0
}

function authSecret() {
  return createHash('sha256').update(`musicdl-auth:${authPassword()}`).digest('hex')
}

function parseCookies(req) {
  const header = req.headers.cookie || ''
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()
    if (key) out[key] = decodeURIComponent(val)
  }
  return out
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', authSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verify(token) {
  if (!token || typeof token !== 'string') return null
  const i = token.lastIndexOf('.')
  if (i < 0) return null
  const body = token.slice(0, i)
  const sig = token.slice(i + 1)
  const expect = createHmac('sha256', authSecret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function checkPassword(input) {
  const expected = authPassword()
  const a = Buffer.from(String(input ?? ''), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function setSessionCookie(res) {
  const token = sign({ v: 1, t: Date.now() })
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}`,
  )
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export function isAuthed(req) {
  if (!authEnabled()) return true
  const data = verify(parseCookies(req)[COOKIE_NAME])
  return Boolean(data && data.v === 1)
}

export function authMiddleware(req, res, next) {
  if (!authEnabled() || isAuthed(req)) return next()
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ detail: '未登录' })
  }
  return res.redirect('/login')
}

export function loginHandler(req, res) {
  if (!authEnabled()) {
    return res.status(400).json({ detail: '未启用登录（未设置 AUTH_PASSWORD）' })
  }
  const password = req.body?.password
  if (!checkPassword(password)) {
    return res.status(401).json({ detail: '密码错误' })
  }
  setSessionCookie(res)
  return res.json({ ok: true })
}

export function logoutHandler(_req, res) {
  clearSessionCookie(res)
  return res.status(204).end()
}

export function statusHandler(req, res) {
  const enabled = authEnabled()
  res.json({
    enabled,
    authenticated: !enabled || isAuthed(req),
  })
}
