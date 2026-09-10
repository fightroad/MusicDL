/**
 * Built-in metadata search for LX platforms.
 * Play URLs come from the imported LX custom-source script.
 */

const PLATFORM_META = {
  kw: { key: 'kw', name: '小蜗音乐', short: '小蜗' },
  kg: { key: 'kg', name: '小枸音乐', short: '小枸' },
  tx: { key: 'tx', name: '小秋音乐', short: '小秋' },
  wy: { key: 'wy', name: '小芸音乐', short: '小芸' },
  mg: { key: 'mg', name: '小蜜音乐', short: '小蜜' },
}

const PLATFORM_ORDER = ['kw', 'kg', 'tx', 'wy', 'mg']

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    throw new Error('接口返回了网页而非数据（可能被拦截或接口变更）')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('接口数据解析失败')
  }
}

const QUALITY_RANK = ['128k', '192k', '320k', 'flac', 'flac24bit']

function normalizeQualityKey(q) {
  const key = String(q || '').trim()
  if (key === '24bit') return 'flac24bit'
  return key
}

function bestQuality(list) {
  let best = ''
  let rank = -1
  for (const q of list || []) {
    const i = QUALITY_RANK.indexOf(normalizeQualityKey(q))
    if (i > rank) {
      rank = i
      best = q
    }
  }
  return best
}

/** Short tags like LX list: SQ / HQ / 24bit（不展示 128k） */
function qualityTag(quality) {
  const map = {
    flac24bit: '24bit',
    '24bit': '24bit',
    flac: 'SQ',
    '320k': 'HQ',
  }
  return map[normalizeQualityKey(quality)] || map[quality] || ''
}

/**
 * Kuwo N_MINFO example:
 * level:zply,bitrate:20900,format:mflac,...;level:ff,bitrate:2000,format:flac,...;level:p,bitrate:320,format:mp3,...
 */
function parseKwQualities(minfo) {
  const text = String(minfo || '')
  if (!text) return []
  const found = []
  if (/level:(?:hires|zply|zpga\d*|dtsx)|format:mflac/i.test(text)) found.push('flac24bit')
  if (/format:flac|level:ff|level:flac/i.test(text)) found.push('flac')
  if (/bitrate:320/.test(text)) found.push('320k')
  if (/bitrate:128/.test(text)) found.push('128k')
  return found
}

function song({ id, name, artist, album, duration, cover, platform, qualitys, extra }) {
  const qs = (qualitys || []).filter(Boolean)
  const uniq = [...new Set(qs)]
  const q = bestQuality(uniq)
  return {
    id: String(id),
    name: name || '未知',
    artist: artist || '',
    album: album || '',
    duration: Number(duration) || 0,
    cover: cover || null,
    platform,
    platform_name: PLATFORM_META[platform]?.name || platform,
    qualitys: uniq,
    quality: q,
    quality_tag: qualityTag(q),
    extra: extra || {},
  }
}

