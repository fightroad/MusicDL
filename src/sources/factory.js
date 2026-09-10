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

export async function resolveWithSource(source, { songId, platform, quality, extra }) {
  if (source.kind !== 'lx') {
    throw new Error(`unsupported source kind: ${source.kind}`)
  }
  if (!source.script) throw new Error('音源缺少脚本内容')

  const runtime = getCachedRuntime(source.id, source.script)
  // Flatten LX-like musicInfo (scripts read songmid/hash/copyrightId/_qualitys, etc.)
  const musicInfo = {
    ...(extra || {}),
    name: extra?.name || extra?.songName,
    singer: extra?.singer || extra?.artist,
    songmid: extra?.songmid || songId,
    songId: extra?.songId || extra?.songmid || songId,
    hash: extra?.hash,
    albumId: extra?.albumId,
    albumName: extra?.albumName || extra?.album,
    strMediaMid: extra?.strMediaMid,
    albumMid: extra?.albumMid,
    copyrightId: extra?.copyrightId || extra?.contentId,
  }
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
