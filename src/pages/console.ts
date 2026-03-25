import { el, clear, navigate } from '../lib/dom.js'

export function renderConsole(container: HTMLElement, params: Record<string, string>): (() => void) | void {
  clear(container)
  const serverId = params.id
  let sessionId: string | null = null
  let rfb: any = null

  const consoleContainer = el('div', { className: 'console-container' })
  const toolbar = el('div', { className: 'console-toolbar' })
  const viewport = el('div', { className: 'console-viewport' })
  const statusEl = el('span', { className: 'console-status' }, 'Connecting...')

  const disconnectBtn = el('button', { className: 'btn btn-sm btn-danger' }, 'Back')
  toolbar.appendChild(disconnectBtn)
  toolbar.appendChild(statusEl)

  consoleContainer.appendChild(toolbar)
  consoleContainer.appendChild(viewport)
  container.appendChild(consoleContainer)

  disconnectBtn.onclick = async () => {
    await cleanup()
    navigate(`#/server/${serverId}`)
  }

  async function connect() {
    try {
      statusEl.textContent = 'Starting console...'
      const result = await (window as any).api.startKvmSession(serverId)
      sessionId = result.sessionId

      // Native mode (IMM2/iDRAC): embed the actual web UI via webview
      if (result.nativeUrl) {
        const partition = `persist:kvm-${serverId}`

        // Set up SOCKS proxy, cert bypass, and inject session cookie
        await (window as any).api.setupWebviewProxy(
          result.proxyPort || 0,
          partition,
          result.sessionCookie || '',
          result.nativeUrl
        )

        // If we have a session cookie, load directly into the console page
        const targetUrl = result.sessionCookie
          ? result.nativeUrl.replace(/\/$/, '') + (result.nativeConsolePath || '/designs/imm/index-console.php')
          : result.nativeUrl

        statusEl.textContent = result.sessionCookie ? 'Loading console...' : 'Loading web interface...'

        const webview = document.createElement('webview') as any
        webview.setAttribute('src', targetUrl)
        webview.setAttribute('partition', partition)
        webview.setAttribute('allowpopups', '')
        webview.style.width = '100%'
        webview.style.height = '100%'
        webview.style.border = 'none'

        webview.addEventListener('did-finish-load', () => {
          statusEl.textContent = 'Connected'
          statusEl.style.color = 'var(--success)'
          // Force light theme inside the webview so IMM2/iDRAC pages render correctly
          webview.insertCSS(':root, body { color-scheme: light !important; background: #fff !important; color: #000 !important; } input, select, textarea { color-scheme: light !important; }')
        })

        webview.addEventListener('did-fail-load', (_e: any) => {
          statusEl.textContent = 'Failed to load — check connection'
          statusEl.style.color = 'var(--danger)'
        })

        viewport.appendChild(webview)
        return
      }

      // noVNC mode (generic IPMI/Supermicro)
      const ctrlAltDelBtn = el('button', { className: 'btn btn-sm btn-ghost' }, 'Ctrl+Alt+Del')
      const scaleBtn = el('button', { className: 'btn btn-sm btn-ghost' }, 'Fit to Window')
      const fullscreenBtn = el('button', { className: 'btn btn-sm btn-ghost' }, 'Fullscreen')

      toolbar.insertBefore(fullscreenBtn, statusEl)
      toolbar.insertBefore(scaleBtn, statusEl)
      toolbar.insertBefore(ctrlAltDelBtn, statusEl)

      let scaling = true

      ctrlAltDelBtn.onclick = () => { if (rfb) rfb.sendCtrlAltDel() }
      scaleBtn.onclick = () => {
        scaling = !scaling
        if (rfb) rfb.scaleViewport = scaling
        scaleBtn.textContent = scaling ? 'Fit to Window' : '1:1 Scale'
      }
      fullscreenBtn.onclick = () => {
        if (document.fullscreenElement) document.exitFullscreen()
        else consoleContainer.requestFullscreen()
      }

      statusEl.textContent = 'Loading VNC client...'
      const noVNC = await import('../vendor/novnc/rfb.js')
      const RFB = noVNC.default

      statusEl.textContent = 'Connecting to console...'
      rfb = new RFB(viewport, result.localWsUrl, { wsProtocols: ['binary'] })
      rfb.scaleViewport = scaling
      rfb.resizeSession = false
      rfb.clipViewport = true
      rfb.background = '#000000'

      rfb.addEventListener('connect', () => {
        statusEl.textContent = 'Connected'
        statusEl.style.color = 'var(--success)'
      })

      rfb.addEventListener('disconnect', (e: any) => {
        statusEl.textContent = e.detail?.clean ? 'Disconnected' : 'Connection lost'
        statusEl.style.color = 'var(--danger)'
      })

      rfb.addEventListener('credentialsrequired', () => {
        const password = prompt('VNC password required:')
        if (password) rfb.sendCredentials({ password })
      })
    } catch (err: any) {
      statusEl.textContent = 'Error: ' + err.message
      statusEl.style.color = 'var(--danger)'
    }
  }

  async function cleanup() {
    if (rfb) { try { rfb.disconnect() } catch {} rfb = null }
    if (sessionId) { await (window as any).api.stopKvmSession(sessionId); sessionId = null }
  }

  connect()
  return () => { cleanup() }
}