/** Cap displayed quality by what the LX source declares for that platform */
export function decorateListQualities(list, sourceQualitys, platformQualitys = null) {
  const fallbackAllowed = new Set(
    String(sourceQualitys || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
  return (list || []).map((item) => {
    const platformQs = platformQualitys?.[item.platform]
    const allowed = new Set(
      Array.isArray(platformQs) && platformQs.length ? platformQs : [...fallbackAllowed]
    )
    const available = item.qualitys?.length ? item.qualitys : item.quality ? [item.quality] : []
    const capped = allowed.size
      ? available
          .map((q) => matchAllowedQuality(q, allowed))
          .filter(Boolean)
      : available
    const uniq = [...new Set(capped)]
    const q = bestQuality(uniq)
    return {
      ...item,
      qualitys: uniq,
      quality: q,
      quality_tag: qualityTag(q),
    }
  })
}

/** Return the allowed key (prefer platform spelling) if song quality is permitted. */
function matchAllowedQuality(songQ, allowedSet) {
  const list = [...allowedSet]
  const want = normalizeQualityKey(songQ)
  const hit = list.find((a) => normalizeQualityKey(a) === want)
  return hit || null
}

async function searchKw(keyword, page, limit) {
  const url =
    'https://search.kuwo.cn/r.s?' +
    new URLSearchParams({
      client: 'kt',
      all: keyword,
      pn: String(page - 1),
      rn: String(limit),
      uid: '794762570',
      ver: 'kwplayer_ar_99.99.99.99',
      vipver: '1',
      newver: '1',
      ft: 'music',
      cluster: '0',
      strategy: '2012',
      encoding: 'utf8',
      rformat: 'json',
      vermerge: '1',
      mobi: '1',
    }).toString()
  const data = await fetchJson(url)
  const list = data.abslist || []
  return {
    total: Number(data.TOTAL || data.total || list.length),
    list: list.map((item) => {
      const qualitys = parseKwQualities(item.N_MINFO || item.MINFO)
      return song({
        id: item.MUSICRID?.replace('MUSIC_', '') || item.DC_TARGETID || item.rid,
        name: item.NAME || item.SONGNAME,
        artist: item.ARTIST || item.artist,
        album: item.ALBUM || item.album,
        duration: Number(item.DURATION || item.duration || 0),
        cover: item.web_albumpic_short
          ? `https://img2.kuwo.cn/star/albumcover/${item.web_albumpic_short}`
          : null,
        platform: 'kw',
        qualitys: qualitys.length ? qualitys : ['128k'],
        extra: {
          songmid: String(item.MUSICRID?.replace('MUSIC_', '') || item.DC_TARGETID || ''),
          hash: item.N_MINFO || '',
          albumId: item.ALBUMID,
        },
      })
    }),
  }
}

async function searchWy(keyword, page, limit) {
  const offset = (page - 1) * limit
  const url = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=1&limit=${limit}&offset=${offset}`
  const data = await fetchJson(url, {
    headers: { Referer: 'https://music.163.com/' },
  })
  const result = data.result || {}
  const list = result.songs || []
  return {
    total: Number(result.songCount || list.length),
    list: list.map((item) => {
      const qualitys = []
      if (item.hr) qualitys.push('flac24bit')
      if (item.sq) qualitys.push('flac')
      if (item.h) qualitys.push('320k')
      if (item.m || item.l) qualitys.push('128k')
      return song({
        id: item.id,
        name: item.name,
        artist: (item.ar || item.artists || []).map((a) => a.name).join(' / '),
        album: item.al?.name || item.album?.name || '',
        duration: Math.round((item.dt || item.duration || 0) / 1000),
        cover: item.al?.picUrl || item.album?.picUrl || null,
        platform: 'wy',
        qualitys: qualitys.length ? qualitys : ['128k'],
        extra: { songmid: String(item.id) },
      })
    }),
  }
}

/** LX-style kg quality maps (scripts often pick hash via _qualitys[type].hash). */
function buildKgQualityInfo(item) {
  const pairs = [
    ['128k', item.FileHash],
    ['320k', item.HQFileHash],
    ['flac', item.SQFileHash],
    ['flac24bit', item.ResFileHash || item.HiResFileHash],
  ]
  const qualityKeys = []
  const qualitys = []
  const _qualitys = {}
  for (const [type, hash] of pairs) {
    if (!hash) continue
    qualityKeys.push(type)
    qualitys.push({ type, size: null, hash })
    _qualitys[type] = { size: null, hash }
  }
  if (!qualityKeys.length && item.FileHash) {
    qualityKeys.push('128k')
    qualitys.push({ type: '128k', size: null, hash: item.FileHash })
    _qualitys['128k'] = { size: null, hash: item.FileHash }
  }
  return { qualityKeys, qualitys, _qualitys }
}

async function searchKg(keyword, page, limit) {
  const url =
    'https://complexsearch.kugou.com/v2/search/song?' +
    new URLSearchParams({
      keyword,
      page: String(page),
      pagesize: String(limit),
      userid: '0',
      clientver: '2000',
      platform: 'WebFilter',
      iscorrection: '1',
      privilege_filter: '0',
      filter: '10',
    }).toString()
  const data = await fetchJson(url)
  const lists = data.data?.lists || []
  return {
    total: Number(data.data?.total || lists.length),
    list: lists.map((item) => {
      const { qualityKeys, qualitys, _qualitys } = buildKgQualityInfo(item)
      return song({
        id: item.FileHash || item.EMixSongID || item.ID,
        name: item.SongName || item.OriSongName,
        artist: item.SingerName,
        album: item.AlbumName,
        duration: Number(item.Duration || 0),
        cover: item.Image?.replace('{size}', '240') || null,
        platform: 'kg',
        qualitys: qualityKeys.length ? qualityKeys : ['128k'],
        extra: {
          songmid: item.FileHash || item.EMixSongID,
          hash: item.FileHash,
          albumId: item.AlbumID,
          albumAudioId: item.AlbumAudioId || item.AudioId || undefined,
          qualitys,
          _qualitys,
        },
      })
    }),
  }
}

/** 咪咕 */
async function searchMg(keyword, page, limit) {
  const url =
    'https://m.music.migu.cn/migu/remoting/scr_search_tag?' +
    new URLSearchParams({
      rows: String(limit),
      type: '2',
      keyword,
      pgc: String(page),
    }).toString()
  const data = await fetchJson(url, {
    headers: { Referer: 'https://m.music.migu.cn/' },
  })
  const list = data.musics || []
  return {
    total: Number(data.pgt || list.length),
    list: list.map((item) => {
      const qualitys = ['128k']
      if (item.hqSongId || item.hasHq) qualitys.push('320k')
      if (item.sqSongId || item.hasSq) qualitys.push('flac')
      return song({
        id: item.copyrightId || item.id,
        name: item.songName,
        artist: item.singerName,
        album: item.albumName,
        duration: 0,
        cover: item.cover || item.picUrl || null,
        platform: 'mg',
        qualitys,
        extra: {
          songmid: item.copyrightId || item.id,
          copyrightId: item.copyrightId || item.id,
          contentId: item.contentId || item.copyrightId || item.id,
        },
      })
    }),
  }
}

function parseTxQualities(file = {}) {
  const qualitys = []
  if (file.size_128mp3 > 0 || file.size_96aac > 0 || file.size_48aac > 0) qualitys.push('128k')
  if (file.size_320mp3 > 0) qualitys.push('320k')
  if (file.size_flac > 0 || file.size_ape > 0) qualitys.push('flac')
  if (file.size_hires > 0 || file.hires_sample > 0) qualitys.push('flac24bit')
  return qualitys.length ? qualitys : ['128k']
}

function normalizeTxSongList(itemSong) {
  if (!itemSong) return []
  if (Array.isArray(itemSong)) return itemSong
  if (Array.isArray(itemSong.list)) return itemSong.list
  return Object.values(itemSong).filter(
    (x) => x && typeof x === 'object' && (x.mid || x.id)
  )
}

/** QQ / 小秋 — 优先移动端（UA 需带 QQMusic），失败再试桌面端 */
async function searchTx(keyword, page, limit) {
  const attempts = [
    {
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://y.qq.com/',
        Origin: 'https://y.qq.com',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QQMusic',
      },
      body: {
        comm: {
          ct: 11,
          cv: '1003006',
          v: '1003006',
          os_ver: '16',
          phonetype: '0',
          tmeAppID: 'qqmusic',
          nettype: 'NETWORK_WIFI',
          udid: '0',
        },
        req_0: {
          method: 'DoSearchForQQMusicMobile',
          module: 'music.search.SearchCgiService',
          param: {
            remoteplace: 'txt.mqq.all',
            searchid: `${Date.now()}${Math.floor(Math.random() * 1e6)}`,
            search_type: 0,
            query: keyword,
            page_num: page,
            num_per_page: limit,
            grp: 1,
          },
        },
      },
      pick: (data) => data.req_0,
      songs: (block) => normalizeTxSongList(block?.data?.body?.item_song),
      total: (block, list) =>
        Number(block?.data?.meta?.sum || block?.data?.meta?.estimate_sum || list.length),
    },
    {
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        Referer: 'https://y.qq.com/portal/search.html',
        Origin: 'https://y.qq.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      body: {
        comm: { ct: '19', cv: '1859', uin: '0' },
        req_0: {
          method: 'DoSearchForQQMusicDesktop',
          module: 'music.search.SearchCgiService',
          param: {
            remoteplace: 'txt.yqq.center',
            searchid: `${Date.now()}${Math.floor(Math.random() * 1e6)}`,
            search_type: 0,
            query: keyword,
            page_num: page,
            num_per_page: limit,
            grp: 1,
          },
        },
      },
      pick: (data) => data.req_0,
      songs: (block) =>
        normalizeTxSongList(block?.data?.body?.song || block?.data?.body?.item_song),
      total: (block, list) =>
        Number(
          block?.data?.body?.song?.totalnum ||
            block?.data?.body?.song?.total ||
            block?.data?.meta?.sum ||
            list.length
        ),
    },
  ]

  let lastError = null
  for (const attempt of attempts) {
    try {
      const data = await fetchJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: attempt.headers,
        body: JSON.stringify(attempt.body),
      })
      if (data.code != null && data.code !== 0) {
        throw new Error(`code ${data.code}`)
      }
      const block = attempt.pick(data)
      if (!block || block.code !== 0) {
        throw new Error(`code ${block?.code ?? 'unknown'}`)
      }
      const list = attempt.songs(block)
      if (!list.length) {
        throw new Error('empty')
      }
      const total = attempt.total(block, list)
      return {
        total,
        list: list.map((item) => {
          const albumMid = item.album?.mid || ''
          const songmid = item.mid || String(item.id)
          const artists = Array.isArray(item.singer)
            ? item.singer.map((s) => s.name).filter(Boolean).join(' / ')
            : String(item.singer || item.author || '')
          return song({
            id: songmid,
            name: item.name || item.title,
            artist: artists,
            album: item.album?.name || item.album?.title || '',
            duration: Number(item.interval) || 0,
            cover: albumMid
              ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
              : null,
            platform: 'tx',
            qualitys: parseTxQualities(item.file || {}),
            extra: {
              songmid,
              strMediaMid: item.file?.media_mid || songmid,
              albumMid,
              albumId: item.album?.id,
            },
          })
        }),
      }
    } catch (err) {
      lastError = err
    }
  }

  throw new Error(`QQ 搜索失败: ${lastError?.message || 'unknown'}`)
}

const adapters = {
  kw: searchKw,
  kg: searchKg,
  tx: searchTx,
  wy: searchWy,
  mg: searchMg,
}

export function listPlatformTabs(platforms) {
  const keys = (platforms || [])
    .map((p) => String(p).trim())
    .filter((k) => k && adapters[k])
  const ordered = PLATFORM_ORDER.filter((k) => keys.includes(k))
  return ordered.map((key) => ({
    key,
    name: PLATFORM_META[key].name,
    searchable: true,
  }))
}

async function fetchPlatformResults(platform, keyword, page = 1, limit = 20) {
  const fn = adapters[platform]
  if (!fn) {
    throw new Error(
      `暂不支持「${PLATFORM_META[platform]?.name || platform}」的搜索（仍可用于取链）`
    )
  }
  return fn(keyword, page, limit)
}

/** Search one platform among the source's enabled platforms. */
export async function searchPlatform(platforms, keyword, page = 1, limit = 20, platform) {
  const order = (platforms || []).filter((p) => adapters[p])
  if (!order.length) {
    throw new Error('当前音源没有可搜索的平台')
  }
  if (platform && !order.includes(platform)) {
    throw new Error(`当前音源未启用或不支持搜索该平台: ${platform}`)
  }
  const target = platform || order[0]
  const result = await fetchPlatformResults(target, keyword, page, limit)
  return { ...result, platform: target }
}
