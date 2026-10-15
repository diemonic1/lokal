// Module hooks for the tests (see test-setup.mjs): the app's sources are
// written for Vite, which finds `./i18n` as i18n.jsx and compiles JSX.
// Node does neither, so these do it the same way: an extensionless relative
// import is tried as .js, .jsx, then a folder's index; .jsx is compiled with
// rolldown's transformer (the one Vite uses).

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.js', '.jsx', '.mjs', '/index.js', '/index.jsx']

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    if (!relative || !context.parentURL || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    for (const extension of EXTENSIONS) {
      const url = new URL(specifier + extension, context.parentURL)
      if (fs.existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
    }
    throw error
  }
}

let transformSync = null
export async function load(url, context, nextLoad) {
  if (!url.endsWith('.jsx')) return nextLoad(url, context)
  transformSync ||= (await import('rolldown/utils')).transformSync
  const filename = fileURLToPath(url)
  const { code, errors } = transformSync(filename, fs.readFileSync(filename, 'utf8'), { jsx: { runtime: 'automatic' } })
  if (errors?.length) throw new Error(`${filename}: ${errors.map(e => e.message || e).join('; ')}`)
  return { format: 'module', source: code, shortCircuit: true }
}
