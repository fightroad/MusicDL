/**
 * In-process LX Music custom-source host (Node).
 * Runs user JS scripts with globalThis.lx bridge.
 */
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
}

/** Official LX source keys (exclude local / custom extras like qsvip). */
const LX_PLATFORM_KEYS = new Set(['kw', 'kg', 'tx', 'wy', 'mg'])

function parseHeaderMeta(script) {
  const meta = {}
  const re = /^\s*\*\s*@(name|description|version|author|homepage)\s+(.+?)\s*$/gim
  let m
  while ((m = re.exec(script))) {
    meta[m[1].toLowerCase()] = m[2].trim()
  }
  return meta
}

function bufferFrom(input, encoding) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  if (typeof input === 'string') return Buffer.from(input, encoding || 'utf8')
  if (Array.isArray(input)) return Buffer.from(input)
  return Buffer.from(String(input))
}

function bufToString(buf, format) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (!format || format === 'utf8' || format === 'utf-8') return b.toString('utf8')
  if (format === 'base64') return b.toString('base64')
  if (format === 'hex') return b.toString('hex')
  return b.toString(format)
}

function md5(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex')
}

function randomBytes(size) {
  const n = Math.max(0, Number(size) || 0)
  return crypto.randomBytes(n)
}

function aesEncrypt(data, mode, key, iv) {
  const buf = bufferFrom(data)
  const keyBuf = bufferFrom(key)
  const ivBuf = iv == null ? null : bufferFrom(iv)
  let algorithm = String(mode || 'aes-128-cbc').toLowerCase()
  if (!algorithm.includes('aes')) algorithm = `aes-128-${algorithm}`
  try {
    const cipher = ivBuf
      ? crypto.createCipheriv(algorithm, keyBuf, ivBuf)
      : crypto.createCipheriv(algorithm, keyBuf, Buffer.alloc(0))
    return Buffer.concat([cipher.update(buf), cipher.final()])
  } catch {
    const cipher = crypto.createCipheriv('aes-128-ecb', keyBuf.subarray(0, 16), null)
    cipher.setAutoPadding(true)
    return Buffer.concat([cipher.update(buf), cipher.final()])
  }
}

function rsaEncrypt(buffer, key) {
  return crypto.publicEncrypt(
    { key: String(key), padding: crypto.constants.RSA_PKCS1_PADDING },
    bufferFrom(buffer)
  )
}

async function inflate(buffer) {
  return zlib.inflateSync(bufferFrom(buffer))
}

async function deflate(buffer) {
  return zlib.deflateSync(bufferFrom(buffer))
}

