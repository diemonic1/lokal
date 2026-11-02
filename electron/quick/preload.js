// The quick player window's bridge (./main.js): window.quick.

const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('quick', {
  info: (file) => ipcRenderer.invoke('quick:info', file),
  cover: (file) => ipcRenderer.invoke('quick:cover', file),
  siblings: (file) => ipcRenderer.invoke('quick:siblings', file),
  playable: (file) => ipcRenderer.invoke('quick:playable', file),
  showInFolder: (file) => ipcRenderer.invoke('quick:showInFolder', file),
  close: () => ipcRenderer.invoke('quick:close'),
  minimize: () => ipcRenderer.invoke('quick:minimize'),
  setPinned: (pinned) => ipcRenderer.invoke('quick:setPinned', pinned),
  playing: () => ipcRenderer.invoke('quick:playing'),
  onPause: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('quick:pause', listener)
    return () => ipcRenderer.removeListener('quick:pause', listener)
  },
  // A file dropped on the window.
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) } catch { return '' } },
})
