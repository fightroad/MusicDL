/**
 * Built-in metadata search for LX platforms.
 * Play URLs come from the imported LX custom-source script.
 */

import { createHash } from 'node:crypto'
import { eapiRequest } from './wyEapi.js'

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
 * Kuwo N_MINFO — align with LX musicSdk/kw (bitrate → type + size).
 * level:zply,bitrate:4000,format:mflac,size:71.05M;...
 */
const KW_MINFO_RE = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/gi

function parseKwQualities(minfo) {
  const text = String(minfo || '')
  const qualitys = []
  const sizes = {}
  if (!text) return { qualitys, sizes }
  let m
  KW_MINFO_RE.lastIndex = 0
  while ((m = KW_MINFO_RE.exec(text))) {
    const bitrate = m[2]
    const size = String(m[4] || '').toUpperCase()
    let type = null
    if (bitrate === '4000') type = 'flac24bit'
    else if (bitrate === '2000') type = 'flac'
    else if (bitrate === '320') type = '320k'
    else if (bitrate === '128') type = '128k'
    if (!type) continue
    if (!qualitys.includes(type)) qualitys.push(type)
    if (size) sizes[type] = size
  }
  return { qualitys, sizes }
}

/** LX decodeName — HTML entities in titles/artists (e.g. &amp; → &). */
function decodeName(str) {
  if (str == null || str === '') return ''
  const s = String(str)
  if (!s.includes('&')) return s
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16)
      return Number.isFinite(code) ? String.fromCharCode(code) : _
    })
}

/** Format byte length like LX sizeFormate → e.g. 4.55MB */
function sizeFormate(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)}KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)}MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

/** Normalize size token for UI: 4.55M → 4.55MB */
function displaySize(raw) {
  if (!raw) return ''
  const s = String(raw).trim().toUpperCase()
  if (!s) return ''
  if (/(?:KB|MB|GB|B)$/.test(s)) return s
  if (/K$/.test(s)) return `${s.slice(0, -1)}KB`
  if (/M$/.test(s)) return `${s.slice(0, -1)}MB`
  if (/G$/.test(s)) return `${s.slice(0, -1)}GB`
  return s
}

/** Build LX musicSdk types / _types from [{ type, size?, hash? }]. */
function buildLxTypes(entries = []) {
  const types = []
  const _types = {}
  const sizes = {}
  for (const e of entries) {
    if (!e?.type) continue
    const type = e.type
    const size = e.size ? displaySize(e.size) || String(e.size) : null
    const row = e.hash ? { type, size, hash: e.hash } : { type, size }
    types.push(row)
    _types[type] = e.hash ? { size, hash: e.hash } : { size }
    if (size) sizes[type] = size
  }
  return { types, _types, sizes, qualityKeys: types.map((t) => t.type) }
}

/** LX list-item fields scripts expect on musicInfo (+ aliases for older scripts). */
function lxExtra(platform, fields, types, _types) {
  return {
    source: platform,
    types: types || [],
    _types: _types || {},
    typeUrl: {},
    // older MusicDL / some scripts used qualitys/_qualitys
    qualitys: types || [],
    _qualitys: _types || {},
    ...fields,
  }
}

function filterLxTypes(extra, allowedKeys) {
  if (!extra || typeof extra !== 'object') return extra || {}
  const want = new Set((allowedKeys || []).map(normalizeQualityKey))
  const types = (extra.types || extra.qualitys || []).filter(
    (t) => t && want.has(normalizeQualityKey(t.type || t))
  )
  const _types = {}
  for (const key of allowedKeys || []) {
    const src =
      extra._types?.[key] ||
      extra._types?.[normalizeQualityKey(key)] ||
      extra._qualitys?.[key] ||
      extra._qualitys?.[normalizeQualityKey(key)]
    if (src) _types[key] = src
  }
  return {
    ...extra,
    types,
    _types,
    qualitys: types,
    _qualitys: _types,
  }
}

