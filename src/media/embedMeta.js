import path from 'node:path'
import NodeID3 from 'node-id3'
import {
  FlacStream,
  MetadataBlockType,
  PictureBlock,
  VorbisCommentBlock,
  readFlacTagsSync,
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

/**
 * Read embedded front cover from a local mp3/flac file.
 * @returns {{ buf: Buffer, mime: string } | null}
 */
export function extractEmbeddedCover(filePath) {
  const ext = path.extname(filePath || '').toLowerCase()
  try {
    if (ext === '.mp3') {
      const tags = NodeID3.read(filePath)
      const img = tags?.image
      const raw = img?.imageBuffer
      if (!raw || !raw.length || raw.length > COVER_MAX_BYTES) return null
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      const mime = sniffImageMime(buf, img.mime) || 'image/jpeg'
      return { buf, mime }
    }
    if (ext === '.flac') {
      const tags = readFlacTagsSync(filePath)
      const pic = tags?.picture
      const raw = pic?.buffer
      if (!raw || !raw.length || raw.length > COVER_MAX_BYTES) return null
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      const mime = sniffImageMime(buf, pic.mime) || 'image/jpeg'
      return { buf, mime }
    }
  } catch (err) {
    console.warn('[extractCover]', err?.message || err)
  }
  return null
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
 * Embed basic tags, optional cover, and optional lyrics into an audio buffer.
 * Returns the (possibly unchanged) buffer and what was embedded.
 */
export async function embedDownloadMetaBuffer(
  audioBuffer,
  ext,
  { coverUrl, title, artist, album, lyric } = {}
) {
  const kind = String(ext || '').toLowerCase()
  if (!Buffer.isBuffer(audioBuffer) || !audioBuffer.length) {
    return { buffer: audioBuffer, embeddedCover: false, embeddedLyric: false }
  }
  if (kind !== 'mp3' && kind !== 'flac') {
    return { buffer: audioBuffer, embeddedCover: false, embeddedLyric: false }
  }

  const lyricText = String(lyric || '').trim()
  const hasText = Boolean(title || artist || album || lyricText)
  let picture = null
  try {
    picture = await fetchCoverBuffer(coverUrl)
  } catch {
    picture = null
  }
  if (!hasText && !picture) {
    return { buffer: audioBuffer, embeddedCover: false, embeddedLyric: false }
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
      if (lyricText) {
        tags.unsynchronisedLyrics = {
          language: 'chi',
          text: lyricText,
        }
      }
      const out = NodeID3.write(tags, audioBuffer)
      if (out instanceof Error) throw out
      if (!Buffer.isBuffer(out) || !out.length) {
        return { buffer: audioBuffer, embeddedCover: false, embeddedLyric: false }
      }
      return {
        buffer: out,
        embeddedCover: Boolean(picture),
        embeddedLyric: Boolean(lyricText),
      }
    }

    const out = writeFlacTagsToBuffer(
      {
        tagMap: {
          ...(title ? { title } : {}),
          ...(artist ? { artist } : {}),
          ...(album ? { album } : {}),
          ...(lyricText ? { lyrics: lyricText } : {}),
        },
        ...(picture
          ? { picture: { buffer: picture.buf, mime: picture.mime, description: 'Cover' } }
          : {}),
      },
      audioBuffer
    )
    return {
      buffer: out,
      embeddedCover: Boolean(picture),
      embeddedLyric: Boolean(lyricText),
    }
  } catch (err) {
    console.warn('[embedMeta]', err?.message || err)
    return { buffer: audioBuffer, embeddedCover: false, embeddedLyric: false }
  }
}
