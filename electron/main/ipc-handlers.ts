import { ipcMain, BrowserWindow } from 'electron'
import * as store from '../services/server-store.js'
import * as ipmi from '../services/ipmi-service.js'
import * as imm2 from '../services/imm2-service.js'
import * as bridge from '../services/websockify-bridge.js'
import { ensureSocksProxy, stopAllTunnels } from '../services/ssh-tunnel.js'
import type { PowerAction } from '../types/ipc-api.js'
import type { ServerConfig, SocksProxyConfig, ServerStatus } from '../types/server.js'

let pollInterval: ReturnType<typeof setInterval> | null = null

function useWebApi(server: ServerConfig): boolean {
  return server.type === 'imm2' || server.type === 'idrac'
}

// Resolve proxy: if SSH mode, spin up a local SOCKS tunnel automatically
async function resolveProxy(server: ServerConfig): Promise<SocksProxyConfig | undefined> {
  if (!server.proxy) return undefined

  // If proxy references a saved jump server, look it up
  if (server.proxy.mode === 'ssh' || (server.proxy as any).jumpId) {
    const jumpId = (server.proxy as any).jumpId
    let jump = jumpId ? store.getJumpServer(jumpId) : null
    const sshHost = jump?.host || server.proxy.host
    const sshPort = jump?.sshPort || server.proxy.sshPort || server.proxy.port || 22
    const sshUser = jump?.username || server.proxy.username || 'root'
    const localPort = await ensureSocksProxy(sshHost, sshPort, sshUser)
    return { host: '127.0.0.1', port: localPort }
  }

  return server.proxy
}

// Wrap a server with its proxy resolved to local SOCKS
async function withProxy(server: ServerConfig): Promise<ServerConfig> {
  const proxy = await resolveProxy(server)
  return { ...server, proxy }
}

