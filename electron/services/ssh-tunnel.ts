import { execFile, ChildProcess } from 'child_process'
import net from 'net'

interface SshTunnel {
  process: ChildProcess
  localPort: number
  targetHost: string
  targetPort: number
}

const tunnels = new Map<string, SshTunnel>()

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
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

export async function startSshSocksProxy(
  sshHost: string,
  sshPort: number,
  sshUser: string
): Promise<{ localPort: number; id: string }> {
  const id = `ssh-${sshHost}-${sshPort}-${sshUser}`

  // Reuse existing tunnel if alive
  const existing = tunnels.get(id)
  if (existing && !existing.process.killed) {
    // Check if port is still listening
    const alive = await checkPort(existing.localPort)
    if (alive) return { localPort: existing.localPort, id }
    // Dead tunnel, clean up
    existing.process.kill()
    tunnels.delete(id)
  }

  const localPort = await findFreePort()

  const args = [
    '-D', String(localPort),
    '-p', String(sshPort),
    '-l', sshUser,
    sshHost,
    '-N',              // no remote command
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=10',
  ]

  return new Promise((resolve, reject) => {
    const proc = execFile('ssh', args)
    let resolved = false

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString()
      console.log(`[ssh-tunnel:${id}] ${msg.trim()}`)
    })

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true
        reject(new Error(`SSH tunnel failed: ${err.message}`))
      }
    })

    proc.on('exit', (code) => {
      tunnels.delete(id)
      if (!resolved) {
        resolved = true
        reject(new Error(`SSH tunnel exited with code ${code}`))
      }
    })

    // Wait for the SOCKS port to become available
    const checkInterval = setInterval(async () => {
      if (resolved) { clearInterval(checkInterval); return }
      const alive = await checkPort(localPort)
      if (alive) {
        clearInterval(checkInterval)
        resolved = true
        tunnels.set(id, { process: proc, localPort, targetHost: sshHost, targetPort: sshPort })
        console.log(`[ssh-tunnel:${id}] SOCKS proxy ready on 127.0.0.1:${localPort}`)
        resolve({ localPort, id })
      }
    }, 200)

    // Timeout after 15 seconds
    setTimeout(() => {
      clearInterval(checkInterval)
      if (!resolved) {
        resolved = true
        proc.kill()
        reject(new Error('SSH tunnel timed out'))
      }
    }, 15000)
  })
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port, timeout: 1000 }, () => {
      sock.destroy()
      resolve(true)
    })
    sock.on('error', () => resolve(false))
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
  })
}

export function stopTunnel(id: string): void {
  const tunnel = tunnels.get(id)
  if (tunnel) {
    tunnel.process.kill()
    tunnels.delete(id)
    console.log(`[ssh-tunnel:${id}] Stopped`)
  }
}

export function stopAllTunnels(): void {
  for (const id of tunnels.keys()) {
    stopTunnel(id)
  }
}

export function getTunnelPort(id: string): number | null {
  const tunnel = tunnels.get(id)
  return tunnel ? tunnel.localPort : null
}

// Get or create a SOCKS proxy for a server's SSH config
// Returns the local SOCKS port
export async function ensureSocksProxy(
  sshHost: string,
  sshPort: number,
  sshUser: string
): Promise<number> {
  const { localPort } = await startSshSocksProxy(sshHost, sshPort, sshUser)
  return localPort
}
