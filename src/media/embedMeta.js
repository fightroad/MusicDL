import NodeID3 from 'node-id3'
import {
  FlacStream,
  MetadataBlockType,
  PictureBlock,
  VorbisCommentBlock,
} from 'flac-tagger'

const COVER_MAX_BYTES = 2 * 1024 * 1024

function sniffImageMime(buf, contentType = '') {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'image/png') {
    return ct === 'image/jpg' ? 'image/jpeg' : ct
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png'
  }
  return null
}

async function fetchCoverBuffer(coverUrl) {
  const url = String(coverUrl || '').trim()
  if (!/^https?:\/\//i.test(url)) return null
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'MusicDL/0.1' },
    redirect: 'follow',
  })
  if (!resp.ok) return null
  const buf = Buffer.from(await resp.arrayBuffer())
  if (!buf.length || buf.length > COVER_MAX_BYTES) return null
  const mime = sniffImageMime(buf, resp.headers.get('content-type'))
  if (!mime) return null
  return { buf, mime }
}

function writeFlacTagsToBuffer(tags, sourceBuffer) {
  const stream = FlacStream.fromBuffer(sourceBuffer)
  const commentList = []
  Object.entries(tags.tagMap || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((singleValue) => commentList.push(`${key.toUpperCase()}=${singleValue}`))
    } else if (value != null && value !== '') {
      commentList.push(`${key.toUpperCase()}=${value}`)
    }
  })
  if (stream.vorbisCommentBlock) {
    stream.vorbisCommentBlock.commentList = commentList
  } else {
    stream.metadataBlocks.push(new VorbisCommentBlock({ commentList }))
  }
  if (tags.picture?.buffer) {
    if (stream.pictureBlock) {
      stream.metadataBlocks = stream.metadataBlocks.filter((b) => b !== stream.pictureBlock)
    }
    stream.metadataBlocks.push(
      new PictureBlock({
        pictureBuffer: tags.picture.buffer,
        mime: tags.picture.mime,
        description: tags.picture.description,
      })
    )
  }
  stream.metadataBlocks = stream.metadataBlocks.filter((b) => b.type !== MetadataBlockType.Padding)
  return stream.toBuffer()
}

/**
 * Embed basic tags (and cover when available) into an audio buffer in memory.
 * Returns the (possibly unchanged) buffer and whether cover was embedded.
 */
export async function embedDownloadMetaBuffer(audioBuffer, ext, { coverUrl, title, artist, album } = {}) {
  const kind = String(ext || '').toLowerCase()
  if (!Buffer.isBuffer(audioBuffer) || !audioBuffer.length) {
    return { buffer: audioBuffer, embedded: false }
  }
  if (kind !== 'mp3' && kind !== 'flac') {
    return { buffer: audioBuffer, embedded: false }
  }

  const hasText = Boolean(title || artist || album)
  let picture = null
  try {
    picture = await fetchCoverBuffer(coverUrl)
  } catch {
    picture = null
  }
  if (!hasText && !picture) {
    return { buffer: audioBuffer, embedded: false }
  }

  try {
    if (kind === 'mp3') {
      const tags = {
        title: title || undefined,
        artist: artist || undefined,
        album: album || undefined,
      }
      if (picture) {
        tags.image = {
          mime: picture.mime,
          type: { id: 3, name: 'front cover' },
          description: 'Cover',
          imageBuffer: picture.buf,
        }
      }
      const out = NodeID3.write(tags, audioBuffer)
      if (out instanceof Error) throw out
      if (!Buffer.isBuffer(out) || !out.length) {
        return { buffer: audioBuffer, embedded: false }
      }
      return { buffer: out, embedded: Boolean(picture) }
    }

    const out = writeFlacTagsToBuffer(
      {
        tagMap: {
          ...(title ? { title } : {}),
          ...(artist ? { artist } : {}),
          ...(album ? { album } : {}),
        },
        ...(picture
          ? { picture: { buffer: picture.buf, mime: picture.mime, description: 'Cover' } }
          : {}),
      },
      audioBuffer
    )
    return { buffer: out, embedded: Boolean(picture) }
  } catch (err) {
    console.warn('[embedMeta]', err?.message || err)
    return { buffer: audioBuffer, embedded: false }
  }
}
