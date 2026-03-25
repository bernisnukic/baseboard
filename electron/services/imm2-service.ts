import https from 'https'
import http from 'http'
import tls from 'tls'
import net from 'net'
import { SocksClient } from 'socks'
import type { ServerConfig, ChassisStatus, SensorReading, SelEntry, FruInfo } from '../types/server.js'
import type { PowerAction } from '../types/ipc-api.js'

interface Imm2Session {
  cookie: string
  tokens: Record<string, string>
  host: string
  port: number
  createdAt: number
}

const SESSION_TTL = 10 * 60 * 1000 // 10 minutes
const sessionCache = new Map<string, Imm2Session>()
const loginLocks = new Map<string, Promise<Imm2Session>>()

function sessionKey(server: ServerConfig): string {
  return `${server.host}:${server.port}`
}

// Get or create a session, with locking to prevent concurrent logins
async function getSession(server: ServerConfig, password: string, proxyPassword?: string | null): Promise<Imm2Session> {
  const key = sessionKey(server)

  // Return cached if fresh
  const cached = sessionCache.get(key)
  if (cached && (Date.now() - cached.createdAt) < SESSION_TTL) {
    return cached
  }

  // If another call is already logging in, wait for it
  const pending = loginLocks.get(key)
  if (pending) return pending

  const loginPromise = imm2Login(server, password, proxyPassword).then(session => {
    sessionCache.set(key, session)
    loginLocks.delete(key)
    return session
  }).catch(err => {
    loginLocks.delete(key)
    throw err
  })

  loginLocks.set(key, loginPromise)
  return loginPromise
}

const agent = new https.Agent({ rejectUnauthorized: false })

function makeRequest(
  options: {
    host: string
    port: number
    path: string
    method?: string
    headers?: Record<string, string>
    body?: string
    proxy?: ServerConfig['proxy']
    proxyPassword?: string | null
    username?: string
    password?: string
  }
): Promise<{ status: number; headers: Record<string, string[]>; body: string }> {
  return new Promise(async (resolve, reject) => {
    const timeout = 15000

    const reqOptions: https.RequestOptions = {
      hostname: options.host,
      port: options.port,
      path: options.path,
      method: options.method || 'GET',
      headers: { ...options.headers },
      rejectUnauthorized: false,
      timeout
    } as any

    if (options.username && options.password) {
      const auth = Buffer.from(`${options.username}:${options.password}`).toString('base64')
      reqOptions.headers = { ...reqOptions.headers, Authorization: `Basic ${auth}` }
    }

    if (options.proxy) {
      // SOCKS path: manual TLS + raw HTTP (https.request doesn't work with SOCKS sockets)
      try {
        const socksOptions: any = {
          proxy: {
            host: options.proxy.host,
            port: options.proxy.port,
            type: 5 as const,
            ...(options.proxy.username ? { userId: options.proxy.username, password: options.proxyPassword ?? undefined } : {})
          },
          command: 'connect' as const,
          destination: { host: options.host, port: options.port },
          timeout: 10000
        }
        const result = await SocksClient.createConnection(socksOptions)

        const tlsSocket = tls.connect({
          socket: result.socket,
          rejectUnauthorized: false,
          minVersion: 'TLSv1' as any,
        })

        tlsSocket.on('secureConnect', () => {
          const method = options.method || 'GET'
          const headers: Record<string, string> = {
            Host: `${options.host}:${options.port}`,
            Connection: 'close',
            ...(reqOptions.headers as Record<string, string>)
          }
          if (options.body) {
            headers['Content-Length'] = String(Buffer.byteLength(options.body))
          }

          let rawReq = `${method} ${options.path} HTTP/1.1\r\n`
          for (const [k, v] of Object.entries(headers)) {
            if (v) rawReq += `${k}: ${v}\r\n`
          }
          rawReq += '\r\n'
          if (options.body) rawReq += options.body

          tlsSocket.write(rawReq)

          let rawResp = ''
          tlsSocket.on('data', (chunk: Buffer) => { rawResp += chunk.toString() })
          tlsSocket.on('end', () => {
            const headerEnd = rawResp.indexOf('\r\n\r\n')
            const headerBlock = rawResp.substring(0, headerEnd)
            const body = rawResp.substring(headerEnd + 4)
            const statusLine = headerBlock.split('\r\n')[0]
            const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/)
            const status = statusMatch ? parseInt(statusMatch[1]) : 0

            const respHeaders: Record<string, string[]> = {}
            for (const line of headerBlock.split('\r\n').slice(1)) {
              const idx = line.indexOf(':')
              if (idx > 0) {
                const key = line.substring(0, idx).trim().toLowerCase()
                const val = line.substring(idx + 1).trim()
                if (!respHeaders[key]) respHeaders[key] = []
                respHeaders[key].push(val)
              }
            }

            resolve({ status, headers: respHeaders, body })
          })
        })

        tlsSocket.on('error', (err) => reject(new Error(`TLS error: ${err.message}`)))
        setTimeout(() => { tlsSocket.destroy(); reject(new Error('Request timed out')) }, timeout)

      } catch (err: any) {
        reject(new Error(`SOCKS proxy connection failed: ${err.message}`))
      }
    } else {
      // Direct path: standard https.request
      reqOptions.agent = agent
      const req = https.request(reqOptions, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as any,
            body: data
          })
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
      if (options.body) req.write(options.body)
      req.end()
    }
  })
}

