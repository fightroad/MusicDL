import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
export const DATA_DIR = path.join(ROOT, 'data')
export const DOWNLOAD_DIR = path.join(DATA_DIR, 'downloads')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

const dbPath = path.join(DATA_DIR, 'musicdl.db')
export const db = new DatabaseSync(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS music_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'lx',
    version TEXT,
    author TEXT,
    homepage TEXT,
    script_url TEXT,
    script TEXT,
    platforms TEXT DEFAULT 'kw,kg,tx,wy,mg',
    qualitys TEXT DEFAULT '128k,320k',
    platform_qualitys TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`)

export function listSources() {
  return db
    .prepare(
      `SELECT id, name, kind, version, author, homepage, script_url, platforms, qualitys,
              platform_qualitys, enabled, description, sort_order, created_at, updated_at,
              CASE WHEN script IS NOT NULL AND script != '' THEN 1 ELSE 0 END AS has_script
       FROM music_sources ORDER BY sort_order ASC, id ASC`
    )
    .all()
    .map(normalizeSource)
}

export function getSource(id) {
  const row = db.prepare('SELECT * FROM music_sources WHERE id = ?').get(id)
  return row ? normalizeSource(row) : null
}

/** Public API shape without dumping huge scripts */
export function toPublicSource(row) {
  if (!row) return null
  const { script, ...rest } = row
  return {
    ...rest,
    enabled: Boolean(rest.enabled),
    hasScript: Boolean(script || rest.has_script || rest.hasScript),
    platformQualitys: rest.platformQualitys || null,
  }
}

export function getSourceByName(name) {
  const row = db.prepare('SELECT * FROM music_sources WHERE name = ?').get(name)
  return row ? normalizeSource(row) : null
}

function nextSortOrder() {
  const row = db.prepare('SELECT MAX(sort_order) AS m FROM music_sources').get()
  return (Number(row?.m) || 0) + 1
}

export function upsertLxSource({
  name,
  version,
  author,
  homepage,
  scriptUrl,
  script,
  platforms,
  qualitys,
  platformQualitys,
  description,
}) {
  const pqJson =
    platformQualitys && typeof platformQualitys === 'object'
      ? JSON.stringify(platformQualitys)
      : null
  const existing = getSourceByName(name)
  if (existing) {
    db.prepare(
      `UPDATE music_sources SET
        kind='lx', version=@version, author=@author, homepage=@homepage,
        script_url=@scriptUrl, script=@script, platforms=@platforms, qualitys=@qualitys,
        platform_qualitys=@platformQualitys,
        description=@description, enabled=1, updated_at=datetime('now')
       WHERE id=@id`
    ).run({
      id: existing.id,
      version: version || null,
      author: author || null,
      homepage: homepage || null,
      scriptUrl: scriptUrl || null,
      script,
      platforms: platforms.join(','),
      qualitys: qualitys.join(','),
      platformQualitys: pqJson,
      description: description || null,
    })
    return getSource(existing.id)
  }

  const info = db
    .prepare(
      `INSERT INTO music_sources
        (name, kind, version, author, homepage, script_url, script, platforms, qualitys,
         platform_qualitys, enabled, description, sort_order)
       VALUES
        (@name, 'lx', @version, @author, @homepage, @scriptUrl, @script, @platforms, @qualitys,
         @platformQualitys, 1, @description, @sortOrder)`
    )
    .run({
      name,
      version: version || null,
      author: author || null,
      homepage: homepage || null,
      scriptUrl: scriptUrl || null,
      script,
      platforms: platforms.join(','),
      qualitys: qualitys.join(','),
      platformQualitys: pqJson,
      description: description || null,
      sortOrder: nextSortOrder(),
    })
  return getSource(Number(info.lastInsertRowid))
}

export function setSourceEnabled(id, enabled) {
  db.prepare(
    `UPDATE music_sources SET enabled = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(enabled ? 1 : 0, id)
  return getSource(id)
}

/** Persist display / default order. `ids` is the full ordered list of source ids. */
export function reorderSources(ids) {
  const list = Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isFinite(n) && n > 0) : []
  if (!list.length) throw new Error('排序列表为空')
  const existing = new Set(listSources().map((s) => s.id))
  if (list.length !== existing.size || list.some((id) => !existing.has(id))) {
    throw new Error('排序列表与现有音源不匹配')
  }
  db.exec('BEGIN')
  try {
    list.forEach((id, i) => {
      db.prepare(
        `UPDATE music_sources SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(i + 1, id)
    })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return listSources()
}

export function deleteSource(id) {
  const item = getSource(id)
  if (!item) return false
  db.prepare('DELETE FROM music_sources WHERE id = ?').run(id)
  return true
}

function parsePlatformQualitys(raw) {
  if (!raw) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeSource(row) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    hasScript: Boolean(row.script || row.has_script || row.hasScript),
    platformQualitys: parsePlatformQualitys(row.platform_qualitys),
  }
}
