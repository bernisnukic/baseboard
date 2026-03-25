import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Server CRUD
  getServers: () => ipcRenderer.invoke('server:list'),
  getServer: (id: string) => ipcRenderer.invoke('server:get', id),
  addServer: (config: any, password: string) => ipcRenderer.invoke('server:add', config, password),
  updateServer: (id: string, config: any, password?: string) => ipcRenderer.invoke('server:update', id, config, password),
  deleteServer: (id: string) => ipcRenderer.invoke('server:delete', id),
  duplicateServer: (id: string) => ipcRenderer.invoke('server:duplicate', id),

  // Project CRUD
  getProjects: () => ipcRenderer.invoke('project:list'),
  getProject: (id: string) => ipcRenderer.invoke('project:get', id),
  addProject: (config: any) => ipcRenderer.invoke('project:add', config),
  updateProject: (id: string, config: any) => ipcRenderer.invoke('project:update', id, config),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),

  // Jump server CRUD
  getJumpServers: () => ipcRenderer.invoke('jump:list'),
  getJumpServer: (id: string) => ipcRenderer.invoke('jump:get', id),
  addJumpServer: (config: any) => ipcRenderer.invoke('jump:add', config),
  updateJumpServer: (id: string, config: any) => ipcRenderer.invoke('jump:update', id, config),
  deleteJumpServer: (id: string) => ipcRenderer.invoke('jump:delete', id),

  // Data cache
  getAllDataCache: () => ipcRenderer.invoke('cache:get-all'),

  // IPMI data
  getChassisStatus: (serverId: string) => ipcRenderer.invoke('ipmi:chassis-status', serverId),
  getSensorReadings: (serverId: string) => ipcRenderer.invoke('ipmi:sensors', serverId),
  getSelEntries: (serverId: string) => ipcRenderer.invoke('ipmi:sel', serverId),
  getFruInfo: (serverId: string) => ipcRenderer.invoke('ipmi:fru', serverId),

  // Power control
  powerAction: (serverId: string, action: string) => ipcRenderer.invoke('ipmi:power', serverId, action),

  // KVM console
  startKvmSession: (serverId: string) => ipcRenderer.invoke('kvm:start', serverId),
  stopKvmSession: (sessionId: string) => ipcRenderer.invoke('kvm:stop', sessionId),
  setupWebviewProxy: (proxyPort: number, partition: string, cookie?: string, url?: string) => ipcRenderer.invoke('webview:setup-proxy', proxyPort, partition, cookie, url),

  // Status polling
  onServerStatusUpdate: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status)
    ipcRenderer.on('server:status-update', handler)
    return () => ipcRenderer.removeListener('server:status-update', handler)
  },
  startPolling: () => ipcRenderer.send('polling:start'),
  stopPolling: () => ipcRenderer.send('polling:stop')
})
