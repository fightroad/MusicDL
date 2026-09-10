async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const data = await res.json()
      msg = data.detail || JSON.stringify(data)
    } catch (_) {}
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  if (res.status === 204) return null
  const ctype = res.headers.get('content-type') || ''
  if (ctype.includes('application/json')) return res.json()
  return res
}

const sourceSelect = document.getElementById('sourceSelect')
const keywordInput = document.getElementById('keyword')
const btnSearch = document.getElementById('btnSearch')
const platformTabsEl = document.getElementById('platformTabs')
const resultBody = document.getElementById('resultBody')
const toastEl = document.getElementById('toast')
const audio = document.getElementById('audio')
const nowPlaying = document.getElementById('nowPlaying')
const nowArtist = document.getElementById('nowArtist')
const playerCover = document.getElementById('playerCover')
const btnPlayPause = document.getElementById('btnPlayPause')
const seekBar = document.getElementById('seekBar')
const timeCurrent = document.getElementById('timeCurrent')
const timeTotal = document.getElementById('timeTotal')
const pagerEl = document.getElementById('pager')
const btnPrev = document.getElementById('btnPrev')
const btnNext = document.getElementById('btnNext')
const pageInfo = document.getElementById('pageInfo')
const pageSizeSelect = document.getElementById('pageSize')
const dlModal = document.getElementById('dlModal')
const dlTitle = document.getElementById('dlTitle')
const dlArtist = document.getElementById('dlArtist')
const dlQualities = document.getElementById('dlQualities')
const dlStatus = document.getElementById('dlStatus')
const dlClose = document.getElementById('dlClose')
const dlQueueToggle = document.getElementById('dlQueueToggle')
const dlQueueBadge = document.getElementById('dlQueueBadge')
const dlQueuePanel = document.getElementById('dlQueuePanel')
const dlQueueList = document.getElementById('dlQueueList')
const dlQueueEmpty = document.getElementById('dlQueueEmpty')
const dlQueueClear = document.getElementById('dlQueueClear')

let sourcesCache = []
let currentPlatform = ''
let currentTabs = []
let currentPage = 1
let pageSize = 20
let totalItems = 0
let searching = false
let pendingDownloadSong = null

const DL_CONCURRENCY = 2
let dlJobs = []
let dlNextId = 1
let dlActiveCount = 0

function firstPlatformKey(tabs = currentTabs) {
  const hit = (tabs || []).find((t) => t.searchable !== false)
  return hit?.key || ''
}

const QUALITY_LABELS = {
  '128k': '普通音质 128K',
  '192k': '较高音质 192K',
  '320k': '高清音质 320K',
  flac: '无损音质 FLAC',
  flac24bit: '高解析度 FLAC',
  '24bit': '高解析度 FLAC',
}

const QUALITY_BITRATE = {
  '128k': 128,
  '192k': 192,
  '320k': 320,
  flac: 1000,
  flac24bit: 2000,
  '24bit': 2000,
}

function totalPages() {
  return Math.max(1, Math.ceil(totalItems / pageSize) || 1)
}

let toastTimer = null
function toast(message, { error = false, ms = 2400 } = {}) {
  if (!message) {
    toastEl.hidden = true
    toastEl.textContent = ''
    return
  }
  toastEl.textContent = message
  toastEl.classList.toggle('is-error', !!error)
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastEl.hidden = true
  }, ms)
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function currentSource() {
  const id = Number(sourceSelect.value)
  return sourcesCache.find((s) => s.id === id) || null
}

function renderPager() {
  if (!totalItems) {
    pagerEl.hidden = true
    return
  }
  const pages = totalPages()
  pagerEl.hidden = false
  pageInfo.textContent = `第 ${currentPage} / ${pages} 页 · 共 ${totalItems} 条`
  btnPrev.disabled = currentPage <= 1 || searching
  btnNext.disabled = currentPage >= pages || searching
}

function renderPlatformTabs(tabs) {
  currentTabs = tabs || []
  if (!currentTabs.length) {
    platformTabsEl.hidden = true
    platformTabsEl.innerHTML = ''
    return
  }
  const current = currentTabs.find((t) => t.key === currentPlatform)
  if (!current || current.searchable === false) {
    currentPlatform = firstPlatformKey(currentTabs)
  }
  platformTabsEl.hidden = false
  platformTabsEl.innerHTML = currentTabs
    .map((t) => {
      const active = t.key === currentPlatform ? 'active' : ''
      const disabled = t.searchable === false ? 'disabled' : ''
      const title = t.searchable === false ? ' title="暂不可用"' : ''
      return `<button type="button" class="tab ${active}" data-platform="${t.key}" ${disabled}${title}>${escapeHtml(t.name)}</button>`
    })
    .join('')
}

