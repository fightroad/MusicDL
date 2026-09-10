/**
 * Built-in lyric fetch for platforms (same idea as LX shell, not custom-source).
 * Returns plain LRC text or null.
 */

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(10000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return text
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options)
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<')) throw new Error('非 JSON 响应')
  return JSON.parse(text)
}

function cleanLyric(text) {
  const s = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\uFEFF/, '')
    .trim()
  if (!s) return null
  // 纯空白或明显无词
  if (/^(\[\d+:\d+[^\]]*\]\s*)+$/m.test(s) && !/[\u4e00-\u9fffA-Za-z]/.test(s)) return null
  return s
}

function kuwoListToLrc(list) {
  if (!Array.isArray(list) || !list.length) return null
  const lines = list
    .map((item) => {
      const sec = Number(item.time)
      if (!Number.isFinite(sec)) return null
      const m = Math.floor(sec / 60)
      const s = sec - m * 60
      const mm = String(m).padStart(2, '0')
      const ss = s.toFixed(2).padStart(5, '0')
      const text = String(item.lineLyric || '').trim()
      if (!text) return null
      return `[${mm}:${ss}]${text}`
    })
    .filter(Boolean)
  return cleanLyric(lines.join('\n'))
}

async function lyricWy(songId) {
  const id = String(songId || '').trim()
  if (!id) return null
  const data = await fetchJson(
    `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=-1`,
    { headers: { Referer: 'https://music.163.com/' } }
  )
  return cleanLyric(data?.lrc?.lyric)
}

async function lyricKw(songId) {
  const id = String(songId || '').replace(/^MUSIC_/, '').trim()
  if (!id) return null
  const data = await fetchJson(
    `https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${encodeURIComponent(id)}`,
    { headers: { Referer: `https://www.kuwo.cn/play_detail/${id}` } }
  )
  return kuwoListToLrc(data?.data?.lrclist)
}

async function lyricTx(songmid) {
  const mid = String(songmid || '').trim()
  if (!mid) return null
  const url =
    'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?' +
    new URLSearchParams({
      songmid: mid,
      g_tk: '5381',
      format: 'json',
      nobase64: '1',
      platform: 'yqq.json',
    }).toString()
  const data = await fetchJson(url, { headers: { Referer: 'https://y.qq.com/' } })
  if (data?.lyric) return cleanLyric(data.lyric)
  if (data?.lyric_txt) return cleanLyric(data.lyric_txt)
  return null
}

async function lyricKg(hash, durationSec = 0) {
  const h = String(hash || '').trim()
  if (!h) return null
  const searchUrl =
    'https://lyrics.kugou.com/search?' +
    new URLSearchParams({
      ver: '1',
      man: 'yes',
      client: 'pc',
      keyword: '',
      duration: String(Math.round(Number(durationSec) * 1000) || ''),
      hash: h,
    }).toString()
  const search = await fetchJson(searchUrl)
  const cand = search?.candidates?.[0]
  if (!cand?.id || !cand?.accesskey) return null
  const dlUrl =
    'https://lyrics.kugou.com/download?' +
    new URLSearchParams({
      ver: '1',
      client: 'pc',
      id: String(cand.id),
      accesskey: String(cand.accesskey),
      fmt: 'lrc',
      charset: 'utf8',
    }).toString()
  const dl = await fetchJson(dlUrl)
  const content = dl?.content
  if (!content) return null
  try {
    return cleanLyric(Buffer.from(content, 'base64').toString('utf8'))
  } catch {
    return cleanLyric(content)
  }
}

async function lyricMg(copyrightId) {
  const id = String(copyrightId || '').trim()
  if (!id) return null
  const urls = [
    `https://music.migu.cn/v3/api/music/audioPlayer/getLyric?copyrightId=${encodeURIComponent(id)}`,
    `https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/lyric/get.do?copyrightId=${encodeURIComponent(id)}&resourceType=2`,
  ]
  for (const url of urls) {
    try {
      const text = await fetchText(url, {
        headers: {
          Referer: 'https://m.music.migu.cn/',
          channel: '0146951',
        },
      })
      if (text.trim().startsWith('<')) continue
      const data = JSON.parse(text)
      const lyric = data?.lyric || data?.data?.lyric || data?.data?.lrc
      const cleaned = cleanLyric(lyric)
      if (cleaned) return cleaned
    } catch {
      // try next
    }
  }
  return null
}

/** @returns {Promise<string|null>} LRC text */
export async function fetchPlatformLyric(platform, { songId, extra, duration } = {}) {
  const p = String(platform || '').toLowerCase()
  const id = extra?.songmid || songId
  try {
    switch (p) {
      case 'wy':
        return await lyricWy(id)
      case 'kw':
        return await lyricKw(id)
      case 'tx':
        return await lyricTx(id)
      case 'kg':
        return await lyricKg(extra?.hash || id, duration || extra?.duration || 0)
      case 'mg':
        return await lyricMg(extra?.contentId || extra?.copyrightId || id)
      default:
        return null
    }
  } catch (err) {
    console.warn(`[lyric:${p}]`, err?.message || err)
    return null
  }
}
