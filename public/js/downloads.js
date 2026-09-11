const downloadBody = document.getElementById('downloadBody')
const downloadSummary = document.getElementById('downloadSummary')
const btnRefreshDownloads = document.getElementById('btnRefreshDownloads')
const downloadsTableWrap = document.querySelector('#viewDownloads .downloads-table')

function formatDownloadTime(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function scrollDownloadsToTop() {
  if (downloadsTableWrap) downloadsTableWrap.scrollTop = 0
  const panel = document.getElementById('viewDownloads')
  if (panel) panel.scrollTop = 0
}

function renderDownloads(list) {
  const escapeHtml = window.escapeHtml
  const formatSize = window.formatSize
  if (downloadSummary) downloadSummary.textContent = `共 ${list.length} 首`
  if (!list.length) {
    downloadBody.innerHTML =
      '<tr class="results-msg downloads-empty"><td colspan="5">暂无下载音乐</td></tr>'
    return
  }
  downloadBody.innerHTML = list
    .map((f, idx) => {
      const name = escapeHtml(f.filename)
      const size = escapeHtml(formatSize(f.size) || '-')
      const time = escapeHtml(formatDownloadTime(f.mtime))
      const key = encodeURIComponent(f.filename)
      return `<tr>
        <td class="col-idx">${idx + 1}</td>
        <td class="col-file" title="${name}">
          <div class="dl-file-name">${name}</div>
          <div class="muted dl-file-meta">${size} · ${time}</div>
        </td>
        <td class="col-size">${size}</td>
        <td class="col-time">${time}</td>
        <td class="col-actions">
          <button type="button" class="small" data-play-file="${key}">播放</button>
          <button type="button" class="small" data-save-file="${key}">下载</button>
          <button type="button" class="small danger" data-del-file="${key}">删除</button>
        </td>
      </tr>`
    })
    .join('')
}

async function loadDownloads({ scrollTop = false } = {}) {
  const data = await window.api('/api/music/files')
  renderDownloads(data.list || [])
  if (scrollTop) scrollDownloadsToTop()
}

window.refreshDownloadList = () =>
  loadDownloads().catch((err) => {
    window.toast(err.message, { error: true })
  })

btnRefreshDownloads?.addEventListener('click', async () => {
  try {
    await loadDownloads({ scrollTop: true })
    window.toast('列表已刷新')
  } catch (err) {
    window.toast(err.message, { error: true })
  }
})

downloadBody.addEventListener('click', async (e) => {
  const playBtn = e.target.closest('button[data-play-file]')
  if (playBtn) {
    const filename = decodeURIComponent(playBtn.dataset.playFile || '')
    if (!filename || typeof window.playLocalFile !== 'function') return
    window.playLocalFile(filename)
    return
  }

  const saveBtn = e.target.closest('button[data-save-file]')
  if (saveBtn) {
    const filename = decodeURIComponent(saveBtn.dataset.saveFile || '')
    if (!filename) return
    const a = document.createElement('a')
    a.href = `/api/music/files/${encodeURIComponent(filename)}?download=1`
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    return
  }

  const btn = e.target.closest('button[data-del-file]')
  if (!btn) return
  const filename = decodeURIComponent(btn.dataset.delFile || '')
  if (!filename) return
  if (!confirm(`确认删除文件？\n${filename}`)) return
  try {
    await window.api(`/api/music/files/${encodeURIComponent(filename)}`, { method: 'DELETE' })
    window.toast(`已删除：${filename}`)
    await loadDownloads()
  } catch (err) {
    window.toast(`删除失败: ${err.message}`, { error: true })
  }
})
