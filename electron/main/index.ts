import { app, BrowserWindow, session, ipcMain } from 'electron'
import { join } from 'path'
import { registerHandlers, stopAllTunnels } from './ipc-handlers.js'
import { stopAllBridges } from '../services/websockify-bridge.js'

// Linux without root-owned chrome-sandbox
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Baseboard',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true
    }
  })

  // Accept self-signed certificates from BMC/IPMI devices
  session.defaultSession.setCertificateVerifyProc((_request, callback) => {
    callback(0) // 0 = accept
  })

  // Handle webview proxy and cookie setup for embedded IMM2/iDRAC consoles
  ipcMain.handle('webview:setup-proxy', async (_, proxyPort: number, partition: string, cookieStr?: string, url?: string) => {
    const ses = session.fromPartition(partition)
    if (proxyPort) {
      await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${proxyPort}` })
    }
    ses.setCertificateVerifyProc((_req, callback) => {
      callback(0)
    })

    // Inject session cookie so the webview is pre-authenticated
    if (cookieStr && url) {
      const match = cookieStr.match(/([^=]+)=(.+)/)
      if (match) {
        const parsedUrl = new URL(url)
        await ses.cookies.set({
          url: url,
          name: match[1],
          value: match[2],
          domain: parsedUrl.hostname,
          path: '/',
          secure: true,
          httpOnly: true
        })
      }
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  registerHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopAllBridges()
  stopAllTunnels()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopAllBridges()
  stopAllTunnels()
})
