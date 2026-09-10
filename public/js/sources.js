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
  return res.json()
}

const form = document.getElementById('importForm')
const body = document.getElementById('sourceBody')
const statusEl = document.getElementById('importStatus')
const fileInput = document.getElementById('scriptFile')
const urlInput = document.getElementById('scriptUrl')

let sourcesList = []

function clearForm() {
  form.reset()
  statusEl.textContent = ''
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function notifySearchSources() {
  if (typeof window.reloadSearchSources === 'function') {
    window.reloadSearchSources()
  }
}

function renderList() {
  body.innerHTML = sourcesList
    .map((s, idx) => {
      const desc = s.description
        ? `<div class="muted">${escapeHtml(s.description)}</div>`
        : ''
      return `<tr>
      <td class="col-order">
        <button type="button" class="small ghost order-btn" data-move="${s.id}" data-dir="up" ${idx === 0 ? 'disabled' : ''} title="上移">↑</button>
        <button type="button" class="small ghost order-btn" data-move="${s.id}" data-dir="down" ${idx === sourcesList.length - 1 ? 'disabled' : ''} title="下移">↓</button>
      </td>
      <td>
        <div>${escapeHtml(s.name)}</div>
        ${desc}
      </td>
      <td>${escapeHtml(s.version || '-')}</td>
      <td>${escapeHtml(s.author || '-')}</td>
      <td><span class="source-status ${s.enabled ? 'is-on' : 'is-off'}">${s.enabled ? '启用' : '禁用'}</span></td>
      <td>
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
  sourcesList = await api('/api/sources')
  renderList()
}

async function moveSource(id, dir) {
  const idx = sourcesList.findIndex((s) => String(s.id) === String(id))
  if (idx < 0) return
  const j = dir === 'up' ? idx - 1 : idx + 1
  if (j < 0 || j >= sourcesList.length) return
  const ids = sourcesList.map((s) => s.id)
  ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
  sourcesList = await api('/api/sources/reorder', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
  renderList()
  notifySearchSources()
}

window.refreshSourceList = () =>
  loadList().catch((err) => {
    statusEl.textContent = err.message
  })

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = urlInput.value.trim()
  const file = fileInput.files && fileInput.files[0]
  let script = null
  if (file) script = await file.text()
  if (!url && !script) {
    statusEl.textContent = '请填写脚本 URL，或选择本地 .js 文件'
    return
  }
  statusEl.textContent = '导入中…'
  try {
    const item = await api('/api/sources/import', {
      method: 'POST',
      body: JSON.stringify({ url: url || null, script: script || null }),
    })
    clearForm()
    statusEl.textContent = `已导入：${item.name}`
    await loadList()
    notifySearchSources()
  } catch (err) {
    statusEl.textContent = `导入失败: ${err.message}`
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
      alert(err.message)
    }
    return
  }
  if (toggleBtn) {
    try {
      await api(`/api/sources/${toggleBtn.dataset.toggle}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: toggleBtn.dataset.enabled !== '1' }),
      })
      await loadList()
      notifySearchSources()
    } catch (err) {
      alert(err.message)
    }
  }
  if (delBtn) {
    if (!confirm('确认删除该音源？')) return
    try {
      await api(`/api/sources/${delBtn.dataset.del}`, { method: 'DELETE' })
      await loadList()
      notifySearchSources()
    } catch (err) {
      alert(err.message)
    }
  }
})

loadList().catch((err) => {
  statusEl.textContent = err.message
})
