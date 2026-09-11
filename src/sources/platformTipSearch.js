/**
 * Search suggestions (tipSearch) — align with LX musicSdk tipSearch modules.
 */
import { weapiRequest } from './wyEapi.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': UA,
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<')) throw new Error('联想接口返回异常')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('联想数据解析失败')
  }
}

function uniqTips(list) {
  const out = []
  const seen = new Set()
  for (const raw of list || []) {
    const tip = String(raw || '').trim()
    if (!tip || seen.has(tip)) continue
    seen.add(tip)
    out.push(tip)
    if (out.length >= 10) break
  }
  return out
}

async function tipKw(keyword) {
  const body = await fetchJson(
    `https://tips.kuwo.cn/t.s?corp=kuwo&newver=3&p2p=1&notrace=0&c=mbox&w=${encodeURIComponent(keyword)}&encoding=utf8&rformat=json`,
    { headers: { Referer: 'http://www.kuwo.cn/' } }
  )
  const items = Array.isArray(body?.WORDITEMS) ? body.WORDITEMS : []
  return uniqTips(items.map((item) => item?.RELWORD))
}

async function tipKg(keyword) {
  const body = await fetchJson(
    `https://searchtip.kugou.com/getSearchTip?MusicTipCount=10&keyword=${encodeURIComponent(keyword)}`,
    { headers: { Referer: 'https://www.kugou.com/' } }
  )
  const block = Array.isArray(body?.data) ? body.data[0] : Array.isArray(body) ? body[0] : null
  const records = Array.isArray(block?.RecordDatas) ? block.RecordDatas : []
  return uniqTips(records.map((item) => item?.HintInfo))
}

async function tipTx(keyword) {
  const body = await fetchJson(
    `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?is_xml=0&format=json&key=${encodeURIComponent(keyword)}&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq&needNewCode=0`,
    { headers: { Referer: 'https://y.qq.com/portal/player.html' } }
  )
  if (body?.code != 0) throw new Error('QQ 联想失败')
  const songs = Array.isArray(body?.data?.song?.itemlist) ? body.data.song.itemlist : []
  return uniqTips(songs.map((info) => `${info.name || ''} - ${info.singer || ''}`.trim()))
}

async function tipWy(keyword) {
  const body = await weapiRequest('/search/suggest/web', { s: keyword })
  if (body?.code != 200) throw new Error('网易联想失败')
  const songs = Array.isArray(body?.result?.songs) ? body.result.songs : []
  return uniqTips(
    songs.map((info) => {
      const artists = Array.isArray(info.artists)
        ? info.artists.map((a) => a?.name).filter(Boolean).join('、')
        : ''
      return `${info.name || ''} - ${artists}`.replace(/\s+-\s*$/, '').trim()
    })
  )
}

async function tipMg(keyword) {
  const body = await fetchJson(
    `https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_suggest.do?text=${encodeURIComponent(keyword)}`,
    { headers: { Referer: 'https://m.music.migu.cn/' } }
  )
  if (String(body?.code) !== '000000') throw new Error('咪咕联想失败')
  const songs = Array.isArray(body?.songSuggests) ? body.songSuggests : []
  return uniqTips(
    songs.map((info) => `${info.name || ''} - ${info.singerName || ''}`.replace(/\s+-\s*$/, '').trim())
  )
}

const adapters = {
  kw: tipKw,
  kg: tipKg,
  tx: tipTx,
  wy: tipWy,
  mg: tipMg,
}

/** @returns {Promise<string[]>} */
export async function tipSearchPlatform(platform, keyword) {
  const key = String(platform || '').toLowerCase()
  const q = String(keyword || '').trim()
  if (!q) return []
  const fn = adapters[key]
  if (!fn) return []
  try {
    return await fn(q)
  } catch (err) {
    console.warn(`[tip:${key}]`, err?.message || err)
    return []
  }
}
