import { WebSocketServer, WebSocket } from 'ws'
import net from 'net'
import tls from 'tls'
import { createServer } from 'http'
import { createTcpConnection } from './socks-tunnel.js'
import { SocksClient } from 'socks'
import type { SocksProxyConfig } from '../types/server.js'

interface BridgeSession {
  id: string
  localPort: number
  httpServer: ReturnType<typeof createServer>
  wss: WebSocketServer
  remoteWs: WebSocket | null
  tcpSocket: net.Socket | null
  targetHost: string
  targetPort: number
}

const sessions = new Map<string, BridgeSession>()

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('Could not get port')))
      }
    })
    srv.on('error', reject)
  })
}

let sessionCounter = 0

// WebSocket-to-WebSocket bridge (for IMM2/iDRAC HTML5 consoles that speak WebSocket natively)
export async function startWsBridge(
  targetHost: string,
  targetPort: number,
  proxy?: SocksProxyConfig,
  proxyPassword?: string | null
): Promise<{ localWsUrl: string; sessionId: string }> {
  const localPort = await findFreePort()
  const sessionId = `kvm-ws-${++sessionCounter}-${Date.now()}`

  const httpServer = createServer()
  const wss = new WebSocketServer({ server: httpServer })

  const session: BridgeSession = {
    id: sessionId,
    localPort,
    httpServer,
    wss,
    remoteWs: null,
    tcpSocket: null,
    targetHost,
    targetPort
  }

  wss.on('connection', async (localWs: WebSocket) => {
    try {
      let remoteWs: WebSocket

      if (proxy) {
        // Pre-establish SOCKS TCP connection, then TLS, then WebSocket upgrade
        const socksResult = await SocksClient.createConnection({
          proxy: {
            host: proxy.host,
            port: proxy.port,
            type: 5 as const,
            ...(proxy.username ? { userId: proxy.username, password: proxyPassword ?? undefined } : {})
          },
          command: 'connect' as const,
          destination: { host: targetHost, port: targetPort },
          timeout: 10000
        })

        const tlsSocket = tls.connect({
          socket: socksResult.socket,
          rejectUnauthorized: false,
          minVersion: 'TLSv1' as any,
        })

        await new Promise<void>((resolve, reject) => {
          tlsSocket.on('secureConnect', () => resolve())
          tlsSocket.on('error', reject)
          setTimeout(() => reject(new Error('TLS handshake timeout')), 10000)
        })

        console.log(`[bridge:${sessionId}] TLS connected through SOCKS, upgrading to WebSocket...`)

        // ws library: pass pre-connected TLS socket via createConnection
        const wsUrl = `wss://${targetHost}:${targetPort}/`
        remoteWs = new WebSocket(wsUrl, {
          perMessageDeflate: false,
          createConnection: () => tlsSocket
        } as any)
      } else {
        const wsUrl = `wss://${targetHost}:${targetPort}/`
        remoteWs = new WebSocket(wsUrl, ['binary'], {
          rejectUnauthorized: false,
          perMessageDeflate: false
        })
      }

      session.remoteWs = remoteWs

      remoteWs.on('open', () => {
        console.log(`[bridge:${sessionId}] Remote WebSocket connected`)
      })

      // Remote -> Local
      remoteWs.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        if (localWs.readyState === WebSocket.OPEN) {
          if (Buffer.isBuffer(data)) {
            localWs.send(data)
          } else if (data instanceof ArrayBuffer) {
            localWs.send(Buffer.from(data))
          } else if (Array.isArray(data)) {
            localWs.send(Buffer.concat(data))
          }
        }
      })

      // Local -> Remote
      localWs.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        if (remoteWs.readyState === WebSocket.OPEN) {
          if (Buffer.isBuffer(data)) {
            remoteWs.send(data)
          } else if (data instanceof ArrayBuffer) {
            remoteWs.send(Buffer.from(data))
          } else if (Array.isArray(data)) {
            remoteWs.send(Buffer.concat(data))
          }
        }
      })

      remoteWs.on('close', (code, reason) => {
        console.log(`[bridge:${sessionId}] Remote WS closed: ${code} ${reason}`)
        if (localWs.readyState === WebSocket.OPEN) localWs.close()
      })

      remoteWs.on('error', (err) => {
        console.error(`[bridge:${sessionId}] Remote WS error:`, err.message)
        if (localWs.readyState === WebSocket.OPEN) localWs.close(1011, err.message)
      })

      localWs.on('close', () => {
        if (remoteWs.readyState === WebSocket.OPEN) remoteWs.close()
      })

      localWs.on('error', (err) => {
        console.error(`[bridge:${sessionId}] Local WS error:`, err.message)
        if (remoteWs.readyState === WebSocket.OPEN) remoteWs.close()
      })

    } catch (err: any) {
      console.error(`[bridge:${sessionId}] Connection failed:`, err.message)
      localWs.close(1011, err.message)
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(localPort, '127.0.0.1', () => resolve())
    httpServer.on('error', reject)
  })

  sessions.set(sessionId, session)
  console.log(`[bridge:${sessionId}] WS bridge on ws://127.0.0.1:${localPort} -> wss://${targetHost}:${targetPort}`)

  return {
    localWsUrl: `ws://127.0.0.1:${localPort}`,
    sessionId
  }
}

