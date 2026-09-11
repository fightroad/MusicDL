/**
 * Child worker: createLxRuntime + musicUrl, write { ok, url, meta }.
 * Usage: node resolve-worker.js <scriptPath> <reqPath> <outPath>
 */
import fs from 'node:fs'
import { createLxRuntime } from './host.js'

const [, , scriptPath, reqPath, outPath] = process.argv

function writeOut(payload) {
  fs.writeFileSync(outPath, JSON.stringify(payload), 'utf8')
}

async function main() {
  const script = fs.readFileSync(scriptPath, 'utf8')
  const request = JSON.parse(fs.readFileSync(reqPath, 'utf8'))
  const runtime = await createLxRuntime(script)
  try {
    const url = await runtime.request(request)
    writeOut({
      ok: true,
      url,
      meta: {
        platforms: runtime.meta.platforms,
        qualitys: runtime.meta.qualitys,
        platformQualitys: runtime.meta.platformQualitys,
      },
    })
  } finally {
    runtime.dispose()
  }
}

main().catch((err) => {
  try {
    writeOut({ ok: false, error: err?.message || String(err) })
  } catch {
    // ignore
  }
  process.exitCode = 1
})
