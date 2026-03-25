export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  kvmPort: number
  type: 'ipmi' | 'imm2' | 'idrac' | 'supermicro'
  username: string
  proxy?: SocksProxyConfig
  projectId?: string
}

export interface SocksProxyConfig {
  host: string
  port: number
  username?: string
  // SSH jump mode: app auto-creates SOCKS tunnel via SSH
  mode?: 'socks' | 'ssh'
  sshPort?: number
}

export interface ChassisStatus {
  powerOn: boolean
  powerOverload: boolean
  powerFault: boolean
  lastPowerEvent: string
  intrusion: string
}

export interface SensorReading {
  name: string
  value: string
  unit: string
  status: 'ok' | 'warning' | 'critical' | 'na'
}

export interface SelEntry {
  id: string
  timestamp: string
  sensor: string
  event: string
  severity: 'info' | 'warning' | 'critical'
}

export interface FruInfo {
  manufacturer: string
  productName: string
  serialNumber: string
  partNumber: string
  firmwareVersion: string
  bmcVersion: string
  hostname?: string
  systemName?: string
  uuid?: string
  powerOnHours?: number
  restartCount?: number
  ambientTemp?: string
}

export interface ServerStatus {
  serverId: string
  powerOn: boolean | null
  health: 'ok' | 'warning' | 'critical' | 'unknown'
  error?: string
  lastChecked: number
}
