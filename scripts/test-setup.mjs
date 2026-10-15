// `npm test` runs every test with this first (node --import): the module
// hooks in test-hooks.mjs let them import the app's Vite-style sources.
import { register } from 'node:module'

register('./test-hooks.mjs', import.meta.url)