async function loadPlatformTabs() {
  const source = currentSource()
  if (!source) {
    renderPlatformTabs([])
    return
  }
  try {
    const data = await api(`/api/music/platforms?source_id=${source.id}`)
    renderPlatformTabs(data.tabs || [])
  } catch (err) {
    toast(`加载平台失败: ${err.message}`, { error: true })
  }
}

async function loadSources() {
  const prev = sourceSelect.value
  const list = await api('/api/sources')
  sourcesCache = list.filter((s) => s.enabled)
  if (!sourcesCache.length) {
    sourceSelect.innerHTML = '<option value="">请先导入音源</option>'
    renderPlatformTabs([])
    pagerEl.hidden = true
    return
  }
  sourceSelect.innerHTML = sourcesCache
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join('')
  if (prev && sourcesCache.some((s) => String(s.id) === String(prev))) {
    sourceSelect.value = prev
  }
  await loadPlatformTabs()
}

function formatDuration(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return '--:--'
  const s = Math.floor(n)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function renderRows(songs) {
  const offset = (currentPage - 1) * pageSize
  resultBody.innerHTML = songs
    .map((s, idx) => {
      const payload = encodeURIComponent(JSON.stringify(s))
      const qTag = s.quality_tag
        ? `<span class="song-tag song-tag-quality">${escapeHtml(s.quality_tag)}</span>`
        : ''
      const pTag = s.platform
        ? `<span class="song-tag song-tag-platform">${escapeHtml(s.platform)}</span>`
        : ''
      return `<tr>
        <td class="col-idx">${offset + idx + 1}</td>
        <td class="song-cell col-song">
          <div class="song-line">
            <span class="song-name">${escapeHtml(s.name)}</span>${qTag}${pTag}
          </div>
        </td>
        <td class="col-artist">${escapeHtml(s.artist || '-')}</td>
        <td class="col-album">${escapeHtml(s.album || '-')}</td>
        <td class="col-duration">${formatDuration(s.duration)}</td>
        <td class="col-actions">
          <button class="small" data-act="play" data-song="${payload}">试听</button>
          <button class="small" data-act="dl" data-song="${payload}">下载</button>
        </td>
      </tr>`
    })
    .join('')
}

async function doSearch({ resetPage = false } = {}) {
  const keyword = keywordInput.value.trim()
  const sourceId = Number(sourceSelect.value)
  if (!sourceId) {
    toast('请先导入并选择音源', { error: true })
    return
  }
  if (!keyword) {
    toast('请输入关键词', { error: true })
    return
  }
  if (resetPage) currentPage = 1

  searching = true
  renderPager()
  try {
    const data = await api(
      `/api/music/search?source_id=${sourceId}` +
        `&keyword=${encodeURIComponent(keyword)}` +
        `&platform=${encodeURIComponent(currentPlatform)}` +
        `&page=${currentPage}&limit=${pageSize}`
    )
    if (data.tabs) renderPlatformTabs(data.tabs)
    totalItems = Number(data.total) || 0
    const pages = totalPages()
    if (currentPage > pages) {
      currentPage = pages
      searching = false
      return doSearch()
    }
    renderRows(data.list || [])
    renderPager()
  } catch (err) {
    toast(`搜索失败: ${err.message}`, { error: true, ms: 3200 })
    resultBody.innerHTML = ''
    totalItems = 0
    renderPager()
  } finally {
    searching = false
    renderPager()
  }
}

/** Preview: lowest available quality (prefer 128k when present). */
function previewQuality(song) {
  const qs = sourceQualities(song)
  return qs[0] || '128k'
}

async function resolveUrl(song) {
  const quality = previewQuality(song)
  return api('/api/music/url', {
    method: 'POST',
    body: JSON.stringify({
      source_id: song.source_id,
      song_id: song.id,
      platform: song.platform || 'kw',
      quality,
      extra: { ...song.extra, name: song.name, artist: song.artist },
    }),
  })
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function setPlayerMeta(song, statusText) {
  nowPlaying.textContent = statusText || song?.name || '未在播放'
  nowArtist.textContent = song?.artist || (song ? '' : '选择歌曲后点击试听')
  if (song?.cover) {
    playerCover.src = song.cover
    playerCover.hidden = false
  } else {
    playerCover.removeAttribute('src')
    playerCover.hidden = true
  }
}

playerCover.addEventListener('error', () => {
  playerCover.removeAttribute('src')
  playerCover.hidden = true
})

function syncPlayButton() {
  btnPlayPause.textContent = audio.paused ? '▶' : '❚❚'
}

async function playSong(song) {
  setPlayerMeta(song, '解析中…')
  btnPlayPause.disabled = true
  seekBar.disabled = true
  try {
    const data = await resolveUrl(song)
    audio.src = `/api/music/proxy?url=${encodeURIComponent(data.url)}`
    await audio.play()
    setPlayerMeta(song)
    btnPlayPause.disabled = false
    seekBar.disabled = false
    syncPlayButton()
  } catch (err) {
    setPlayerMeta(song, '试听失败')
    nowArtist.textContent = err.message
    btnPlayPause.disabled = true
    seekBar.disabled = true
  }
}

btnPlayPause.addEventListener('click', async () => {
  if (!audio.src) return
  try {
    if (audio.paused) await audio.play()
    else audio.pause()
    syncPlayButton()
  } catch (err) {
    nowArtist.textContent = err.message
  }
})

audio.addEventListener('play', syncPlayButton)
audio.addEventListener('pause', syncPlayButton)
audio.addEventListener('ended', () => {
  syncPlayButton()
  seekBar.value = '0'
  timeCurrent.textContent = '0:00'
})
audio.addEventListener('loadedmetadata', () => {
  timeTotal.textContent = formatTime(audio.duration)
})
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return
  if (!seekBar.matches(':active')) {
    seekBar.value = String(Math.round((audio.currentTime / audio.duration) * 1000))
  }
  timeCurrent.textContent = formatTime(audio.currentTime)
  timeTotal.textContent = formatTime(audio.duration)
})
seekBar.addEventListener('input', () => {
  if (!audio.duration) return
  const ratio = Number(seekBar.value) / 1000
  audio.currentTime = ratio * audio.duration
  timeCurrent.textContent = formatTime(audio.currentTime)
})

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function estimateSize(durationSec, quality) {
  const kbps = QUALITY_BITRATE[quality] || 128
  const sec = Number(durationSec) || 0
  if (!sec) return ''
  return formatSize((sec * kbps * 1000) / 8)
}

