import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { DOWNLOAD_DIR, getSource } from '../db.js'
import { embedDownloadMetaBuffer } from '../media/embedMeta.js'
import {
  getSourcePlatformTabs,
  resolveWithSource,
  searchWithSource,
} from '../sources/factory.js'

const router = Router()

function loadEnabledSource(id) {
  const item = getSource(Number(id))
  if (!item) {
    const err = new Error('音源不存在')
    err.status = 404
    throw err
  }
  if (!item.enabled) {
    const err = new Error('音源已禁用')
    err.status = 400
    throw err
  }
  return item
}

function safeName(name) {
  return String(name || 'track')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'track'
}

function extForQuality(quality, url = '') {
  const q = String(quality || '').toLowerCase()
  const u = String(url || '').toLowerCase()
  if (q.includes('flac') || /\.flac(\?|$)/.test(u)) return 'flac'
  if (/\.m4a(\?|$)/.test(u)) return 'm4a'
  if (/\.ape(\?|$)/.test(u)) return 'ape'
  if (/\.ogg(\?|$)/.test(u)) return 'ogg'
  if (/\.wav(\?|$)/.test(u)) return 'wav'
  return 'mp3'
}

/** Build unique path: 歌曲名 - 艺术家.mp3 / 歌曲名 - 艺术家 (2).mp3 */
function buildSavePath(songName, ext) {
  const base = safeName(songName)
  let filename = `${base}.${ext}`
  let full = path.join(DOWNLOAD_DIR, filename)
  let i = 2
  while (fs.existsSync(full)) {
    filename = `${base} (${i}).${ext}`
    full = path.join(DOWNLOAD_DIR, filename)
    i += 1
  }
  return { filename, fullPath: full }
}

router.get('/search', async (req, res) => {
  try {
    const sourceId = Number(req.query.source_id)
    const keyword = String(req.query.keyword || '').trim()
    const platform = String(req.query.platform || '').trim()
    const page = Math.max(Number(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
    if (!keyword) return res.status(400).json({ detail: '请输入关键词' })
    const source = loadEnabledSource(sourceId)
    const result = await searchWithSource(source, keyword, page, limit, platform || undefined)
    res.json({
      list: result.list,
      total: result.total,
      page,
      limit,
      platform: result.platform || platform,
      tabs: getSourcePlatformTabs(source),
    })
  } catch (e) {
    res.status(e.status || 502).json({ detail: e.message || String(e) })
  }
})

router.get('/platforms', (req, res) => {
  try {
    const source = loadEnabledSource(req.query.source_id)
    res.json({ tabs: getSourcePlatformTabs(source) })
  } catch (e) {
    res.status(e.status || 400).json({ detail: e.message || String(e) })
  }
})

router.post('/url', async (req, res) => {
  try {
    const { source_id, song_id, platform, quality, extra } = req.body || {}
    const source = loadEnabledSource(source_id)
    const result = await resolveWithSource(source, {
      songId: String(song_id),
      platform: platform || 'kw',
      quality: quality || '128k',
      extra: extra || {},
    })
    res.json({ url: result.url, quality: result.quality })
  } catch (e) {
    res.status(e.status || 502).json({ detail: e.message || String(e) })
  }
})

router.post('/download', async (req, res) => {
  try {
    const { source_id, song_id, platform, quality, extra } = req.body || {}
    const source = loadEnabledSource(source_id)
    const q = quality || '128k'
    const result = await resolveWithSource(source, {
      songId: String(song_id),
      platform: platform || 'kw',
      quality: q,
      extra: extra || {},
    })

    const name = String(extra?.name || song_id).trim() || String(song_id)
    const artist = String(extra?.artist || '').trim()
    const album = String(extra?.album || '').trim()
    const title = artist ? `${name} - ${artist}` : name
    const ext = extForQuality(q, result.url)
    const { filename, fullPath } = buildSavePath(title, ext)

    const upstream = await fetch(result.url, {
      headers: { 'User-Agent': 'MusicDL/0.1' },
      redirect: 'follow',
    })
    if (!upstream.ok) {
      return res.status(502).json({ detail: `下载上游失败: HTTP ${upstream.status}` })
    }

    const buf = Buffer.from(await upstream.arrayBuffer())
    const { buffer: outBuf, embedded } = await embedDownloadMetaBuffer(buf, ext, {
      coverUrl: extra?.cover,
      title: name,
      artist,
      album,
    })
    fs.writeFileSync(fullPath, outBuf)

    res.json({
      ok: true,
      filename,
      quality: q,
      size: outBuf.length,
      embedded_cover: embedded,
    })
  } catch (e) {
    res.status(e.status || 502).json({ detail: e.message || String(e) })
  }
})

/** In-memory audio cache so HTML5 player can seek via Range */
const audioCache = new Map()
const AUDIO_CACHE_MAX = 8

async function loadAudioBuffer(url) {
  const hit = audioCache.get(url)
  if (hit) {
    audioCache.delete(url)
    audioCache.set(url, hit) // LRU touch
    return hit
  }

  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'MusicDL/0.1' },
    redirect: 'follow',
  })
  if (!upstream.ok) {
    const err = new Error(`proxy failed: HTTP ${upstream.status}`)
    err.status = 502
    throw err
  }

  const buf = Buffer.from(await upstream.arrayBuffer())
  const contentType = upstream.headers.get('content-type') || 'audio/mpeg'
  const entry = { buf, contentType }
  audioCache.set(url, entry)
  while (audioCache.size > AUDIO_CACHE_MAX) {
    const oldest = audioCache.keys().next().value
    audioCache.delete(oldest)
  }
  return entry
}

router.get('/proxy', async (req, res) => {
  try {
    const url = String(req.query.url || '')
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ detail: 'invalid url' })
    }

    const { buf, contentType } = await loadAudioBuffer(url)
    const total = buf.length
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'private, max-age=3600')

    const range = req.headers.range
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range)
      if (!m) {
        res.setHeader('Content-Range', `bytes */${total}`)
        return res.status(416).end()
      }
      const start = Number(m[1])
      const end = m[2] ? Number(m[2]) : total - 1
      if (Number.isNaN(start) || start >= total || end >= total || start > end) {
        res.setHeader('Content-Range', `bytes */${total}`)
        return res.status(416).end()
      }
      res.status(206)
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
      res.setHeader('Content-Length', String(end - start + 1))
      return res.end(buf.subarray(start, end + 1))
    }

    res.setHeader('Content-Length', String(total))
    return res.end(buf)
  } catch (e) {
    res.status(e.status || 502).json({ detail: e.message || String(e) })
  }
})

export default router
