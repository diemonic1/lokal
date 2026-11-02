// A local pipe the app listens on for the quick player (./quick/main.js), a
// process of its own: it pauses the app as one of its windows starts playing.
// Only { "action": "pause" } is taken, one JSON object a line.

const net = require('net')
const os = require('os')
const path = require('path')
const fs = require('fs')

const NAME = `lokal-music-control-${String(os.userInfo().username || 'user').replace(/[^\w.-]/g, '_')}`
const PIPE_PATH = process.platform === 'win32' ? `\\\\.\\pipe\\${NAME}` : path.join(os.tmpdir(), `${NAME}.sock`)
const ACTIONS = new Set(['pause'])

/** Listens for commands; onCommand(action) for each one taken. -> the server, or null. */
function listenForControl(onCommand) {
  if (process.platform !== 'win32') { try { fs.unlinkSync(PIPE_PATH) } catch {} }
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5000, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('data', (chunk) => {
      buffer += chunk
      if (buffer.length > 4096) { socket.destroy(); return }
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const action = JSON.parse(line)?.action
          if (ACTIONS.has(action)) onCommand(action)
        } catch {}
      }
    })
  })
  server.on('error', (e) => console.warn('[controlPipe] not listening:', e.message))
  try { server.listen(PIPE_PATH) } catch (e) { console.warn('[controlPipe] not listening:', e.message); return null }
  return server
}

module.exports = { PIPE_PATH, listenForControl }
