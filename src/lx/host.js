/**
 * In-process LX Music custom-source host (Node).
 * Runs user JS scripts with globalThis.lx bridge.
 */
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { URL } from 'node:url'

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

function parseLxMeta(script) {
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

/**
 * Load and initialize an LX custom-source script.
 * @returns {{ sources: object, meta: object, request: Function, dispose: Function }}
 */
export function createLxRuntime(script) {
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
      }
    },
    request: wrappedRequest,
  }

  // Isolate-ish scope: script sees globalThis.lx
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

  const fn = new Function(
    'globalThis',
    'window',
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
    lx,
    console,
    Buffer,
    URL,
    setTimeout,
    clearTimeout
  )

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
    const result = await Promise.resolve(
      requestHandler({ source, action, info })
    )
    return result
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

/** Cache runtimes by source id to avoid re-exec every request */
const runtimeCache = new Map()

export function getCachedRuntime(sourceId, script) {
  const cached = runtimeCache.get(sourceId)
  if (cached && cached.script === script) return cached.runtime
  if (cached) cached.runtime.dispose()
  const runtime = createLxRuntime(script)
  runtimeCache.set(sourceId, { script, runtime })
  return runtime
}

export function dropRuntime(sourceId) {
  const cached = runtimeCache.get(sourceId)
  if (cached) {
    cached.runtime.dispose()
    runtimeCache.delete(sourceId)
  }
}
