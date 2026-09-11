import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { DOWNLOAD_DIR, getSource } from '../db.js'
import { embedDownloadMetaBuffer, extractEmbeddedCover } from '../media/embedMeta.js'
import {
  getSourcePlatformTabs,
  resolveWithSource,
  searchWithSource,
} from '../sources/factory.js'
import { fetchPlatformLyric } from '../sources/platformLyric.js'
import { tipSearchPlatform } from '../sources/platformTipSearch.js'

const router = Router()

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

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

/** Final path: 歌曲名 - 艺术家.ext（同名则跳过，对齐洛雪 skipExistFile） */
function buildSavePath(songName, ext) {
  const base = safeName(songName)
  const filename = `${base}.${ext}`
  const fullPath = path.join(DOWNLOAD_DIR, filename)
  return { filename, fullPath, exists: fs.existsSync(fullPath) }
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

/** LX-style tipSearch suggestions for the current platform tab. */
router.get('/suggest', async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim()
    const platform = String(req.query.platform || '').trim() || 'kw'
    if (!keyword) return res.json({ list: [] })
    const list = await tipSearchPlatform(platform, keyword)
    res.json({ list, platform })
  } catch (e) {
    res.status(e.status || 502).json({ detail: e.message || String(e) })
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
    const { filename, fullPath, exists } = buildSavePath(title, ext)
    if (exists) {
      return res.json({ ok: true, skipped: true, filename, quality: q })
    }
    const plat = platform || 'kw'

    const [upstream, lyric] = await Promise.all([
      fetch(result.url, {
        headers: { 'User-Agent': BROWSER_UA },
        redirect: 'follow',
      }),
      fetchPlatformLyric(plat, {
        songId: song_id,
        extra: extra || {},
        duration: extra?.duration,
      }),
    ])
    if (!upstream.ok) {
      return res.status(502).json({ detail: `下载上游失败: HTTP ${upstream.status}` })
    }

    const buf = Buffer.from(await upstream.arrayBuffer())
    const { buffer: outBuf, embeddedCover, embeddedLyric } = await embedDownloadMetaBuffer(
      buf,
      ext,
      {
        coverUrl: extra?.cover,
        title: name,
        artist,
        album,
        lyric,
      }
    )
    if (fs.existsSync(fullPath)) {
      return res.json({ ok: true, skipped: true, filename, quality: q })
    }
    const tmpPath = `${fullPath}.partial`
    try {
      fs.writeFileSync(tmpPath, outBuf)
      fs.renameSync(tmpPath, fullPath)
    } catch (e) {
      try {
        fs.unlinkSync(tmpPath)
      } catch (_) {}
      throw e
    }

    res.json({
      ok: true,
      filename,
      quality: q,
      size: outBuf.length,
      embedded_cover: embeddedCover,
      embedded_lyric: embeddedLyric,
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
    headers: { 'User-Agent': BROWSER_UA },
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

function listDownloadFiles() {
  if (!fs.existsSync(DOWNLOAD_DIR)) return []
  return fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((name) => !name.endsWith('.partial'))
    .map((filename) => {
      const fullPath = path.join(DOWNLOAD_DIR, filename)
      let st
      try {
        st = fs.statSync(fullPath)
      } catch (_) {
        return null
      }
      if (!st.isFile()) return null
      return {
        filename,
        size: st.size,
        mtime: st.mtimeMs,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
}

function resolveDownloadFile(filename) {
  const raw = String(filename || '')
  const base = path.basename(raw)
  if (!base || base === '.' || base === '..' || base.endsWith('.partial') || /[/\\]/.test(raw)) {
    const err = new Error('无效文件名')
    err.status = 400
    throw err
  }
  const fullPath = path.join(DOWNLOAD_DIR, base)
  if (path.dirname(path.resolve(fullPath)) !== path.resolve(DOWNLOAD_DIR)) {
    const err = new Error('无效文件名')
    err.status = 400
    throw err
  }
  return { filename: base, fullPath }
}

router.get('/files', (_req, res) => {
  try {
    res.json({ list: listDownloadFiles() })
  } catch (e) {
    res.status(e.status || 500).json({ detail: e.message || String(e) })
  }
})

function contentTypeForFile(filename) {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.flac') return 'audio/flac'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.wav') return 'audio/wav'
  return 'application/octet-stream'
}

function streamLocalFile(req, res, fullPath, filename) {
  const total = fs.statSync(fullPath).size
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', contentTypeForFile(filename))
  res.setHeader('Cache-Control', 'private, max-age=3600')

  const range = req.headers.range
  let start = 0
  let end = total - 1
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range)
    if (!m) {
      res.setHeader('Content-Range', `bytes */${total}`)
      return res.status(416).end()
    }
    start = Number(m[1])
    end = m[2] ? Number(m[2]) : total - 1
    if (Number.isNaN(start) || start >= total || end >= total || start > end) {
      res.setHeader('Content-Range', `bytes */${total}`)
      return res.status(416).end()
    }
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
  }
  res.setHeader('Content-Length', String(end - start + 1))
  const stream = fs.createReadStream(fullPath, { start, end })
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end()
    else res.destroy()
  })
  stream.pipe(res)
}

router.get('/files/:filename/cover', (req, res) => {
  try {
    const { fullPath } = resolveDownloadFile(decodeURIComponent(req.params.filename || ''))
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ detail: '文件不存在' })
    }
    const cover = extractEmbeddedCover(fullPath)
    if (!cover) {
      return res.status(404).json({ detail: '无封面' })
    }
    const st = fs.statSync(fullPath)
    res.setHeader('Content-Type', cover.mime)
    res.setHeader('Content-Length', String(cover.buf.length))
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('Last-Modified', st.mtime.toUTCString())
    res.end(cover.buf)
  } catch (e) {
    res.status(e.status || 500).json({ detail: e.message || String(e) })
  }
})

router.get('/files/:filename', (req, res) => {
  try {
    const { filename, fullPath } = resolveDownloadFile(decodeURIComponent(req.params.filename || ''))
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ detail: '文件不存在' })
    }
    streamLocalFile(req, res, fullPath, filename)
  } catch (e) {
    res.status(e.status || 500).json({ detail: e.message || String(e) })
  }
})

router.delete('/files/:filename', (req, res) => {
  try {
    const { filename, fullPath } = resolveDownloadFile(decodeURIComponent(req.params.filename || ''))
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ detail: '文件不存在' })
    }
    fs.unlinkSync(fullPath)
    res.json({ ok: true, filename })
  } catch (e) {
    res.status(e.status || 500).json({ detail: e.message || String(e) })
  }
})

export default router
