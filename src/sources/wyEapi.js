/**
 * NetEase eapi helpers — align with LX musicSdk/wy (Binaryify crypto).
 */
import { createCipheriv, createHash } from 'node:crypto'

const EAPI_KEY = Buffer.from('e82ckenh8dichen8')

export function eapi(url, object) {
  const text = typeof object === 'object' ? JSON.stringify(object) : String(object)
  const message = `nobody${url}use${text}md5forencrypt`
  const digest = createHash('md5').update(message).digest('hex')
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  const cipher = createCipheriv('aes-128-ecb', EAPI_KEY, null)
  cipher.setAutoPadding(true)
  const params = Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()])
    .toString('hex')
    .toUpperCase()
  return { params }
}

/** LX-style eapiRequest → interface.music.163.com/eapi/batch */
export async function eapiRequest(apiPath, data) {
  const { params } = eapi(apiPath, data)
  const res = await fetch('https://interface.music.163.com/eapi/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
      Origin: 'https://music.163.com',
      Referer: 'https://music.163.com/',
      Cookie: 'os=pc',
    },
    body: new URLSearchParams({ params }).toString(),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error('网易接口返回了网页而非数据')
  }
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('网易接口数据解析失败')
  }
  // batch may nest under the api path, or return the payload directly
  if (body && body[apiPath] && typeof body[apiPath] === 'object') {
    return body[apiPath]
  }
  return body
}
