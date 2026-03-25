import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ServerConfig, ChassisStatus, SensorReading, SelEntry, FruInfo } from '../types/server.js'
import type { PowerAction } from '../types/ipc-api.js'

const execFileAsync = promisify(execFile)

async function ipmitool(server: ServerConfig, password: string, args: string[]): Promise<string> {
  const baseArgs = [
    '-I', 'lanplus',
    '-H', server.host,
    '-p', String(server.port || 623),
    '-U', server.username,
    '-P', password,
    ...args
  ]

  try {
    const { stdout } = await execFileAsync('ipmitool', baseArgs, { timeout: 15000 })
    return stdout
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error('ipmitool not found. Install it: apt install ipmitool')
    }
    throw new Error(err.stderr || err.message)
  }
}

export async function getChassisStatus(server: ServerConfig, password: string): Promise<ChassisStatus> {
  const out = await ipmitool(server, password, ['chassis', 'status'])
  const get = (key: string) => {
    const m = out.match(new RegExp(`${key}\\s*:\\s*(.+)`, 'i'))
    return m?.[1]?.trim() ?? ''
  }
  return {
    powerOn: get('System Power').toLowerCase() === 'on',
    powerOverload: get('Power Overload') === 'true',
    powerFault: get('Power Fault') === 'true',
    lastPowerEvent: get('Last Power Event'),
    intrusion: get('Chassis Intrusion')
  }
}

export async function getSensorReadings(server: ServerConfig, password: string): Promise<SensorReading[]> {
  const out = await ipmitool(server, password, ['sdr', 'list'])
  return out.split('\n').filter(l => l.trim()).map(line => {
    const parts = line.split('|').map(p => p.trim())
    const name = parts[0] ?? ''
    const raw = parts[1] ?? ''
    const statusStr = (parts[2] ?? '').toLowerCase()

    let value = raw
    let unit = ''
    const numMatch = raw.match(/^([\d.]+)\s*(.*)$/)
    if (numMatch) {
      value = numMatch[1]
      unit = numMatch[2]
    }

    let status: SensorReading['status'] = 'ok'
    if (statusStr.includes('cr')) status = 'critical'
    else if (statusStr.includes('nc') || statusStr.includes('nr')) status = 'warning'
    else if (statusStr.includes('na') || statusStr.includes('ns')) status = 'na'

    return { name, value, unit, status }
  })
}

export async function getSelEntries(server: ServerConfig, password: string): Promise<SelEntry[]> {
  const out = await ipmitool(server, password, ['sel', 'elist'])
  return out.split('\n').filter(l => l.trim()).map(line => {
    const parts = line.split('|').map(p => p.trim())
    const severity: SelEntry['severity'] =
      line.toLowerCase().includes('critical') ? 'critical' :
      line.toLowerCase().includes('warning') ? 'warning' : 'info'
    return {
      id: parts[0] ?? '',
      timestamp: parts[1] ?? '',
      sensor: parts[2] ?? '',
      event: parts.slice(3).join(' | '),
      severity
    }
  })
}

export async function getFruInfo(server: ServerConfig, password: string): Promise<FruInfo> {
  const out = await ipmitool(server, password, ['fru', 'print'])
  const get = (key: string) => {
    const m = out.match(new RegExp(`${key}\\s*:\\s*(.+)`, 'i'))
    return m?.[1]?.trim() ?? ''
  }

  let bmcVersion = ''
  try {
    const bmcOut = await ipmitool(server, password, ['mc', 'info'])
    const fwMatch = bmcOut.match(/Firmware Revision\s*:\s*(.+)/i)
    if (fwMatch) bmcVersion = fwMatch[1].trim()
  } catch { /* non-critical */ }

  return {
    manufacturer: get('Product Manufacturer') || get('Board Mfg'),
    productName: get('Product Name') || get('Board Product'),
    serialNumber: get('Product Serial') || get('Board Serial'),
    partNumber: get('Product Part Number'),
    firmwareVersion: get('Product Version'),
    bmcVersion
  }
}

export async function powerControl(server: ServerConfig, password: string, action: PowerAction): Promise<void> {
  await ipmitool(server, password, ['chassis', 'power', action])
}
