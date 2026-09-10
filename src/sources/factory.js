import { getCachedRuntime } from '../lx/host.js'
import { decorateListQualities, listPlatformTabs, searchPlatform } from './platformSearch.js'

export function getSourcePlatformTabs(source) {
  const platforms = String(source.platforms || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return listPlatformTabs(platforms)
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
  const platforms = String(source.platforms || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const result = await searchPlatform(platforms, keyword, page, limit, platform)
  const list = decorateListQualities(
    result.list,
    source.qualitys,
    source.platformQualitys
  ).map((s) => ({
    ...s,
    source_id: source.id,
  }))
  return {
    ...result,
    list,
  }
}

/** Build LX-shaped musicInfo for custom-source musicUrl handlers. */
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
    // aliases for scripts still reading MusicDL-era keys
    qualitys: types,
    _qualitys: _types,
  }
}

export async function resolveWithSource(source, { songId, platform, quality, extra }) {
  if (source.kind !== 'lx') {
    throw new Error(`unsupported source kind: ${source.kind}`)
  }
  if (!source.script) throw new Error('音源缺少脚本内容')

  const runtime = getCachedRuntime(source.id, source.script)
  const musicInfo = buildMusicInfo({ songId, platform, extra })
  const url = await runtime.request({
    source: platform || (runtime.meta.platforms[0] || 'kw'),
    action: 'musicUrl',
    info: { type: quality || '128k', musicInfo },
  })
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error(`音源返回的播放地址无效: ${String(url)}`)
  }
  return { url, quality: quality || '128k' }
}