// IMM2 custom URL encoding (@ prefix instead of %)
function imm2Escape(str: string): string {
  const special = new Set(['@', '(', ')', ',', ':', '?', '=', '&', '#', '+', '%'])
  let result = ''
  for (const ch of str) {
    if (special.has(ch)) {
      result += '@0' + ch.charCodeAt(0).toString(16)
    } else {
      result += ch
    }
  }
  return result
}

async function imm2Login(server: ServerConfig, password: string, proxyPassword?: string | null): Promise<Imm2Session> {
  const escapedUser = imm2Escape(server.username)
  const escapedPass = imm2Escape(password)
  const body = `user=${escapedUser}&password=${escapedPass}&SessionTimeout=1200`

  const resp = await makeRequest({
    host: server.host,
    port: server.port,
    path: '/data/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `https://${server.host}:${server.port}/designs/imm/index.php`
    },
    body,
    proxy: server.proxy,
    proxyPassword,
    username: server.username,
    password
  })

  if (resp.status !== 200) {
    throw new Error(`IMM2 login failed: HTTP ${resp.status}`)
  }

  const data = JSON.parse(resp.body)
  if (data.authResult !== '0') {
    const reasons: Record<string, string> = {
      '1': 'Invalid credentials',
      '2': 'Account locked',
      '3': 'Account disabled',
      '5': 'Too many sessions or temporary lockout'
    }
    throw new Error(`IMM2 login failed: ${reasons[data.authResult] || `authResult=${data.authResult}`}`)
  }

  // Extract session cookie from Set-Cookie header
  const setCookie = resp.headers['set-cookie']
  let cookie = ''
  if (setCookie) {
    const cookieArr = Array.isArray(setCookie) ? setCookie : [setCookie]
    for (const c of cookieArr) {
      const match = c.match(/_appwebSessionId_=([^;]+)/)
      if (match) cookie = `_appwebSessionId_=${match[1]}`
    }
  }

  const tokens: Record<string, string> = {}
  for (let i = 1; i <= 3; i++) {
    const name = data[`token${i}_name`]
    const value = data[`token${i}_value`]
    if (name && value) tokens[name] = value
  }

  return { cookie, tokens, host: server.host, port: server.port, createdAt: Date.now() }
}

async function imm2Fetch(
  session: Imm2Session,
  path: string,
  server: ServerConfig,
  password: string,
  proxyPassword?: string | null
): Promise<string> {
  const headers: Record<string, string> = {
    Referer: `https://${session.host}:${session.port}/designs/imm/index-console.php`
  }
  if (session.cookie) headers.Cookie = session.cookie
  for (const [k, v] of Object.entries(session.tokens)) {
    headers[k] = v
  }

  const resp = await makeRequest({
    host: session.host,
    port: session.port,
    path,
    headers,
    proxy: server.proxy,
    proxyPassword,
    username: server.username,
    password
  })

  return resp.body
}