const QUALITY_ORDER = ['128k', '192k', '320k', 'flac', 'flac24bit', '24bit']

/** Prefer song.qualitys (already capped by server); fall back to platform script list. */
function sourceQualities(song) {
  // 服务端已裁剪；空数组表示无交集，不要再回退到平台全量
  if (Array.isArray(song.qualitys)) {
    return sortQualities(song.qualitys.map(String).filter(Boolean))
  }

  const source = sourcesCache.find((s) => s.id === song.source_id)
  const byPlatform = source?.platformQualitys?.[song.platform || '']
  if (Array.isArray(byPlatform) && byPlatform.length) return sortQualities(byPlatform)

  const merged = String(source?.qualitys || '128k')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return sortQualities(merged.length ? merged : ['128k'])
}

function sortQualities(list) {
  const seen = new Set()
  const out = []
  for (const q of QUALITY_ORDER) {
    if (list.includes(q) && !seen.has(q)) {
      seen.add(q)
      out.push(q)
    }
  }
  for (const q of list) {
    if (!seen.has(q)) {
      seen.add(q)
      out.push(q)
    }
  }
  return out
}

function openDownloadModal(song) {
  pendingDownloadSong = song
  dlTitle.textContent = song.name || '未知歌曲'
  dlArtist.textContent = song.artist || '未知歌手'
  const qualities = sourceQualities(song)
  if (!qualities.length) {
    dlStatus.textContent = '当前音源无法匹配此歌曲音质'
    dlQualities.innerHTML = ''
    dlModal.hidden = false
    return
  }
  dlStatus.textContent = ''
  dlQualities.innerHTML = qualities
    .map((q) => {
      const size = estimateSize(song.duration, q)
      const label = QUALITY_LABELS[q] || q
      const text = size ? `${label} - ${size}` : label
      return `<button type="button" class="quality-btn" data-quality="${q}">${escapeHtml(text)}</button>`
    })
    .join('')
  dlModal.hidden = false
}

