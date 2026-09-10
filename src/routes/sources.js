import { Router } from 'express'
import { dropRuntime, parseLxMeta } from '../lx/host.js'
import {
  deleteSource,
  getSource,
  listSources,
  reorderSources,
  setSourceEnabled,
  toPublicSource,
  upsertLxSource,
} from '../db.js'

const router = Router()

router.get('/', (_req, res) => {
  res.json(listSources().map(toPublicSource))
})

router.put('/reorder', (req, res) => {
  try {
    const list = reorderSources(req.body?.ids)
    res.json(list.map(toPublicSource))
  } catch (e) {
    res.status(400).json({ detail: e.message || String(e) })
  }
})

router.post('/import', async (req, res) => {
  try {
    let script = String(req.body?.script || '').trim()
    const scriptUrl = String(req.body?.url || '').trim() || null

    if (!script && !scriptUrl) {
      return res.status(400).json({ detail: '请填写音源脚本 URL，或选择本地文件' })
    }

    if (scriptUrl && !script) {
      const resp = await fetch(scriptUrl, {
        headers: { 'User-Agent': 'MusicDL/0.1' },
        redirect: 'follow',
      })
      if (!resp.ok) {
        return res.status(400).json({ detail: `下载音源脚本失败: HTTP ${resp.status}` })
      }
      script = await resp.text()
    }

    // Best approach / LX-aligned: import only parses header + stores script.
    const meta = parseLxMeta(script)

    const item = upsertLxSource({
      name: meta.name,
      version: meta.version,
      author: meta.author,
      homepage: meta.homepage,
      scriptUrl,
      script,
      description: meta.description,
    })
    // Script may have changed — drop stale in-memory qualityList
    dropRuntime(item.id)

    res.status(201).json(toPublicSource(item))
  } catch (e) {
    res.status(400).json({ detail: e.message || String(e) })
  }
})

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const item = getSource(id)
  if (!item) return res.status(404).json({ detail: '音源不存在' })
  if (typeof req.body?.enabled === 'boolean') {
    const updated = setSourceEnabled(id, req.body.enabled)
    return res.json(toPublicSource(updated))
  }
  res.json(toPublicSource(item))
})

router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    const ok = deleteSource(id)
    if (!ok) return res.status(404).json({ detail: '音源不存在' })
    dropRuntime(id)
    res.status(204).end()
  } catch (e) {
    res.status(400).json({ detail: e.message || String(e) })
  }
})

export default router
