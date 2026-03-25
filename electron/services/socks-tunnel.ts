import net from 'net'
import { SocksClient } from 'socks'
import type { SocksProxyConfig } from '../types/server.js'

export async function createSocksConnection(
  proxy: SocksProxyConfig,
  proxyPassword: string | null,
  targetHost: string,
  targetPort: number
): Promise<net.Socket> {
  const socksOptions: any = {
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: 5 as const,
      ...(proxy.username ? {
        userId: proxy.username,
        password: proxyPassword ?? undefined
      } : {})
    },
    command: 'connect' as const,
    destination: {
      host: targetHost,
      port: targetPort
    },
    timeout: 10000
  }

  const { socket } = await SocksClient.createConnection(socksOptions)
  return socket
}

export async function createTcpConnection(
  host: string,
  port: number,
  proxy?: SocksProxyConfig,
  proxyPassword?: string | null
): Promise<net.Socket> {
  if (proxy) {
    return createSocksConnection(proxy, proxyPassword ?? null, host, port)
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: 10000 }, () => {
      resolve(socket)
    })
    socket.once('error', reject)
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error(`TCP connection to ${host}:${port} timed out`))
    })
  })
}