// TCP bridge (for standard VNC servers that speak raw RFB over TCP)
export async function startTcpBridge(
  targetHost: string,
  targetPort: number,
  proxy?: SocksProxyConfig,
  proxyPassword?: string | null
): Promise<{ localWsUrl: string; sessionId: string }> {
  const localPort = await findFreePort()
  const sessionId = `kvm-tcp-${++sessionCounter}-${Date.now()}`

  const httpServer = createServer()
  const wss = new WebSocketServer({ server: httpServer })

  const session: BridgeSession = {
    id: sessionId,
    localPort,
    httpServer,
    wss,
    remoteWs: null,
    tcpSocket: null,
    targetHost,
    targetPort
  }

  wss.on('connection', async (ws: WebSocket) => {
    try {
      const tcpSocket = await createTcpConnection(targetHost, targetPort, proxy, proxyPassword)
      session.tcpSocket = tcpSocket

      tcpSocket.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data)
      })

      ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        if (!tcpSocket.destroyed) {
          if (Buffer.isBuffer(data)) tcpSocket.write(data)
          else if (data instanceof ArrayBuffer) tcpSocket.write(Buffer.from(data))
          else if (Array.isArray(data)) for (const chunk of data) tcpSocket.write(chunk)
        }
      })

      tcpSocket.on('close', () => { if (ws.readyState === WebSocket.OPEN) ws.close() })
      tcpSocket.on('error', (err) => { if (ws.readyState === WebSocket.OPEN) ws.close(1011, err.message) })
      ws.on('close', () => { if (!tcpSocket.destroyed) tcpSocket.destroy() })
      ws.on('error', () => { if (!tcpSocket.destroyed) tcpSocket.destroy() })
    } catch (err: any) {
      console.error(`[bridge:${sessionId}] TCP connection failed:`, err.message)
      ws.close(1011, err.message)
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(localPort, '127.0.0.1', () => resolve())
    httpServer.on('error', reject)
  })

  sessions.set(sessionId, session)
  console.log(`[bridge:${sessionId}] TCP bridge on ws://127.0.0.1:${localPort} -> ${targetHost}:${targetPort}`)

  return {
    localWsUrl: `ws://127.0.0.1:${localPort}`,
    sessionId
  }
}

// Auto-select bridge type based on server type
export async function startBridge(
  targetHost: string,
  targetPort: number,
  proxy?: SocksProxyConfig,
  proxyPassword?: string | null,
  useWebSocket?: boolean
): Promise<{ localWsUrl: string; sessionId: string }> {
  if (useWebSocket) {
    return startWsBridge(targetHost, targetPort, proxy, proxyPassword)
  }
  return startTcpBridge(targetHost, targetPort, proxy, proxyPassword)
}

export function stopBridge(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return

  if (session.remoteWs && session.remoteWs.readyState === WebSocket.OPEN) {
    session.remoteWs.close()
  }
  if (session.tcpSocket && !session.tcpSocket.destroyed) {
    session.tcpSocket.destroy()
  }
  session.wss.clients.forEach(ws => ws.close())
  session.wss.close()
  session.httpServer.close()
  sessions.delete(sessionId)
  console.log(`[bridge:${sessionId}] Stopped`)
}

export function stopAllBridges(): void {
  for (const id of sessions.keys()) {
    stopBridge(id)
  }
}
