/**
 * NetEase eapi / weapi helpers — align with LX musicSdk/wy (Binaryify crypto).
 */
import { constants, createCipheriv, createHash, publicEncrypt, randomBytes } from 'node:crypto'

const EAPI_KEY = Buffer.from('e82ckenh8dichen8')
const WEAPI_IV = Buffer.from('0102030405060708')
const WEAPI_PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud')
const WEAPI_BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const WEAPI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`

function aesEncrypt(buffer, mode, key, iv) {
  const cipher = createCipheriv(mode, key, iv || null)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(buffer), cipher.final()])
}

export function eapi(url, object) {
  const text = typeof object === 'object' ? JSON.stringify(object) : String(object)
  const message = `nobody${url}use${text}md5forencrypt`
  const digest = createHash('md5').update(message).digest('hex')
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  const params = aesEncrypt(Buffer.from(data, 'utf8'), 'aes-128-ecb', EAPI_KEY, null)
    .toString('hex')
    .toUpperCase()
  return { params }
}

/** LX / Binaryify weapi — used by tipSearch suggest. */
function weapi(object) {
  const text = JSON.stringify(object)
  const secretKey = Buffer.from(
    Array.from(randomBytes(16), (n) => WEAPI_BASE62.charAt(n % 62)).join(''),
    'utf8'
  )
  const params = aesEncrypt(
    Buffer.from(
      aesEncrypt(Buffer.from(text, 'utf8'), 'aes-128-cbc', WEAPI_PRESET_KEY, WEAPI_IV).toString(
        'base64'
      ),
      'utf8'
    ),
    'aes-128-cbc',
    secretKey,
    WEAPI_IV
  ).toString('base64')
  const reversed = Buffer.from(secretKey).reverse()
  const padded = Buffer.concat([Buffer.alloc(128 - reversed.length), reversed])
  const encSecKey = publicEncrypt(
    { key: WEAPI_PUBLIC_KEY, padding: constants.RSA_NO_PADDING },
    padded
  ).toString('hex')
  return { params, encSecKey }
}

export async function weapiRequest(apiPath, data) {
  const form = weapi(data)
  const res = await fetch(`https://music.163.com/weapi${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Origin: 'https://music.163.com',
      Referer: 'https://music.163.com/',
    },
    body: new URLSearchParams(form).toString(),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error('网易接口返回了网页而非数据')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('网易接口数据解析失败')
  }
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
