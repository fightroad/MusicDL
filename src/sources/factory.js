import {
  getCachedCapabilities,
  resolveMusicUrlInChild,
  setCachedCapabilities,
} from '../lx/host.js'
import { decorateListQualities, listPlatformTabs, searchPlatform } from './platformSearch.js'

const DEFAULT_PLATFORMS = ['kw', 'kg', 'tx', 'wy', 'mg']

/** LX-style: capabilities only from in-memory inited cache (never from disk). */
function sourceCapabilities(source) {
  const cached = getCachedCapabilities(source.id)
  if (cached?.platforms?.length) return cached
  return {
    platforms: DEFAULT_PLATFORMS,
    qualitys: [],
    platformQualitys: null,
  }
}

export function getSourcePlatformTabs(source) {
  return listPlatformTabs(sourceCapabilities(source).platforms)
}

export async function searchWithSource(
  source,
  keyword,
  page = 1,
  limit = 20,
  platform
) {
  if (source.kind !== 'lx') {
    throw new Error(`unsupported source kind: ${source.kind}`)
  }
  // Never execute the LX script for search.
  const caps = sourceCapabilities(source)
  const result = await searchPlatform(caps.platforms, keyword, page, limit, platform)
  // Before first successful inited: no script cap. After: intersect like LX qualityList.
  const qualitys = caps.qualitys?.length ? caps.qualitys.join(',') : ''
  const list = decorateListQualities(
    result.list,
    qualitys,
    caps.platformQualitys
  ).map((s) => ({
    ...s,
    source_id: source.id,
  }))
  return {
    ...result,
    list,
  }
}

function buildMusicInfo({ songId, platform, extra }) {
  const ex = extra && typeof extra === 'object' ? extra : {}
  const types = Array.isArray(ex.types)
    ? ex.types
    : Array.isArray(ex.qualitys)
      ? ex.qualitys
      : []
  const _types =
    ex._types && typeof ex._types === 'object'
      ? ex._types
      : ex._qualitys && typeof ex._qualitys === 'object'
        ? ex._qualitys
        : {}
  return {
    ...ex,
    source: platform || ex.source,
    name: ex.name || ex.songName || '',
    singer: ex.singer || ex.artist || '',
    albumName: ex.albumName || ex.album || '',
    albumId: ex.albumId,
    songmid: ex.songmid || songId,
    songId: ex.songId || ex.songmid || songId,
    hash: ex.hash,
    strMediaMid: ex.strMediaMid,
    albumMid: ex.albumMid,
    copyrightId: ex.copyrightId,
    contentId: ex.contentId,
    img: ex.img || ex.cover || null,
    types,
    _types,
    typeUrl: ex.typeUrl || {},
    qualitys: types,
    _qualitys: _types,
  }
}

export async function resolveWithSource(source, { songId, platform, quality, extra }) {
  if (source.kind !== 'lx') {
    throw new Error(`unsupported source kind: ${source.kind}`)
  }
  if (!source.script) throw new Error('音源缺少脚本内容')

  const plat = platform || 'kw'
  const q = quality || '128k'
  const musicInfo = buildMusicInfo({ songId, platform: plat, extra })
  const { url, meta } = await resolveMusicUrlInChild(source.script, {
    source: plat,
    action: 'musicUrl',
    info: { type: q, musicInfo },
  })

  // LX-style qualityList: keep in memory only after successful inited
  if (meta) setCachedCapabilities(source.id, meta)

  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error(`音源返回的播放地址无效: ${String(url)}`)
  }
  return { url, quality: q }
}
