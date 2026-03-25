import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { ServerConfig } from '../types/server.js'

// Project management
export interface Project {
  id: string
  name: string
}

const projectsPath = () => join(dataDir(), 'projects.json')

export function listProjects(): Project[] {
  return readJson<Project[]>(projectsPath(), [])
}

export function getProject(id: string): Project | null {
  return listProjects().find(p => p.id === id) ?? null
}

export function addProject(config: Omit<Project, 'id'>): Project {
  const projects = listProjects()
  const project: Project = { ...config, id: randomUUID() }
  projects.push(project)
  writeJson(projectsPath(), projects)
  return project
}

export function updateProject(id: string, updates: Partial<Project>): void {
  const projects = listProjects()
  const idx = projects.findIndex(p => p.id === id)
  if (idx === -1) throw new Error(`Project ${id} not found`)
  projects[idx] = { ...projects[idx], ...updates, id }
  writeJson(projectsPath(), projects)
}

export function deleteProject(id: string): void {
  const projects = listProjects().filter(p => p.id !== id)
  writeJson(projectsPath(), projects)
  // Unassign servers from this project
  const servers = listServers()
  let changed = false
  for (const s of servers) {
    if ((s as any).projectId === id) {
      (s as any).projectId = undefined
      changed = true
    }
  }
  if (changed) writeJson(serversPath(), servers)
}

const dataDir = () => {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const serversPath = () => join(dataDir(), 'servers.json')
const credentialsPath = () => join(dataDir(), 'credentials.json')

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return fallback
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
}

export function listServers(): ServerConfig[] {
  return readJson<ServerConfig[]>(serversPath(), [])
}

export function getServer(id: string): ServerConfig | null {
  return listServers().find(s => s.id === id) ?? null
}

export function addServer(config: Omit<ServerConfig, 'id'>, password: string): ServerConfig {
  const servers = listServers()
  const server: ServerConfig = { ...config, id: randomUUID() }
  servers.push(server)
  writeJson(serversPath(), servers)
  storePassword(server.id, password)
  if (config.proxy?.username) {
    // proxy password stored with key "proxy:<serverId>"
  }
  return server
}

export function updateServer(id: string, updates: Partial<ServerConfig>, password?: string): void {
  const servers = listServers()
  const idx = servers.findIndex(s => s.id === id)
  if (idx === -1) throw new Error(`Server ${id} not found`)
  servers[idx] = { ...servers[idx], ...updates, id }
  writeJson(serversPath(), servers)
  if (password !== undefined) storePassword(id, password)
}

export function duplicateServer(id: string): ServerConfig {
  const original = getServer(id)
  if (!original) throw new Error(`Server ${id} not found`)
  const password = getPassword(id)
  const newServer: ServerConfig = { ...original, id: randomUUID(), name: original.name + ' (copy)' }
  const servers = listServers()
  servers.push(newServer)
  writeJson(serversPath(), servers)
  storePassword(newServer.id, password)
  return newServer
}

export function deleteServer(id: string): void {
  const servers = listServers().filter(s => s.id !== id)
  writeJson(serversPath(), servers)
  const creds = readJson<Record<string, string>>(credentialsPath(), {})
  delete creds[id]
  delete creds[`proxy:${id}`]
  writeJson(credentialsPath(), creds)
}

export function getPassword(id: string): string {
  const creds = readJson<Record<string, string>>(credentialsPath(), {})
  const encrypted = creds[id]
  if (!encrypted) throw new Error(`No credentials for server ${id}`)
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }
  // Fallback: stored as base64-encoded plaintext (not ideal but functional)
  return Buffer.from(encrypted, 'base64').toString('utf-8')
}

export function getProxyPassword(id: string): string | null {
  try {
    return getPassword(`proxy:${id}`)
  } catch {
    return null
  }
}

function storePassword(key: string, password: string): void {
  const creds = readJson<Record<string, string>>(credentialsPath(), {})
  if (safeStorage.isEncryptionAvailable()) {
    creds[key] = safeStorage.encryptString(password).toString('base64')
  } else {
    creds[key] = Buffer.from(password, 'utf-8').toString('base64')
  }
  writeJson(credentialsPath(), creds)
}

export function storeProxyPassword(serverId: string, password: string): void {
  storePassword(`proxy:${serverId}`, password)
}

// Server data cache — last known info/sensors/status
export interface ServerDataCache {
  serverId: string
  updatedAt: number
  chassis?: any
  fru?: any
  sensors?: any[]
}

const dataCachePath = () => join(dataDir(), 'server-data-cache.json')

export function getServerDataCache(serverId: string): ServerDataCache | null {
  const cache = readJson<Record<string, ServerDataCache>>(dataCachePath(), {})
  return cache[serverId] ?? null
}

export function setServerDataCache(serverId: string, data: Partial<ServerDataCache>): void {
  const cache = readJson<Record<string, ServerDataCache>>(dataCachePath(), {})
  cache[serverId] = {
    ...cache[serverId],
    ...data,
    serverId,
    updatedAt: Date.now()
  }
  writeJson(dataCachePath(), cache)
}

export function getAllServerDataCache(): Record<string, ServerDataCache> {
  return readJson<Record<string, ServerDataCache>>(dataCachePath(), {})
}

export function deleteServerDataCache(serverId: string): void {
  const cache = readJson<Record<string, ServerDataCache>>(dataCachePath(), {})
  delete cache[serverId]
  writeJson(dataCachePath(), cache)
}

// Jump server management
export interface JumpServer {
  id: string
  name: string
  host: string
  sshPort: number
  username: string
}

const jumpServersPath = () => join(dataDir(), 'jump-servers.json')

export function listJumpServers(): JumpServer[] {
  return readJson<JumpServer[]>(jumpServersPath(), [])
}

export function getJumpServer(id: string): JumpServer | null {
  return listJumpServers().find(j => j.id === id) ?? null
}

export function addJumpServer(config: Omit<JumpServer, 'id'>): JumpServer {
  const jumps = listJumpServers()
  const jump: JumpServer = { ...config, id: randomUUID() }
  jumps.push(jump)
  writeJson(jumpServersPath(), jumps)
  return jump
}

export function updateJumpServer(id: string, updates: Partial<JumpServer>): void {
  const jumps = listJumpServers()
  const idx = jumps.findIndex(j => j.id === id)
  if (idx === -1) throw new Error(`Jump server ${id} not found`)
  jumps[idx] = { ...jumps[idx], ...updates, id }
  writeJson(jumpServersPath(), jumps)
}

export function deleteJumpServer(id: string): void {
  const jumps = listJumpServers().filter(j => j.id !== id)
  writeJson(jumpServersPath(), jumps)
}