export function registerHandlers(): void {
  // Server CRUD
  ipcMain.handle('server:list', () => store.listServers())
  ipcMain.handle('server:get', (_, id: string) => store.getServer(id))
  ipcMain.handle('server:add', (_, config, password: string) => store.addServer(config, password))
  ipcMain.handle('server:update', (_, id: string, config, password?: string) => store.updateServer(id, config, password))
  ipcMain.handle('server:delete', (_, id: string) => { store.deleteServer(id); store.deleteServerDataCache(id) })
  ipcMain.handle('server:duplicate', (_, id: string) => store.duplicateServer(id))

  // Project CRUD
  ipcMain.handle('project:list', () => store.listProjects())
  ipcMain.handle('project:get', (_, id: string) => store.getProject(id))
  ipcMain.handle('project:add', (_, config) => store.addProject(config))
  ipcMain.handle('project:update', (_, id: string, config) => store.updateProject(id, config))
  ipcMain.handle('project:delete', (_, id: string) => store.deleteProject(id))

  // Jump server CRUD
  ipcMain.handle('jump:list', () => store.listJumpServers())
  ipcMain.handle('jump:get', (_, id: string) => store.getJumpServer(id))
  ipcMain.handle('jump:add', (_, config) => store.addJumpServer(config))
  ipcMain.handle('jump:update', (_, id: string, config) => store.updateJumpServer(id, config))
  ipcMain.handle('jump:delete', (_, id: string) => store.deleteJumpServer(id))

  // Server data cache
  ipcMain.handle('cache:get-all', () => store.getAllServerDataCache())

  // Chassis status (auto-caches result)
  ipcMain.handle('ipmi:chassis-status', async (_, serverId: string) => {
    const server = store.getServer(serverId)
    if (!server) throw new Error('Server not found')
    const password = store.getPassword(serverId)
    const result = useWebApi(server)
      ? await imm2.getChassisStatus(await withProxy(server), password, null)
      : await ipmi.getChassisStatus(server, password)
    store.setServerDataCache(serverId, { chassis: result })
    return result
  })

  // Sensors (auto-caches result)
  ipcMain.handle('ipmi:sensors', async (_, serverId: string) => {
    const server = store.getServer(serverId)
    if (!server) throw new Error('Server not found')
    const password = store.getPassword(serverId)
    const result = useWebApi(server)
      ? await imm2.getSensorReadings(await withProxy(server), password, null)
      : await ipmi.getSensorReadings(server, password)
    store.setServerDataCache(serverId, { sensors: result })
    return result
  })

  // SEL
  ipcMain.handle('ipmi:sel', async (_, serverId: string) => {
    const server = store.getServer(serverId)
    if (!server) throw new Error('Server not found')
    const password = store.getPassword(serverId)
    return useWebApi(server)
      ? await imm2.getSelEntries(await withProxy(server), password, null)
      : await ipmi.getSelEntries(server, password)
  })

  // FRU info (auto-caches result)
  ipcMain.handle('ipmi:fru', async (_, serverId: string) => {
    const server = store.getServer(serverId)
    if (!server) throw new Error('Server not found')
    const password = store.getPassword(serverId)
    const result = useWebApi(server)
      ? await imm2.getFruInfo(await withProxy(server), password, null)
      : await ipmi.getFruInfo(server, password)
    store.setServerDataCache(serverId, { fru: result })
    return result
  })

  // Power control
  ipcMain.handle('ipmi:power', async (_, serverId: string, action: PowerAction) => {
    const server = store.getServer(serverId)
    if (!server) throw new Error('Server not found')
    const password = store.getPassword(serverId)
    if (useWebApi(server)) {
      const resolved = await withProxy(server)
      return imm2.powerControl(resolved, password, action, null)
    }
    return ipmi.powerControl(server, password, action)
  })

  // KVM console
  ipcMain.handle('kvm:start', async (_, serverId: string) => {
    const server = store.getServer(serverId)
    if (!server) throw new Error('Server not found')

    // For IMM2/iDRAC: pre-authenticate and load directly into console
    if (server.type === 'imm2' || server.type === 'idrac') {
      const resolved = await withProxy(server)
      const proxyPort = resolved.proxy?.port || 0
      const password = store.getPassword(server.id)

      // Pre-authenticate to get session cookie
      let sessionCookie = ''
      try {
        const loginResult = await imm2.loginForConsole(resolved, password, null)
        sessionCookie = loginResult.cookie
      } catch {
        // Fall back to manual login
      }

      return {
        localWsUrl: '',
        sessionId: `native-${Date.now()}`,
        nativeUrl: `https://${server.host}:${server.port}/`,
        nativeConsolePath: '/designs/imm/index-console.php',
        proxyPort,
        sessionCookie
      }
    }

    // For generic IPMI/Supermicro: use websockify bridge + noVNC
    const resolved = await withProxy(server)
    return bridge.startBridge(
      resolved.host,
      resolved.kvmPort || 3900,
      resolved.proxy,
      null,
      false
    )
  })

  ipcMain.handle('kvm:stop', (_, sessionId: string) => {
    bridge.stopBridge(sessionId)
  })

  // Polling
  ipcMain.on('polling:start', () => startPolling())
  ipcMain.on('polling:stop', () => stopPolling())
}

async function pollServer(server: ServerConfig): Promise<ServerStatus> {
  const status: ServerStatus = {
    serverId: server.id,
    powerOn: null,
    health: 'unknown',
    lastChecked: Date.now()
  }
  try {
    const password = store.getPassword(server.id)
    if (useWebApi(server)) {
      const resolved = await withProxy(server)
      const chassis = await imm2.getChassisStatus(resolved, password, null)
      status.powerOn = chassis.powerOn
      status.health = 'ok'
    } else {
      const chassis = await ipmi.getChassisStatus(server, password)
      status.powerOn = chassis.powerOn
      status.health = chassis.powerFault ? 'critical' : chassis.powerOverload ? 'warning' : 'ok'
    }
  } catch (err: any) {
    status.error = err.message
  }
  return status
}

function startPolling(): void {
  if (pollInterval) return
  const doPoll = async () => {
    const servers = store.listServers()
    const results = await Promise.allSettled(servers.map(pollServer))
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('server:status-update', r.value)
        })
      }
    })
  }
  doPoll()
  pollInterval = setInterval(doPoll, 60000)
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

export { stopAllTunnels }
