const form = document.getElementById('importForm')
const body = document.getElementById('sourceBody')
const fileInput = document.getElementById('scriptFile')
const urlInput = document.getElementById('scriptUrl')
const importBtn = form.querySelector('button[type="submit"]')

let sourcesList = []
let importing = false

function clearForm() {
  form.reset()
}

function setImportBusy(busy) {
  importing = busy
  importBtn.disabled = busy
  urlInput.disabled = busy
  fileInput.disabled = busy
  importBtn.textContent = busy ? '导入中…' : '导入'
}

function notifySearchSources() {
  if (typeof window.reloadSearchSources === 'function') {
    window.reloadSearchSources()
  }
}

function renderList() {
  const escapeHtml = window.escapeHtml
  if (!sourcesList.length) {
    body.innerHTML =
      '<tr class="results-msg sources-empty"><td colspan="6">暂无音源，请先导入</td></tr>'
    return
  }
  body.innerHTML = sourcesList
    .map((s, idx) => {
      const desc = s.description
        ? `<div class="muted source-desc">${escapeHtml(s.description)}</div>`
        : ''
      return `<tr>
      <td class="col-order">
        <button type="button" class="small ghost order-btn" data-move="${s.id}" data-dir="up" ${idx === 0 ? 'disabled' : ''} title="上移">↑</button>
        <button type="button" class="small ghost order-btn" data-move="${s.id}" data-dir="down" ${idx === sourcesList.length - 1 ? 'disabled' : ''} title="下移">↓</button>
      </td>
      <td class="col-name">
        <div class="source-name">${escapeHtml(s.name)}</div>
        ${desc}
      </td>
      <td class="col-version">${escapeHtml(s.version || '-')}</td>
      <td class="col-author">${escapeHtml(s.author || '-')}</td>
      <td class="col-status"><span class="source-status ${s.enabled ? 'is-on' : 'is-off'}">${s.enabled ? '启用' : '禁用'}</span></td>
      <td class="col-actions">
        <button class="small" data-toggle="${s.id}" data-enabled="${s.enabled ? 1 : 0}">
          ${s.enabled ? '禁用' : '启用'}
        </button>
        <button class="small danger" data-del="${s.id}">删除</button>
      </td>
    </tr>`
    })
    .join('')
}

async function loadList() {
  sourcesList = await window.api('/api/sources')
  renderList()
}

async function moveSource(id, dir) {
  const idx = sourcesList.findIndex((s) => String(s.id) === String(id))
  if (idx < 0) return
  const j = dir === 'up' ? idx - 1 : idx + 1
  if (j < 0 || j >= sourcesList.length) return
  const ids = sourcesList.map((s) => s.id)
  ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
  sourcesList = await window.api('/api/sources/reorder', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
  renderList()
  notifySearchSources()
}

window.refreshSourceList = () =>
  loadList().catch((err) => {
    window.toast(err.message, { error: true })
  })

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (importing) return
  const url = urlInput.value.trim()
  const file = fileInput.files && fileInput.files[0]
  if (!url && !file) {
    window.toast('请填写脚本 URL，或选择本地 .js 文件', { error: true })
    return
  }
  setImportBusy(true)
  try {
    const script = file ? await file.text() : null
    const item = await window.api('/api/sources/import', {
      method: 'POST',
      body: JSON.stringify({ url: url || null, script: script || null }),
    })
    clearForm()
    window.toast(`已导入：${item.name}`)
    await loadList()
    notifySearchSources()
  } catch (err) {
    window.toast(`导入失败: ${err.message}`, { error: true, ms: 3200 })
  } finally {
    setImportBusy(false)
  }
})

body.addEventListener('click', async (e) => {
  const moveBtn = e.target.closest('button[data-move]')
  const toggleBtn = e.target.closest('button[data-toggle]')
  const delBtn = e.target.closest('button[data-del]')
  if (moveBtn) {
    try {
      await moveSource(moveBtn.dataset.move, moveBtn.dataset.dir)
    } catch (err) {
      window.toast(err.message, { error: true })
    }
    return
  }
  if (toggleBtn) {
    try {
      await window.api(`/api/sources/${toggleBtn.dataset.toggle}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: toggleBtn.dataset.enabled !== '1' }),
      })
      await loadList()
      notifySearchSources()
    } catch (err) {
      window.toast(err.message, { error: true })
    }
  }
  if (delBtn) {
    if (!confirm('确认删除该音源？')) return
    try {
      await window.api(`/api/sources/${delBtn.dataset.del}`, { method: 'DELETE' })
      await loadList()
      notifySearchSources()
    } catch (err) {
      window.toast(err.message, { error: true })
    }
  }
})

loadList().catch((err) => {
  window.toast(err.message, { error: true })
})