function closeDownloadModal() {
  pendingDownloadSong = null
  dlModal.hidden = true
  dlStatus.textContent = ''
}

function dlJobLabel(job) {
  const q = QUALITY_LABELS[job.quality] || job.quality
  if (job.status === 'queued') return `排队中 · ${q}`
  if (job.status === 'running') return `下载中 · ${q}`
  if (job.status === 'skipped') return `已跳过（文件已存在）· ${job.filename || ''}`.trim()
  if (job.status === 'done') {
    const sizeTip = job.size ? ` · ${formatSize(job.size)}` : ''
    return `已保存 ${job.filename || ''}${sizeTip}`.trim()
  }
  if (job.status === 'cancelled') return '已取消'
  return job.error || '下载失败'
}

function openDlQueuePanel() {
  dlQueuePanel.hidden = false
  dlQueueToggle.setAttribute('aria-expanded', 'true')
  dlQueueToggle.classList.add('is-open')
}

function closeDlQueuePanel() {
  dlQueuePanel.hidden = true
  dlQueueToggle.setAttribute('aria-expanded', 'false')
  dlQueueToggle.classList.remove('is-open')
}

function toggleDlQueuePanel() {
  if (dlQueuePanel.hidden) openDlQueuePanel()
  else closeDlQueuePanel()
}

function renderDlQueue() {
  const pending = dlJobs.filter((j) => j.status === 'queued' || j.status === 'running').length
  const hasJobs = dlJobs.length > 0
  if (pending > 0) {
    dlQueueBadge.hidden = false
    dlQueueBadge.textContent = String(pending)
  } else {
    dlQueueBadge.hidden = true
  }

  dlQueueEmpty.hidden = hasJobs
  dlQueueList.innerHTML = dlJobs
    .map((job) => {
      const name = escapeHtml(job.song.name || '未知歌曲')
      const artist = escapeHtml(job.song.artist || '')
      const metaClass = job.status === 'error' ? 'dl-queue-meta is-error' : 'dl-queue-meta'
      const meta = escapeHtml(dlJobLabel(job))
      let actions = ''
      if (job.status === 'queued') {
        actions = `<button type="button" class="ghost small" data-dl-act="cancel" data-id="${job.id}">取消</button>`
      } else if (job.status === 'running') {
        actions = ''
      } else if (job.status === 'error' || job.status === 'cancelled') {
        actions = `<button type="button" class="ghost small" data-dl-act="retry" data-id="${job.id}">重试</button>
          <button type="button" class="ghost small" data-dl-act="remove" data-id="${job.id}">移除</button>`
      } else {
        actions = `<button type="button" class="ghost small" data-dl-act="remove" data-id="${job.id}">移除</button>`
      }
      return `<li class="dl-queue-item" data-id="${job.id}">
        <div class="dl-queue-name" title="${name}">${name}${artist ? ` · ${artist}` : ''}</div>
        <div class="dl-queue-item-actions">${actions}</div>
        <div class="${metaClass}">${meta}</div>
      </li>`
    })
    .join('')
}

function enqueueDownload(song, quality = '128k') {
  const q = quality || '128k'
  const job = {
    id: dlNextId++,
    song,
    quality: q,
    status: 'queued',
    error: null,
    filename: null,
    size: 0,
    abortController: null,
  }
  dlJobs.unshift(job)
  renderDlQueue()
  pumpDlQueue()
  closeDownloadModal()
}

function pumpDlQueue() {
  while (dlActiveCount < DL_CONCURRENCY) {
    const next = [...dlJobs].reverse().find((j) => j.status === 'queued')
    if (!next) break
    void runDlJob(next)
  }
}

