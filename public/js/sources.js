const form = document.getElementById('importForm')
const body = document.getElementById('sourceBody')
const fileInput = document.getElementById('scriptFile')
const urlInput = document.getElementById('scriptUrl')
const importBtn = form.querySelector('button[type="submit"]')
const btnFetchBundle = document.getElementById('btnFetchBundle')
const bundleModal = document.getElementById('bundleModal')
const bundleTitle = document.getElementById('bundleTitle')
const bundleSub = document.getElementById('bundleSub')
const bundleList = document.getElementById('bundleList')
const bundleStatus = document.getElementById('bundleStatus')
const bundleCount = document.getElementById('bundleCount')
const bundleCheckAll = document.getElementById('bundleCheckAll')
const bundleImport = document.getElementById('bundleImport')
const bundleCancel = document.getElementById('bundleCancel')
const bundleClose = document.getElementById('bundleClose')

let sourcesList = []
let importing = false
let bundleBusy = false

function clearForm() {
  form.reset()
}

function setImportBusy(busy) {
  importing = busy
  importBtn.disabled = busy
  urlInput.disabled = busy
  fileInput.disabled = busy
  if (btnFetchBundle) btnFetchBundle.disabled = busy || bundleBusy
  importBtn.textContent = busy ? '导入中…' : '导入'
}

function setBundleBusy(busy) {
  bundleBusy = busy
  if (btnFetchBundle) {
    btnFetchBundle.disabled = busy || importing
    btnFetchBundle.textContent = busy ? '拉取中…' : '拉取最新音源包'
  }
  if (bundleImport) bundleImport.disabled = busy
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

function selectedBundleKeys() {
  return [...bundleList.querySelectorAll('input[data-bundle-key]:checked')].map(
    (el) => el.dataset.bundleKey
  )
}

function syncBundleCheckAll() {
  const boxes = [...bundleList.querySelectorAll('input[data-bundle-key]')]
  if (!boxes.length) {
    bundleCheckAll.checked = false
    bundleCheckAll.indeterminate = false
    bundleCount.textContent = ''
    return
  }
  const checked = boxes.filter((b) => b.checked).length
  bundleCheckAll.checked = checked === boxes.length
  bundleCheckAll.indeterminate = checked > 0 && checked < boxes.length
  bundleCount.textContent = `已选 ${checked} / ${boxes.length}`
}

function renderBundleList(scripts) {
  const escapeHtml = window.escapeHtml
  const list = scripts || []
  if (!list.length) {
    bundleList.innerHTML =
      '<li class="bundle-item"><div class="muted">包内没有可识别的音源脚本</div></li>'
    syncBundleCheckAll()
    return
  }
  bundleList.innerHTML = list
    .map((s) => {
      const ver = s.version || '-'
      const author = s.author || '-'
      let badge = `<span class="bundle-badge is-new">未导入</span>`
      if (s.updateAvailable) {
        badge = `<span class="bundle-badge is-update">可更新</span>`
      } else if (s.imported) {
        badge = `<span class="bundle-badge is-old">已导入</span>`
      }
      return `<li class="bundle-item">
        <input type="checkbox" data-bundle-key="${escapeHtml(s.key)}" />
        <div class="bundle-item-main">
          <div class="bundle-item-head">
            <div class="bundle-item-name">${escapeHtml(s.name)}</div>
            ${badge}
          </div>
          <div class="bundle-item-meta">${escapeHtml(ver)} · ${escapeHtml(author)}</div>
        </div>
      </li>`
    })
    .join('')
  syncBundleCheckAll()
}

function openBundleModal(data) {
  bundleTitle.textContent = '最新音源包'
  const when = data.publishedAt ? new Date(data.publishedAt).toLocaleString() : ''
  bundleSub.textContent = [data.tag ? `版本 ${data.tag}` : '', when].filter(Boolean).join(' · ')
  bundleStatus.textContent = ''
  renderBundleList(data.scripts || [])
  bundleModal.hidden = false
}

function closeBundleModal() {
  bundleModal.hidden = true
  bundleStatus.textContent = ''
}

btnFetchBundle?.addEventListener('click', async () => {
  if (bundleBusy || importing) return
  setBundleBusy(true)
  try {
    const data = await window.api('/api/sources/bundle/latest?force=1')
    openBundleModal(data)
  } catch (err) {
    window.toast(`拉取失败: ${err.message}`, { error: true, ms: 3600 })
  } finally {
    setBundleBusy(false)
  }
})

bundleCheckAll?.addEventListener('change', () => {
  const on = bundleCheckAll.checked
  bundleList.querySelectorAll('input[data-bundle-key]').forEach((el) => {
    el.checked = on
  })
  syncBundleCheckAll()
})

bundleList?.addEventListener('change', (e) => {
  if (e.target.matches('input[data-bundle-key]')) syncBundleCheckAll()
})

bundleList?.addEventListener('click', (e) => {
  const item = e.target.closest('.bundle-item')
  if (!item || e.target.matches('input')) return
  const box = item.querySelector('input[data-bundle-key]')
  if (!box) return
  box.checked = !box.checked
  syncBundleCheckAll()
})

bundleImport?.addEventListener('click', async () => {
  const keys = selectedBundleKeys()
  if (!keys.length) {
    window.toast('请先勾选要导入的音源', { error: true })
    return
  }
  setBundleBusy(true)
  bundleStatus.textContent = `正在导入 ${keys.length} 个音源…`
  try {
    const result = await window.api('/api/sources/bundle/import', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    })
    const ok = result.importedCount || 0
    const fail = result.failedCount || 0
    if (ok) {
      window.toast(fail ? `已导入 ${ok} 个，失败 ${fail} 个` : `已导入 ${ok} 个音源`)
      await loadList()
      notifySearchSources()
      closeBundleModal()
    } else {
      const msg = result.failed?.[0]?.error || '导入失败'
      bundleStatus.textContent = msg
      window.toast(msg, { error: true })
    }
  } catch (err) {
    bundleStatus.textContent = err.message
    window.toast(`导入失败: ${err.message}`, { error: true, ms: 3200 })
  } finally {
    setBundleBusy(false)
  }
})

bundleCancel?.addEventListener('click', closeBundleModal)
bundleClose?.addEventListener('click', closeBundleModal)
bundleModal?.addEventListener('click', (e) => {
  if (e.target === bundleModal) closeBundleModal()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bundleModal && !bundleModal.hidden) closeBundleModal()
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