async function nodeFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = { ...(options.headers || {}) }
  let body
  if (options.body != null) {
    if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) {
      body = options.body
    } else {
      body = JSON.stringify(options.body)
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json'
      }
    }
  } else if (options.formData) {
    const fd = new FormData()
    const raw = options.formData
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        if (value == null) continue
        if (typeof value === 'object' && value.value != null) {
          // { value, options: { filename, contentType } } style
          const blob =
            Buffer.isBuffer(value.value) || value.value instanceof Uint8Array
              ? new Blob([value.value], { type: value.options?.contentType || value.contentType })
              : value.value
          fd.append(key, blob, value.options?.filename || value.filename)
        } else {
          fd.append(key, value)
        }
      }
    }
    body = fd
    delete headers['Content-Type']
    delete headers['content-type']
  } else if (options.form) {
    body = new URLSearchParams(options.form).toString()
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout || 20000)
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal, redirect: 'follow' })
    const raw = Buffer.from(await res.arrayBuffer())
    const ctype = res.headers.get('content-type') || ''
    const text = raw.toString('utf8')
    let parsed = text
    if (ctype.includes('application/json') || /^\s*[{\[]/.test(text)) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    const headerObj = {}
    res.headers.forEach((v, k) => {
      headerObj[k] = v
    })
    return {
      statusCode: res.status,
      headers: headerObj,
      body: parsed,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** LX-compatible request(url, options, callback) → cancel fn */
function lxRequest(url, options = {}, callback) {
  let cancelled = false
  nodeFetch(url, options)
    .then((resp) => {
      if (cancelled) return
      callback(null, resp, resp.body)
    })
    .catch((err) => {
      if (cancelled) return
      callback(err)
    })
  return () => {
    cancelled = true
  }
}

/** Parse LX script header only (same as LX import — no script execution). */
export function parseLxMeta(script) {
  const meta = parseHeaderMeta(script)
  if (!meta.name) throw new Error('不是有效的洛雪音源：缺少 @name')
  return {
    name: meta.name.slice(0, 64),
    description: meta.description || null,
    version: meta.version || null,
    author: meta.author || null,
    homepage: meta.homepage || null,
  }
}

function installExitGuard() {
  if (globalThis.__musicdlExitGuard) return
  globalThis.__musicdlExitGuard = true
  process.exit = (code) => {
    console.error(`[MusicDL] blocked process.exit(${code ?? 0}) from source script`)
  }
  process.abort = () => {
    console.error('[MusicDL] blocked process.abort() from source script')
  }
}

/**
 * Load and initialize an LX custom-source script (used inside child worker).
 * Waits for async `inited` (many sources send it after version check / network).
 */
export async function createLxRuntime(script, { initTimeoutMs = 12000 } = {}) {
  installExitGuard()
  if (!script || !String(script).trim()) {
    throw new Error('脚本内容为空')
  }

  const header = parseHeaderMeta(script)
  const scriptMeta = {
    name: header.name || '',
    description: header.description || '',
    version: header.version || '',
    author: header.author || '',
    homepage: header.homepage || '',
    rawScript: script,
  }

  let requestHandler = null
  let initedPayload = null
  let settleInited = null
  const initedWait = new Promise((resolve) => {
    settleInited = resolve
  })

  const wrappedRequest = (url, options = {}, callback) => {
    return lxRequest(url, options, callback)
  }

  const lx = {
    EVENT_NAMES,
    version: '2.0.0',
    env: 'desktop',
    currentScriptInfo: scriptMeta,
    utils: {
      buffer: { from: bufferFrom, bufToString },
      crypto: { aesEncrypt, md5, randomBytes, rsaEncrypt },
      zlib: { inflate, deflate },
    },
    on(eventName, handler) {
      if (eventName === EVENT_NAMES.request || eventName === 'request') {
        requestHandler = handler
      }
    },
    send(eventName, data) {
      if (eventName === EVENT_NAMES.inited || eventName === 'inited') {
        initedPayload = data || {}
        if (settleInited) settleInited()
      }
    },
    request: wrappedRequest,
  }

  const sandboxGlobal = {
    lx,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
  }
  sandboxGlobal.globalThis = sandboxGlobal
  sandboxGlobal.window = sandboxGlobal
  sandboxGlobal.document = {
    getElementsByTagName(tag) {
      if (String(tag).toLowerCase() === 'script') {
        const text = scriptMeta.rawScript || ''
        return [{ innerText: text, textContent: text, src: '' }]
      }
      return []
    },
  }

  const fn = new Function(
    'globalThis',
    'window',
    'document',
    'lx',
    'console',
    'Buffer',
    'URL',
    'setTimeout',
    'clearTimeout',
    script + '\n//# sourceURL=lx-source.js'
  )
  fn(
    sandboxGlobal,
    sandboxGlobal,
    sandboxGlobal.document,
    lx,
    console,
    Buffer,
    URL,
    setTimeout,
    clearTimeout
  )

  if (!initedPayload) {
    let timer = null
    try {
      await Promise.race([
        initedWait,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('音源脚本未发送 inited 事件（初始化失败）'))
          }, Math.max(1000, Number(initTimeoutMs) || 12000))
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  if (!initedPayload) {
    throw new Error('音源脚本未发送 inited 事件（初始化失败）')
  }
  if (!requestHandler) {
    throw new Error('音源脚本未注册 request 处理器')
  }

  const sources = initedPayload.sources || {}
  const platforms = Object.keys(sources).filter((k) => LX_PLATFORM_KEYS.has(k))
  const platformQualitys = {}
  const qualitys = []
  for (const key of platforms) {
    const qs = Array.isArray(sources[key]?.qualitys)
      ? sources[key].qualitys.filter(Boolean)
      : []
    platformQualitys[key] = qs.length ? qs : ['128k', '320k']
    for (const q of platformQualitys[key]) {
      if (!qualitys.includes(q)) qualitys.push(q)
    }
  }

  async function request({ source, action, info }) {
    return Promise.resolve(requestHandler({ source, action, info }))
  }

  return {
    meta: {
      ...parseLxMeta(script),
      platforms: platforms.length ? platforms : ['kw', 'kg', 'tx', 'wy', 'mg'],
      qualitys: qualitys.length ? qualitys : ['128k', '320k'],
      platformQualitys:
        Object.keys(platformQualitys).length > 0
          ? platformQualitys
          : { kw: ['128k', '320k'] },
      sources,
    },
    request,
    dispose() {
      requestHandler = null
    },
  }
}

/** In-memory capabilities from last successful child init (per source id). */
const capabilityCache = new Map()

export function getCachedCapabilities(sourceId) {
  return capabilityCache.get(Number(sourceId)) || null
}

export function setCachedCapabilities(sourceId, meta) {
  if (!meta) return
  capabilityCache.set(Number(sourceId), {
    platforms: meta.platforms || [],
    qualitys: meta.qualitys || [],
    platformQualitys: meta.platformQualitys || null,
  })
}

export function dropRuntime(sourceId) {
  capabilityCache.delete(Number(sourceId))
}

/**
 * Resolve musicUrl in a child process. Returns { url, meta }.
 * A crashing source only kills the child — not the MusicDL server.
 */
export function resolveMusicUrlInChild(script, request, timeoutMs = 30000) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const scriptPath = path.join(os.tmpdir(), `musicdl-script-${id}.js`)
  const reqPath = path.join(os.tmpdir(), `musicdl-req-${id}.json`)
  const outPath = path.join(os.tmpdir(), `musicdl-out-${id}.json`)
  fs.writeFileSync(scriptPath, String(script || ''), 'utf8')
  fs.writeFileSync(reqPath, JSON.stringify(request || {}), 'utf8')

  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'resolve-worker.js')
    const env = { ...process.env }
    delete env.NODE_OPTIONS
    const child = spawn(process.execPath, [workerPath, scriptPath, reqPath, outPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    })

    let settled = false
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    const cleanup = () => {
      for (const p of [scriptPath, reqPath, outPath]) {
        try {
          fs.unlinkSync(p)
        } catch {
          // ignore
        }
      }
    }

    const finish = (err, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      cleanup()
      if (err) reject(err)
      else resolve(result)
    }

    const timer = setTimeout(() => finish(new Error('音源取链超时')), timeoutMs)

    child.on('error', (err) => finish(err))
    child.on('exit', () => {
      if (settled) return
      let payload = null
      try {
        if (fs.existsSync(outPath)) {
          payload = JSON.parse(fs.readFileSync(outPath, 'utf8'))
        }
      } catch {
        payload = null
      }
      if (payload?.ok && typeof payload.url === 'string') {
        finish(null, { url: payload.url, meta: payload.meta || null })
        return
      }
      if (payload && payload.ok === false) {
        finish(new Error(payload.error || '音源取链失败'))
        return
      }
      const detail = stderr.trim().slice(-400)
      finish(
        new Error(
          detail
            ? `音源脚本异常退出: ${detail}`
            : '音源脚本无法在 MusicDL 中运行'
        )
      )
    })
  })
}