async function runDlJob(job) {
  if (job.status !== 'queued') return
  job.status = 'running'
  job.error = null
  job.abortController = new AbortController()
  dlActiveCount += 1
  renderDlQueue()
  try {
    const data = await api('/api/music/download', {
      method: 'POST',
      signal: job.abortController.signal,
      body: JSON.stringify({
        source_id: job.song.source_id,
        song_id: job.song.id,
        platform: job.song.platform || 'kw',
        quality: job.quality,
        extra: {
          ...job.song.extra,
          name: job.song.name,
          artist: job.song.artist,
          album: job.song.album,
          cover: job.song.cover,
          duration: job.song.duration,
        },
      }),
    })
    if (job.status === 'cancelled') return
    if (data.skipped) {
      job.status = 'skipped'
      job.filename = data.filename
      job.size = 0
      return
    }
    job.status = 'done'
    job.filename = data.filename
    job.size = data.size || 0
  } catch (err) {
    if (job.status === 'cancelled' || err.name === 'AbortError') {
      job.status = 'cancelled'
      job.error = null
    } else {
      job.status = 'error'
      job.error = err.message || '下载失败'
      toast(`下载失败: ${job.song.name || ''} ${job.error}`.trim(), { error: true })
    }
  } finally {
    job.abortController = null
    dlActiveCount = Math.max(0, dlActiveCount - 1)
    renderDlQueue()
    pumpDlQueue()
  }
}

function cancelDlJob(id) {
  const job = dlJobs.find((j) => j.id === id)
  if (!job || job.status !== 'queued') return
  job.status = 'cancelled'
  renderDlQueue()
}

function retryDlJob(id) {
  const job = dlJobs.find((j) => j.id === id)
  if (!job || (job.status !== 'error' && job.status !== 'cancelled')) return
  job.status = 'queued'
  job.error = null
  job.filename = null
  job.size = 0
  renderDlQueue()
  pumpDlQueue()
}

function removeDlJob(id) {
  const job = dlJobs.find((j) => j.id === id)
  if (!job || job.status === 'running' || job.status === 'queued') return
  dlJobs = dlJobs.filter((j) => j.id !== id)
  renderDlQueue()
}

function clearFinishedDlJobs() {
  dlJobs = dlJobs.filter((j) => j.status === 'queued' || j.status === 'running')
  renderDlQueue()
}

dlQualities.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-quality]')
  if (!btn || !pendingDownloadSong) return
  enqueueDownload(pendingDownloadSong, btn.dataset.quality)
})

dlClose.addEventListener('click', closeDownloadModal)
dlModal.addEventListener('click', (e) => {
  if (e.target === dlModal) closeDownloadModal()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dlModal.hidden) closeDownloadModal()
  else if (e.key === 'Escape' && !dlQueuePanel.hidden) closeDlQueuePanel()
})

dlQueueToggle.addEventListener('click', toggleDlQueuePanel)
dlQueueClear.addEventListener('click', clearFinishedDlJobs)
dlQueueList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-dl-act]')
  if (!btn) return
  const id = Number(btn.dataset.id)
  if (btn.dataset.dlAct === 'cancel') cancelDlJob(id)
  if (btn.dataset.dlAct === 'retry') retryDlJob(id)
  if (btn.dataset.dlAct === 'remove') removeDlJob(id)
})
document.addEventListener('click', (e) => {
  if (dlQueuePanel.hidden) return
  if (dlQueuePanel.contains(e.target) || dlQueueToggle.contains(e.target)) return
  closeDlQueuePanel()
})

platformTabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-platform]')
  if (!btn || btn.disabled) return
  currentPlatform = btn.dataset.platform
  renderPlatformTabs(currentTabs)
  if (keywordInput.value.trim()) doSearch({ resetPage: true })
})

sourceSelect.addEventListener('change', async () => {
  currentPlatform = ''
  currentPage = 1
  totalItems = 0
  resultBody.innerHTML = ''
  renderPager()
  await loadPlatformTabs()
  if (keywordInput.value.trim()) doSearch({ resetPage: true })
})

btnPrev.addEventListener('click', () => {
  if (currentPage <= 1) return
  currentPage -= 1
  doSearch()
})

btnNext.addEventListener('click', () => {
  if (currentPage >= totalPages()) return
  currentPage += 1
  doSearch()
})

pageSizeSelect.addEventListener('change', () => {
  pageSize = Number(pageSizeSelect.value) || 20
  doSearch({ resetPage: true })
})

resultBody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]')
  if (!btn) return
  const song = JSON.parse(decodeURIComponent(btn.dataset.song))
  if (btn.dataset.act === 'play') playSong(song)
  if (btn.dataset.act === 'dl') openDownloadModal(song)
})

btnSearch.addEventListener('click', () => doSearch({ resetPage: true }))
keywordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch({ resetPage: true })
})

loadSources().catch((err) => {
  toast(`加载音源失败: ${err.message}`, { error: true })
})

window.reloadSearchSources = () =>
  loadSources().catch((err) => {
    toast(`加载音源失败: ${err.message}`, { error: true })
  })
