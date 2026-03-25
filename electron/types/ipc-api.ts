import type { ServerConfig, ChassisStatus, SensorReading, SelEntry, FruInfo, ServerStatus } from './server.js'

export type PowerAction = 'on' | 'off' | 'cycle' | 'reset' | 'soft'

export interface IpcApi {
  getServers(): Promise<ServerConfig[]>
  getServer(id: string): Promise<ServerConfig | null>
  addServer(config: Omit<ServerConfig, 'id'>, password: string): Promise<ServerConfig>
  updateServer(id: string, config: Partial<ServerConfig>, password?: string): Promise<void>
  deleteServer(id: string): Promise<void>

  getChassisStatus(serverId: string): Promise<ChassisStatus>
  getSensorReadings(serverId: string): Promise<SensorReading[]>
  getSelEntries(serverId: string): Promise<SelEntry[]>
  getFruInfo(serverId: string): Promise<FruInfo>

  powerAction(serverId: string, action: PowerAction): Promise<void>

  startKvmSession(serverId: string): Promise<{ localWsUrl: string; sessionId: string }>
  stopKvmSession(sessionId: string): Promise<void>

  onServerStatusUpdate(callback: (status: ServerStatus) => void): () => void
  startPolling(): void
  stopPolling(): void
}

declare global {
  interface Window {
    api: IpcApi
  }
}