// Helper to fetch IMM2 data provider endpoints (requires CSRF token2 header)
async function imm2DataEndpoint(server: ServerConfig, password: string, endpoint: string, proxyPassword?: string | null): Promise<any> {
  const session = await getSession(server, password, proxyPassword)
  const headers: Record<string, string> = {
    Referer: `https://${server.host}:${server.port}/designs/imm/home.php`
  }
  if (session.cookie) headers.Cookie = session.cookie
  // CSRF token2 is what the data endpoints validate
  for (const [k, v] of Object.entries(session.tokens)) {
    headers[k] = v
  }

  const resp = await makeRequest({
    host: server.host,
    port: server.port,
    path: `/designs/imm/dataproviders/${endpoint}`,
    headers,
    proxy: server.proxy,
    proxyPassword,
    username: server.username,
    password
  })

  if (resp.status === 401) {
    // Session expired, clear cache and retry once
    sessionCache.delete(sessionKey(server))
    const newSession = await getSession(server, password, proxyPassword)
    const retryHeaders: Record<string, string> = {
      Referer: `https://${server.host}:${server.port}/designs/imm/home.php`
    }
    if (newSession.cookie) retryHeaders.Cookie = newSession.cookie
    for (const [k, v] of Object.entries(newSession.tokens)) {
      retryHeaders[k] = v
    }
    const retry = await makeRequest({
      host: server.host,
      port: server.port,
      path: `/designs/imm/dataproviders/${endpoint}`,
      headers: retryHeaders,
      proxy: server.proxy,
      proxyPassword,
      username: server.username,
      password
    })
    if (retry.status !== 200) throw new Error(`IMM2 ${endpoint}: HTTP ${retry.status}`)
    return JSON.parse(retry.body)
  }

  if (resp.status !== 200) throw new Error(`IMM2 ${endpoint}: HTTP ${resp.status}`)
  return JSON.parse(resp.body)
}

export async function getChassisStatus(server: ServerConfig, password: string, proxyPassword?: string | null): Promise<ChassisStatus> {
  try {
    const data = await imm2DataEndpoint(server, password, 'imm_status.php', proxyPassword)
    const item = data.items?.[0] || {}
    return {
      powerOn: item.power_state === 1,
      powerOverload: false,
      powerFault: false,
      lastPowerEvent: '',
      intrusion: ''
    }
  } catch (err: any) {
    throw new Error(`IMM2 connection failed: ${err.message}`)
  }
}

export async function getSensorReadings(server: ServerConfig, password: string, proxyPassword?: string | null): Promise<SensorReading[]> {
  const sensors: SensorReading[] = []

  try {
    const data = await imm2DataEndpoint(server, password, 'imm_info.php', proxyPassword)
    const item = data.items?.[0] || {}

    if (item.ambient_temp) {
      const temps = item.ambient_temp.trim().split('/')
      sensors.push({
        name: 'Ambient Temp',
        value: (temps[1] || temps[0]).trim(),
        unit: 'C',
        status: 'ok'
      })
    }
    if (item.power_on_hours !== undefined) {
      sensors.push({ name: 'Power On Hours', value: String(item.power_on_hours), unit: 'hrs', status: 'na' })
    }
    if (item.restart_count !== undefined) {
      sensors.push({ name: 'Restart Count', value: String(item.restart_count), unit: '', status: 'na' })
    }
  } catch {}

  // Try to get more sensor data from imm_sensors if available
  try {
    const data = await imm2DataEndpoint(server, password, 'imm_sensors.php', proxyPassword)
    if (data.items) {
      for (const s of data.items) {
        sensors.push({
          name: s.name || s.sensor_name || 'Sensor',
          value: String(s.value ?? s.reading ?? '-'),
          unit: s.unit || '',
          status: s.status === 'ok' || s.status === 0 ? 'ok' :
                  s.status === 'warning' ? 'warning' :
                  s.status === 'critical' ? 'critical' : 'na'
        })
      }
    }
  } catch {
    // imm_sensors.php may not exist on all firmware versions
  }

  if (sensors.length === 0) {
    sensors.push({ name: 'IMM2 Web UI', value: 'Reachable', unit: '', status: 'ok' })
  }

  return sensors
}

