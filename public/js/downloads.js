const downloadBody = document.getElementById('downloadBody')
const downloadSummary = document.getElementById('downloadSummary')

function formatDownloadTime(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function renderDownloads(list) {
  const escapeHtml = window.escapeHtml
  const formatSize = window.formatSize
  if (downloadSummary) downloadSummary.textContent = `共 ${list.length} 首`
  if (!list.length) {
    downloadBody.innerHTML =
      '<tr class="results-msg downloads-empty"><td colspan="4">暂无下载音乐</td></tr>'
    return
  }
  downloadBody.innerHTML = list
    .map((f) => {
      const name = escapeHtml(f.filename)
      const size = escapeHtml(formatSize(f.size) || '-')
      const time = escapeHtml(formatDownloadTime(f.mtime))
      const key = encodeURIComponent(f.filename)
      return `<tr>
        <td class="col-file" title="${name}">
          <div class="dl-file-name">${name}</div>
          <div class="muted dl-file-meta">${size} · ${time}</div>
        </td>
        <td class="col-size">${size}</td>
        <td class="col-time">${time}</td>
        <td class="col-actions">
          <button type="button" class="small" data-play-file="${key}">播放</button>
          <button type="button" class="small danger" data-del-file="${key}">删除</button>
        </td>
      </tr>`
    })
    .join('')
}

async function loadDownloads() {
  const data = await window.api('/api/music/files')
  renderDownloads(data.list || [])
}

window.refreshDownloadList = () =>
  loadDownloads().catch((err) => {
    window.toast(err.message, { error: true })
  })

downloadBody.addEventListener('click', async (e) => {
  const playBtn = e.target.closest('button[data-play-file]')
  if (playBtn) {
    const filename = decodeURIComponent(playBtn.dataset.playFile || '')
    if (!filename || typeof window.playLocalFile !== 'function') return
    window.playLocalFile(filename)
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