function song({ id, name, artist, album, duration, cover, platform, qualitys, qualitySizes, extra }) {
  const qs = (qualitys || []).filter(Boolean)
  const uniq = [...new Set(qs)]
  const q = bestQuality(uniq)
  const sizes = {}
  if (qualitySizes && typeof qualitySizes === 'object') {
    for (const key of uniq) {
      const raw = qualitySizes[key] ?? qualitySizes[normalizeQualityKey(key)]
      const shown = displaySize(raw)
      if (shown) sizes[key] = shown
    }
  }
  const baseExtra = extra || {}
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
    qualitySizes: sizes,
    quality: q,
    quality_tag: qualityTag(q),
    extra: {
      ...baseExtra,
      name: baseExtra.name || name || '未知',
      singer: baseExtra.singer || artist || '',
      albumName: baseExtra.albumName || album || '',
      img: baseExtra.img || cover || null,
      source: baseExtra.source || platform,
    },
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
    const prevSizes = item.qualitySizes || {}
    const qualitySizes = {}
    for (const key of uniq) {
      const raw = prevSizes[key] ?? prevSizes[normalizeQualityKey(key)]
      if (raw) qualitySizes[key] = raw
    }
    return {
      ...item,
      qualitys: uniq,
      qualitySizes,
      quality: q,
      quality_tag: qualityTag(q),
      extra: filterLxTypes(item.extra, uniq),
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

/** Align with LX kw musicSearch params + decodeName on titles. */
async function searchKw(keyword, page, limit) {
  const url =
    'https://search.kuwo.cn/r.s?' +
    new URLSearchParams({
      client: 'kt',
      all: keyword,
      pn: String(page - 1),
      rn: String(limit),
      uid: '794762570',
      ver: 'kwplayer_ar_9.2.2.1',
      vipver: '1',
      show_copyright_off: '1',
      newver: '1',
      ft: 'music',
      cluster: '0',
      strategy: '2012',
      encoding: 'utf8',
      rformat: 'json',
      vermerge: '1',
      mobi: '1',
      issubtitle: '1',
    }).toString()
  const data = await fetchJson(url)
  const list = data.abslist || []
  return {
    total: Number(data.TOTAL || data.total || list.length),
    list: list.map((item) => {
      const { qualitys, sizes } = parseKwQualities(item.N_MINFO || item.MINFO)
      const keys = qualitys.length ? qualitys : ['128k']
      const entries = keys.map((type) => ({ type, size: sizes[type] || null }))
      const { types, _types, sizes: typeSizes } = buildLxTypes(entries)
      const songmid = String(item.MUSICRID?.replace('MUSIC_', '') || item.DC_TARGETID || '')
      const name = decodeName(item.SONGNAME || item.NAME || '')
      const artist = decodeName(item.ARTIST || item.artist || '')
      const album = decodeName(item.ALBUM || item.album || '')
      return song({
        id: songmid || item.rid,
        name,
        artist,
        album,
        duration: Number(item.DURATION || item.duration || 0),
        cover: item.web_albumpic_short
          ? `https://img2.kuwo.cn/star/albumcover/${item.web_albumpic_short}`
          : null,
        platform: 'kw',
        qualitys: keys,
        qualitySizes: typeSizes,
        extra: lxExtra(
          'kw',
          {
            songmid,
            albumId: decodeName(item.ALBUMID || ''),
          },
          types,
          _types
        ),
      })
    }),
  }
}

async function searchWy(keyword, page, limit) {
  const body = await eapiRequest('/api/search/song/list/page', {
    keyword,
    needCorrect: '1',
    channel: 'typing',
    offset: limit * (page - 1),
    scene: 'normal',
    total: page == 1,
    limit,
  })
  if (!body || body.code !== 200) {
    throw new Error(body?.message || body?.msg || `网易搜索失败(${body?.code ?? 'unknown'})`)
  }
  const resources = body.data?.resources || []
  const list = []
  for (const row of resources) {
    const item = row?.baseInfo?.simpleSongData
    if (!item?.id) continue
    const privilege = item.privilege || {}
    const entries = []
    // Align with LX wy handleResult (switch fall-through on maxbr)
    if (privilege.maxBrLevel === 'hires') {
      entries.push({
        type: 'flac24bit',
        size: item.hr?.size ? sizeFormate(item.hr.size) : null,
      })
    }
    switch (Number(privilege.maxbr ?? 0)) {
      case 999000:
        entries.push({
          type: 'flac',
          size: item.sq?.size ? sizeFormate(item.sq.size) : null,
        })
      // falls through
      case 320000:
        entries.push({
          type: '320k',
          size: item.h?.size ? sizeFormate(item.h.size) : null,
        })
      // falls through
      case 192000:
      case 128000:
        entries.push({
          type: '128k',
          size: item.l?.size ? sizeFormate(item.l.size) : null,
        })
        break
      default:
        break
    }
    const seenQ = new Set()
    const uniqEntries = []
    for (const e of entries) {
      if (seenQ.has(e.type)) continue
      seenQ.add(e.type)
      uniqEntries.push(e)
    }
    if (!uniqEntries.length) {
      uniqEntries.push({ type: '128k', size: null })
    }
    const { types, _types, sizes, qualityKeys } = buildLxTypes(uniqEntries)
    const artists = (item.ar || []).map((a) => a.name).filter(Boolean).join('、')
    list.push(
      song({
        id: item.id,
        name: item.name,
        artist: artists,
        album: item.al?.name || '',
        duration: Math.round((item.dt || 0) / 1000),
        cover: item.al?.picUrl || null,
        platform: 'wy',
        qualitys: qualityKeys,
        qualitySizes: sizes,
        extra: lxExtra(
          'wy',
          {
            songmid: item.id,
            albumId: item.al?.id,
          },
          types,
          _types
        ),
      })
    )
  }
  return {
    total: Number(body.data?.totalCount || list.length),
    list,
  }
}

/** LX-style kg quality maps (types/_types with hash). */
function buildKgQualityInfo(item) {
  // Align with LX kg filterData: only ResFileSize/ResFileHash for flac24bit (not HiRes*).
  const pairs = [
    ['128k', item.FileHash, item.FileSize],
    ['320k', item.HQFileHash, item.HQFileSize],
    ['flac', item.SQFileHash, item.SQFileSize],
    ['flac24bit', item.ResFileHash, item.ResFileSize],
  ]
  const entries = []
  for (const [type, hash, fileSize] of pairs) {
    if (!hash) continue
    if (fileSize === 0) continue
    entries.push({
      type,
      size: fileSize ? sizeFormate(fileSize) : null,
      hash,
    })
  }
  if (!entries.length && item.FileHash) {
    entries.push({ type: '128k', size: null, hash: item.FileHash })
  }
  const built = buildLxTypes(entries)
  return built
}

/** Align with LX kg musicSearch: songsearch.kugou.com/song_search_v2 */
async function searchKg(keyword, page, limit) {
  const url =
    'https://songsearch.kugou.com/song_search_v2?' +
    new URLSearchParams({
      keyword,
      page: String(page),
      pagesize: String(limit),
      userid: '0',
      clientver: '',
      platform: 'WebFilter',
      filter: '2',
      iscorrection: '1',
      privilege_filter: '0',
      area_code: '1',
    }).toString()
  const data = await fetchJson(url)
  if (data.error_code !== 0 && data.error_code !== undefined && data.status !== 1) {
    throw new Error(data.error_msg || `酷狗搜索失败(${data.error_code})`)
  }
  const lists = data.data?.lists || []
  const seen = new Set()
  const rows = []
  for (const item of lists) {
    const key = `${item.Audioid || ''}_${item.FileHash || ''}`
    if (!seen.has(key)) {
      seen.add(key)
      rows.push(item)
    }
    for (const child of item.Grp || []) {
      const ckey = `${child.Audioid || item.Audioid || ''}_${child.FileHash || ''}`
      if (seen.has(ckey)) continue
      seen.add(ckey)
      rows.push(child)
    }
  }
  return {
    total: Number(data.data?.total || rows.length),
    list: rows.map((item) => {
      const { types, _types, sizes, qualityKeys } = buildKgQualityInfo(item)
      const singers = Array.isArray(item.Singers)
        ? item.Singers.map((s) => s.name).filter(Boolean).join('、')
        : item.SingerName
      const songmid = item.Audioid || item.FileHash || item.EMixSongID
      return song({
        id: item.FileHash || item.EMixSongID || item.Audioid || item.ID,
        name: item.SongName || item.OriSongName,
        artist: singers,
        album: item.AlbumName,
        duration: Number(item.Duration || 0),
        cover: item.Image?.replace('{size}', '240') || null,
        platform: 'kg',
        qualitys: qualityKeys.length ? qualityKeys : ['128k'],
        qualitySizes: sizes,
        extra: lxExtra(
          'kg',
          {
            songmid,
            hash: item.FileHash,
            albumId: item.AlbumID,
            albumAudioId: item.AlbumAudioId || item.AudioId || item.Audioid || undefined,
          },
          types,
          _types
        ),
      })
    }),
  }
}

function mgCreateSignature(time, str) {
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20'
  const signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73'
  const sign = createHash('md5')
    .update(`${str}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`)
    .digest('hex')
  return { sign, deviceId }
}

function parseMgFormats(audioFormats = []) {
  const entries = []
  for (const type of audioFormats || []) {
    const size = sizeFormate(type.asize ?? type.isize ?? type.size ?? type.androidSize) || null
    switch (type.formatType) {
      case 'PQ':
        entries.push({ type: '128k', size })
        break
      case 'HQ':
        entries.push({ type: '320k', size })
        break
      case 'SQ':
        entries.push({ type: 'flac', size })
        break
      case 'ZQ24':
        // LX mg only maps ZQ24 → flac24bit (not ZQ)
        entries.push({ type: 'flac24bit', size })
        break
      default:
        break
    }
  }
  const built = buildLxTypes(entries)
  if (!built.qualityKeys.length) {
    return buildLxTypes([{ type: '128k', size: null }])
  }
  return built
}

/** Align with LX mg musicSearch: jadeite.migu.cn signed v3 searchAll */
async function searchMg(keyword, page, limit) {
  const time = Date.now().toString()
  const { sign, deviceId } = mgCreateSignature(time, keyword)
  const url =
    'https://jadeite.migu.cn/music_search/v3/search/searchAll?' +
    new URLSearchParams({
      isCorrect: '0',
      isCopyright: '1',
      searchSwitch:
        '{"song":1,"album":0,"singer":0,"tagSong":1,"mvSong":0,"bestShow":1,"songlist":0,"lyricSong":0}',
      pageSize: String(limit),
      text: keyword,
      pageNo: String(page),
      sort: '0',
      sid: 'USS',
    }).toString()
  const data = await fetchJson(url, {
    headers: {
      uiVersion: 'A_music_3.6.1',
      deviceId,
      timestamp: time,
      sign,
      channel: '0146921',
      'User-Agent':
        'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
    },
  })
  if (data.code && data.code !== '000000') {
    throw new Error(data.info || `咪咕搜索失败(${data.code})`)
  }
  const songResultData = data.songResultData || { resultList: [], totalCount: 0 }
  const seen = new Set()
  const rows = []
  for (const group of songResultData.resultList || []) {
    for (const item of group || []) {
      if (!item?.songId || !item?.copyrightId || seen.has(item.copyrightId)) continue
      seen.add(item.copyrightId)
      rows.push(item)
    }
  }
  return {
    total: Number(songResultData.totalCount || rows.length),
    list: rows.map((item) => {
      const { types, _types, sizes, qualityKeys } = parseMgFormats(item.audioFormats)
      let img = item.img3 || item.img2 || item.img1 || null
      if (img && !/^https?:/i.test(img)) img = `http://d.musicapp.migu.cn${img}`
      const artists = Array.isArray(item.singerList)
        ? item.singerList.map((s) => s.name).filter(Boolean).join(' / ')
        : String(item.singerName || '')
      return song({
        id: item.copyrightId || item.songId,
        name: item.name || item.songName,
        artist: artists,
        album: item.album || item.albumName || '',
        duration: Number(item.duration || 0),
        cover: img,
        platform: 'mg',
        qualitys: qualityKeys,
        qualitySizes: sizes,
        extra: lxExtra(
          'mg',
          {
            songmid: item.songId || item.copyrightId,
            copyrightId: item.copyrightId,
            contentId: item.contentId || item.copyrightId,
            albumId: item.albumId,
            lrcUrl: item.lrcUrl || item.lyricUrl || undefined,
            mrcUrl: item.mrcUrl || item.mrcurl || undefined,
            trcUrl: item.trcUrl || undefined,
          },
          types,
          _types
        ),
      })
    }),
  }
}

function parseTxQualities(file = {}) {
  const entries = []
  if (file.size_128mp3 != 0 && file.size_128mp3) {
    entries.push({ type: '128k', size: sizeFormate(file.size_128mp3) })
  }
  if (file.size_320mp3 !== 0 && file.size_320mp3) {
    entries.push({ type: '320k', size: sizeFormate(file.size_320mp3) })
  }
  if (file.size_flac !== 0 && file.size_flac) {
    entries.push({ type: 'flac', size: sizeFormate(file.size_flac) })
  }
  if (file.size_hires !== 0 && file.size_hires) {
    entries.push({ type: 'flac24bit', size: sizeFormate(file.size_hires) })
  }
  const built = buildLxTypes(entries)
  if (!built.qualityKeys.length) {
    return buildLxTypes([{ type: '128k', size: null }])
  }
  return built
}

function normalizeTxSongList(itemSong) {
  if (!itemSong) return []
  if (Array.isArray(itemSong)) return itemSong
  if (Array.isArray(itemSong.list)) return itemSong.list
  return Object.values(itemSong).filter(
    (x) => x && typeof x === 'object' && (x.mid || x.id)
  )
}

function mapTxSongItem(item) {
  if (!item?.file?.media_mid) return null
  const { types, _types, sizes, qualityKeys } = parseTxQualities(item.file || {})
  const albumMid = item.album?.mid || ''
  const albumId = albumMid
  const songmid = item.mid || String(item.id)
  const artists = Array.isArray(item.singer)
    ? item.singer.map((s) => s.name).filter(Boolean).join(' / ')
    : String(item.singer || item.author || '')
  const cover =
    !albumId || albumId === '空'
      ? item.singer?.length
        ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg`
        : null
      : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`
  return song({
    id: songmid,
    name: (item.title || item.name || '').replace(/<\/?em>/gi, ''),
    artist: artists.replace(/<\/?em>/gi, ''),
    album: (item.album?.name || '').replace(/<\/?em>/gi, ''),
    duration: Number(item.interval) || 0,
    cover,
    platform: 'tx',
    qualitys: qualityKeys,
    qualitySizes: sizes,
    extra: lxExtra(
      'tx',
      {
        songmid,
        songId: item.id,
        strMediaMid: item.file.media_mid,
        albumMid,
        albumId,
      },
      types,
      _types
    ),
  })
}

/** QQ / 小秋 — musicu.fcg (unsigned); keep LX list fields for musicUrl scripts. */
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
        normalizeTxSongList(
          block?.data?.body?.item_song || block?.data?.body?.song?.list
        ),
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
      if (data.code != null && data.code !== 0) throw new Error(`code ${data.code}`)
      const block = attempt.pick(data)
      if (!block || block.code !== 0) throw new Error(`code ${block?.code ?? 'unknown'}`)
      const list = attempt.songs(block).map(mapTxSongItem).filter(Boolean)
      if (!list.length) throw new Error('empty')
      return { total: attempt.total(block, list), list }
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