export async function getSelEntries(server: ServerConfig, password: string, proxyPassword?: string | null): Promise<SelEntry[]> {
  try {
    const data = await imm2DataEndpoint(server, password, 'imm_eventlog.php', proxyPassword)
    if (data.items) {
      return data.items.map((e: any) => ({
        id: String(e.index ?? e.id ?? ''),
        timestamp: e.datetime || e.timestamp || '',
        sensor: e.source || e.sensor || '',
        event: e.message || e.event || '',
        severity: (e.severity === 2 || e.severity === 'critical') ? 'critical' as const :
                  (e.severity === 1 || e.severity === 'warning') ? 'warning' as const : 'info' as const
      }))
    }
  } catch {}

  return [{ id: '-', timestamp: '-', sensor: '-', event: 'Event log endpoint not available', severity: 'info' as const }]
}

export async function getFruInfo(server: ServerConfig, password: string, proxyPassword?: string | null): Promise<FruInfo> {
  const info: FruInfo = {
    manufacturer: 'Lenovo/IBM',
    productName: '',
    serialNumber: '',
    partNumber: '',
    firmwareVersion: '',
    bmcVersion: ''
  }

  try {
    const data = await imm2DataEndpoint(server, password, 'imm_info.php', proxyPassword)
    const item = data.items?.[0] || {}
    info.productName = item.machine_name || ''
    info.serialNumber = item.serial_number || ''
    info.partNumber = item.machine_typemodel || ''
    info.uuid = item.UUID || ''
    if (item.power_on_hours !== undefined) info.powerOnHours = item.power_on_hours
    if (item.restart_count !== undefined) info.restartCount = item.restart_count
    if (item.ambient_temp) {
      const temps = item.ambient_temp.trim().split('/')
      info.ambientTemp = (temps[1] || temps[0]).trim() + ' C'
    }
  } catch {}

  try {
    const status = await imm2DataEndpoint(server, password, 'imm_status.php', proxyPassword)
    const sItem = status.items?.[0] || {}
    info.systemName = sItem.system_name || ''
    info.hostname = sItem.HostName || ''
  } catch {}

  try {
    const data = await imm2DataEndpoint(server, password, 'imm_firmware.php', proxyPassword)
    if (data.items?.length) {
      const primary = data.items[0]
      info.bmcVersion = `${primary['firmware.version'] || ''} (${primary['firmware.build'] || ''})`
      info.firmwareVersion = primary['firmware.release_date'] || ''
    }
  } catch {}

  return info
}

export async function powerControl(server: ServerConfig, password: string, action: PowerAction, proxyPassword?: string | null): Promise<void> {
  const session = await getSession(server, password, proxyPassword)
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Referer: `https://${server.host}:${server.port}/designs/imm/home.php`
  }
  if (session.cookie) headers.Cookie = session.cookie
  for (const [k, v] of Object.entries(session.tokens)) {
    headers[k] = v
  }

  // IMM2 power control via web API
  const actionMap: Record<string, string> = {
    on: 'power_on',
    off: 'power_off',
    cycle: 'power_cycle',
    reset: 'power_reset',
    soft: 'power_softoff'
  }

  const resp = await makeRequest({
    host: server.host,
    port: server.port,
    path: '/data',
    method: 'POST',
    headers,
    body: actionMap[action] || action,
    proxy: server.proxy,
    proxyPassword,
    username: server.username,
    password
  })

  if (resp.status >= 400) {
    throw new Error(`Power action failed: HTTP ${resp.status}`)
  }
}

// Login and return raw session cookie for webview injection
export async function loginForConsole(server: ServerConfig, password: string, proxyPassword?: string | null): Promise<{ cookie: string }> {
  const session = await getSession(server, password, proxyPassword)
  return { cookie: session.cookie }
}
