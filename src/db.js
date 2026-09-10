import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, '..')
export const DATA_DIR = path.join(ROOT, 'data')
export const CONFIG_DIR = path.join(DATA_DIR, 'config')
export const DOWNLOAD_DIR = path.join(DATA_DIR, 'downloads')
export const SOURCES_PATH = path.join(CONFIG_DIR, 'sources.json')

fs.mkdirSync(CONFIG_DIR, { recursive: true })
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function emptyStore() {
  return { nextId: 1, sources: [] }
}

function normalizeSource(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    name: row.name,
    kind: row.kind || 'lx',
    version: row.version || null,
    author: row.author || null,
    homepage: row.homepage || null,
    script_url: row.script_url ?? row.scriptUrl ?? null,
    script: row.script || '',
    enabled: Boolean(row.enabled),
    description: row.description || null,
    sort_order: Number(row.sort_order) || 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    hasScript: Boolean(row.script),
  }
}

function readStore() {
  if (!fs.existsSync(SOURCES_PATH)) return emptyStore()
  const text = fs.readFileSync(SOURCES_PATH, 'utf8')
  if (!String(text).trim()) return emptyStore()
  let raw
  try {
    raw = JSON.parse(text)
  } catch (err) {
    const corrupt = `${SOURCES_PATH}.corrupt.${Date.now()}`
    try {
      fs.copyFileSync(SOURCES_PATH, corrupt)
    } catch {
      // ignore backup failure
    }
    const e = new Error(
      `音源配置损坏，已停止写入以免覆盖。请检查 ${SOURCES_PATH}` +
        (fs.existsSync(corrupt) ? `（备份: ${path.basename(corrupt)}）` : '')
    )
    e.cause = err
    throw e
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`音源配置格式无效: ${SOURCES_PATH}`)
  }
  const sources = Array.isArray(raw.sources) ? raw.sources : null
  if (!sources) {
    throw new Error(`音源配置缺少 sources 数组: ${SOURCES_PATH}`)
  }
  const maxId = sources.reduce((m, s) => Math.max(m, Number(s?.id) || 0), 0)
  const nextId = Math.max(Number(raw.nextId) || 1, maxId + 1)
  return { nextId, sources }
}

function writeStore(store) {
  const payload = {
    nextId: store.nextId,
    sources: store.sources,
  }
  const tmp = `${SOURCES_PATH}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, SOURCES_PATH)
}

if (!fs.existsSync(SOURCES_PATH)) writeStore(emptyStore())

export function listSources() {
  return readStore()
    .sources.map(normalizeSource)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
}

export function getSource(id) {
  const sid = Number(id)
  const row = readStore().sources.find((s) => Number(s.id) === sid)
  return row ? normalizeSource(row) : null
}

/** Public API shape without dumping huge scripts */
export function toPublicSource(row) {
  if (!row) return null
  const { script, ...rest } = normalizeSource(row)
  return rest
}

export function getSourceByName(name) {
  const row = readStore().sources.find((s) => s.name === name)
  return row ? normalizeSource(row) : null
}

function nextSortOrder(sources) {
  return sources.reduce((m, s) => Math.max(m, Number(s.sort_order) || 0), 0) + 1
}

export function upsertLxSource({
  name,
  version,
  author,
  homepage,
  scriptUrl,
  script,
  description,
}) {
  const store = readStore()
  const stamp = nowIso()
  const idx = store.sources.findIndex((s) => s.name === name)

  // LX-aligned: persist header + script only (no platforms/qualitys on disk)
  const base = {
    kind: 'lx',
    version: version || null,
    author: author || null,
    homepage: homepage || null,
    script_url: scriptUrl || null,
    script,
    description: description || null,
    enabled: true,
    updated_at: stamp,
  }

  if (idx >= 0) {
    const prev = store.sources[idx]
    store.sources[idx] = {
      id: prev.id,
      name,
      sort_order: prev.sort_order,
      created_at: prev.created_at,
      ...base,
    }
    writeStore(store)
    return getSource(prev.id)
  }

  const id = store.nextId++
  store.sources.push({
    id,
    name,
    ...base,
    sort_order: nextSortOrder(store.sources),
    created_at: stamp,
  })
  writeStore(store)
  return getSource(id)
}

export function setSourceEnabled(id, enabled) {
  const store = readStore()
  const sid = Number(id)
  const row = store.sources.find((s) => Number(s.id) === sid)
  if (!row) return null
  row.enabled = Boolean(enabled)
  row.updated_at = nowIso()
  writeStore(store)
  return getSource(sid)
}

/** Persist display / default order. `ids` is the full ordered list of source ids. */
export function reorderSources(ids) {
  const list = Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isFinite(n) && n > 0) : []
  if (!list.length) throw new Error('排序列表为空')
  const store = readStore()
  const existing = new Set(store.sources.map((s) => Number(s.id)))
  if (list.length !== existing.size || list.some((id) => !existing.has(id))) {
    throw new Error('排序列表与现有音源不匹配')
  }
  const stamp = nowIso()
  const byId = new Map(store.sources.map((s) => [Number(s.id), s]))
  list.forEach((id, i) => {
    const row = byId.get(id)
    row.sort_order = i + 1
    row.updated_at = stamp
  })
  writeStore(store)
  return listSources()
}

export function deleteSource(id) {
  const store = readStore()
  const sid = Number(id)
  const before = store.sources.length
  store.sources = store.sources.filter((s) => Number(s.id) !== sid)
  if (store.sources.length === before) return false
  writeStore(store)
  return true
}
