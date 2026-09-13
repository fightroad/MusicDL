/**
 * Fetch latest LX script pack from a GitHub Releases zip and list/import scripts.
 */
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { dropRuntime, parseLxMeta } from '../lx/host.js'
import { listSources, upsertLxSource, toPublicSource } from '../db.js'

const DEFAULT_REPO = 'guoyue2010/lxmusic-'
const UA = 'MusicDL/0.3 (https://github.com/fightroad/MusicDL)'

/** @type {{ tag: string, publishedAt: string|null, scripts: Map<string, object>, fetchedAt: number } | null} */
let bundleCache = null

function repoSlug() {
  return String(process.env.LX_BUNDLE_REPO || DEFAULT_REPO).trim() || DEFAULT_REPO
}

function githubToken() {
  return String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
}

function githubHeaders({ accept = 'application/vnd.github+json' } = {}) {
  const headers = {
    Accept: accept,
    'User-Agent': UA,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = githubToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function makeKey(filename, script) {
  return crypto.createHash('sha1').update(`${filename}\0${script}`).digest('hex').slice(0, 16)
}

function existingNames() {
  const map = new Map()
  for (const s of listSources()) {
    const name = String(s.name || '').trim().toLowerCase()
    if (!name) continue
    map.set(name, s)
  }
  return map
}

async function githubJson(url) {
  const res = await fetch(url, {
    headers: githubHeaders(),
    redirect: 'follow',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub API 失败: HTTP ${res.status}${text ? ` · ${text.slice(0, 120)}` : ''}`)
  }
  return res.json()
}

function pickZipAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const zips = assets.filter((a) => /\.zip$/i.test(a?.name || ''))
  if (!zips.length) {
    throw new Error('最新 Release 没有 zip 附件')
  }
  const tag = String(release.tag_name || '')
  const byTag = zips.find((a) => String(a.name).includes(tag))
  if (byTag) return byTag
  return zips.sort((a, b) => (b.size || 0) - (a.size || 0))[0]
}

function extractScriptsFromZip(buf) {
  const zip = new AdmZip(buf)
  const entries = zip.getEntries()
  const scripts = []
  const byName = new Map()

  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = String(entry.entryName || '').replace(/\\/g, '/')
    if (!/\.js$/i.test(name)) continue
    if (name.includes('__MACOSX/') || /(^|\/)\./.test(name)) continue

    let text
    try {
      text = entry.getData().toString('utf8')
    } catch {
      continue
    }
    if (!text || !String(text).trim()) continue

    let meta
    try {
      meta = parseLxMeta(text)
    } catch {
      continue
    }

    const key = makeKey(name, text)
    const item = {
      key,
      name: meta.name,
      version: meta.version,
      author: meta.author,
      description: meta.description,
      homepage: meta.homepage,
      script: text,
      depth: name.split('/').filter(Boolean).length,
    }

    const dupKey = meta.name.toLowerCase()
    const prev = byName.get(dupKey)
    // Prefer shallower path when same @name appears twice
    if (prev && item.depth >= prev.depth) continue
    byName.set(dupKey, item)
  }

  for (const item of byName.values()) {
    scripts.push(item)
  }
  scripts.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return scripts
}

function summarizeBundle(cache) {
  const have = existingNames()
  const scripts = [...cache.scripts.values()].map((s) => {
    const hit = have.get(String(s.name).toLowerCase())
    const imported = Boolean(hit)
    const packVer = String(s.version || '').trim()
    const localVer = String(hit?.version || '').trim()
    const updateAvailable =
      imported && Boolean(packVer || localVer) && packVer.toLowerCase() !== localVer.toLowerCase()
    return {
      key: s.key,
      name: s.name,
      version: s.version,
      author: s.author,
      imported,
      updateAvailable,
    }
  })
  return {
    tag: cache.tag,
    publishedAt: cache.publishedAt,
    scripts,
  }
}

export async function fetchLatestBundle({ force = false } = {}) {
  if (!force && bundleCache && Date.now() - bundleCache.fetchedAt < 5 * 60 * 1000) {
    return summarizeBundle(bundleCache)
  }

  const slug = repoSlug()
  const release = await githubJson(`https://api.github.com/repos/${slug}/releases/latest`)
  const asset = pickZipAsset(release)
  const zipUrl = asset.browser_download_url
  if (!zipUrl) throw new Error('无法获取 zip 下载地址')

  const zipRes = await fetch(zipUrl, {
    headers: githubHeaders({ accept: 'application/octet-stream' }),
    redirect: 'follow',
  })
  if (!zipRes.ok) {
    throw new Error(`下载音源包失败: HTTP ${zipRes.status}`)
  }
  const buf = Buffer.from(await zipRes.arrayBuffer())
  if (buf.length < 64) throw new Error('音源包内容无效')

  const scripts = extractScriptsFromZip(buf)
  if (!scripts.length) throw new Error('音源包中未找到有效的洛雪脚本（需含 @name）')

  const scriptMap = new Map(scripts.map((s) => [s.key, s]))
  bundleCache = {
    tag: String(release.tag_name || asset.name || 'latest'),
    publishedAt: release.published_at || null,
    scripts: scriptMap,
    fetchedAt: Date.now(),
  }

  return summarizeBundle(bundleCache)
}

export function importBundleScripts(keys) {
  if (!bundleCache) {
    const err = new Error('请先拉取最新音源包')
    err.status = 400
    throw err
  }
  const list = Array.isArray(keys) ? keys.map(String).filter(Boolean) : []
  if (!list.length) {
    const err = new Error('请选择要导入的音源')
    err.status = 400
    throw err
  }

  const imported = []
  const failed = []

  for (const key of list) {
    const item = bundleCache.scripts.get(key)
    if (!item) {
      failed.push({ key, error: '脚本不在当前音源包中，请重新拉取' })
      continue
    }
    try {
      const row = upsertLxSource({
        name: item.name,
        version: item.version,
        author: item.author,
        homepage: item.homepage,
        scriptUrl: null,
        script: item.script,
        description: item.description,
      })
      dropRuntime(row.id)
      imported.push(toPublicSource(row))
    } catch (e) {
      failed.push({ key, name: item.name, error: e.message || String(e) })
    }
  }

  return { imported, failed, importedCount: imported.length, failedCount: failed.length }
}
