import { el, clear, navigate } from '../lib/dom.js'
import { confirmDialog } from '../lib/dialog.js'

interface SearchMatch {
  field: string
  value: string
}

function fuzzyMatchField(query: string, value: string): boolean {
  const q = query.toLowerCase()
  const v = value.toLowerCase()
  if (v.includes(q)) return true
  // Only use character fuzzy for longer queries (4+ chars) to avoid false positives
  if (q.length < 4) return false
  // Character-by-character fuzzy — but characters must not be too spread out
  let qi = 0
  let firstMatch = -1
  let lastMatch = -1
  for (let vi = 0; vi < v.length && qi < q.length; vi++) {
    if (v[vi] === q[qi]) {
      if (firstMatch === -1) firstMatch = vi
      lastMatch = vi
      qi++
    }
  }
  if (qi !== q.length) return false
  // Reject if matched chars are spread across more than 2x the query length
  return (lastMatch - firstMatch) < q.length * 2
}

function findMatch(query: string, fields: Record<string, string>): SearchMatch | null {
  const q = query.toLowerCase()
  // Exact substring match first (higher priority)
  for (const [field, value] of Object.entries(fields)) {
    if (value && value.toLowerCase().includes(q)) {
      return { field, value }
    }
  }
  // Fuzzy match fallback
  for (const [field, value] of Object.entries(fields)) {
    if (value && fuzzyMatchField(query, value)) {
      return { field, value }
    }
  }
  return null
}

export function renderDashboard(container: HTMLElement): (() => void) | void {
  clear(container)

  const searchInput = el('input', { type: 'text', placeholder: 'Search servers...' }) as HTMLInputElement
  searchInput.className = 'search-input'

  const projectBar = el('div', { className: 'project-bar' })
  const serverList = el('div')

  const header = el('div', { className: 'detail-header', style: 'margin-bottom:12px' },
    el('h2', { className: 'detail-title' }, 'Servers'),
  )

  container.appendChild(header)
  container.appendChild(searchInput)
  container.appendChild(projectBar)
  container.appendChild(serverList)

  const statusMap = new Map<string, { powerOn: boolean | null; health: string }>()
  let allServers: any[] = []
  let allProjects: any[] = []
  let dataCache: Record<string, any> = {}
  let cleanup: (() => void) | null = null

  async function load() {
    [allServers, allProjects, dataCache] = await Promise.all([
      window.api.getServers(),
      (window as any).api.getProjects(),
      (window as any).api.getAllDataCache()
    ])
    render()
  }

  function render() {
    const query = searchInput.value.trim()
    clear(serverList)
    renderProjectBar()

    const matchMap = new Map<string, SearchMatch>()
    let filtered = allServers
    if (query) {
      filtered = allServers.filter(s => {
        const project = allProjects.find((p: any) => p.id === s.projectId)
        const cached = dataCache[s.id]
        const fru = cached?.fru || {}
        const fields: Record<string, string> = {
          'Name': s.name || '',
          'Host': `${s.host}:${s.port}`,
          'Type': s.type || '',
          'Project': project?.name || '',
          'Product': fru.productName || '',
          'Serial': fru.serialNumber || '',
          'Hostname': fru.hostname || '',
          'System': fru.systemName || '',
          'Part': fru.partNumber || '',
          'Firmware': fru.bmcVersion || '',
        }
        const match = findMatch(query, fields)
        if (match) {
          matchMap.set(s.id, match)
          return true
        }
        return false
      })
    }

    if (filtered.length === 0 && allServers.length === 0) {
      const empty = el('div', { className: 'empty-state' },
        el('h3', {}, 'No servers configured'),
        el('p', {}, 'Add your first IPMI/IMM/iDRAC server to get started.'),
        el('button', { className: 'btn btn-primary' }, '+ Add Server')
      )
      empty.querySelector('button')!.onclick = () => navigate('#/server/new')
      serverList.appendChild(empty)
      return
    }

    if (filtered.length === 0 && query) {
      serverList.appendChild(el('div', { className: 'empty-state' },
        el('p', {}, `No servers matching "${query}"`)
      ))
      return
    }

    // Group by project
    const unassigned = filtered.filter(s => !s.projectId)
    const projectGroups = new Map<string, any[]>()
    for (const s of filtered) {
      if (s.projectId) {
        if (!projectGroups.has(s.projectId)) projectGroups.set(s.projectId, [])
        projectGroups.get(s.projectId)!.push(s)
      }
    }

    for (const project of allProjects) {
      const servers = projectGroups.get(project.id)
      if (!servers || servers.length === 0) {
        if (!query) serverList.appendChild(createProjectGroup(project.name, servers || [], matchMap))
        continue
      }
      serverList.appendChild(createProjectGroup(project.name, servers, matchMap))
    }

    if (unassigned.length > 0) {
      const label = allProjects.length > 0 ? 'Unassigned' : ''
      serverList.appendChild(createProjectGroup(label, unassigned, matchMap))
    }
  }

  function createProjectGroup(name: string, servers: any[], matches?: Map<string, SearchMatch>): HTMLElement {
    const group = el('div', { className: 'project-group' })

    if (name) {
      group.appendChild(el('div', { className: 'project-group-header' },
        el('span', { className: 'project-group-name' }, name),
        el('span', { className: 'project-group-count' }, `${servers.length} server${servers.length !== 1 ? 's' : ''}`)
      ))
    }

    const grid = el('div', { className: 'grid grid-servers' })
    for (const server of servers) {
      const status = statusMap.get(server.id)
      const powerClass = status?.powerOn === true ? 'on' : status?.powerOn === false ? 'off' : 'unknown'

      const cached = dataCache[server.id]
      const fru = cached?.fru
      const subtitle = fru?.systemName || fru?.hostname || `${server.host}:${server.port}`

      const match = matches?.get(server.id)

      const card = el('div', { className: 'card server-card' },
        el('div', { className: 'server-card-header' },
          el('span', { className: 'server-card-name' }, server.name),
          el('span', { className: `badge badge-${server.type}` }, server.type)
        ),
        el('div', { className: 'server-card-host' }, subtitle),
        fru?.productName ? el('div', { style: 'font-size:11px;color:var(--text-muted);margin-top:2px' }, `${fru.productName}${fru.bmcVersion ? ' \u2022 FW ' + fru.bmcVersion : ''}`) : document.createTextNode(''),
        match ? el('div', { className: 'search-match' }, `Matched ${match.field}: ${match.value}`) : document.createTextNode(''),
        el('div', { className: 'server-card-footer' },
          el('span', {},
            el('span', { className: `status-dot ${powerClass}` }),
            status?.powerOn === true ? 'Power On' :
            status?.powerOn === false ? 'Power Off' : 'Checking...'
          ),
          server.proxy ? el('span', { className: 'badge', style: 'background:#333;color:#aaa;font-size:10px' }, 'PROXY') : document.createTextNode('')
        )
      )
      card.onclick = () => navigate(`#/server/${server.id}`)
      grid.appendChild(card)
    }
    group.appendChild(grid)
    return group
  }

  function renderProjectBar() {
    clear(projectBar)

    const addProjectBtn = el('button', { className: 'btn btn-ghost btn-sm', type: 'button' }, '+ New Project')
    const projectInput = el('input', { type: 'text', placeholder: 'Project name...', className: 'search-input' }) as HTMLInputElement
    projectInput.style.cssText = 'width:200px;margin:0;display:none;font-size:12px;padding:5px 10px;'
    const projectSaveBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'button', style: 'display:none' }, 'Add')

    addProjectBtn.onclick = () => {
      addProjectBtn.style.display = 'none'
      projectInput.style.display = ''
      projectSaveBtn.style.display = ''
      projectInput.focus()
    }

    projectSaveBtn.onclick = async () => {
      const name = projectInput.value.trim()
      if (name) {
        await (window as any).api.addProject({ name })
        projectInput.value = ''
        load()
      }
    }

    projectInput.onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') projectSaveBtn.click()
      if (e.key === 'Escape') {
        projectInput.style.display = 'none'
        projectSaveBtn.style.display = 'none'
        addProjectBtn.style.display = ''
        projectInput.value = ''
      }
    }

    projectBar.appendChild(addProjectBtn)
    projectBar.appendChild(projectInput)
    projectBar.appendChild(projectSaveBtn)

    for (const p of allProjects) {
      const tag = el('span', { className: 'project-tag' }, p.name)
      const delBtn = el('span', { className: 'project-tag-delete' }, '\u00d7')
      delBtn.onclick = async (e) => {
        e.stopPropagation()
        if (await confirmDialog('Delete Project', `Delete "${p.name}"? Servers will be unassigned, not deleted.`)) {
          await (window as any).api.deleteProject(p.id)
          load()
        }
      }
      tag.appendChild(delBtn)
      projectBar.appendChild(tag)
    }
  }

  searchInput.oninput = () => render()
  load()

  const unsub = window.api.onServerStatusUpdate((status) => {
    statusMap.set(status.serverId, { powerOn: status.powerOn, health: status.health })
    render()
  })
  cleanup = unsub
  window.api.startPolling()

  // Reload data when dashboard tab becomes active
  const onRefresh = () => load()
  window.addEventListener('dashboard:refresh', onRefresh)

  return () => {
    if (cleanup) cleanup()
    window.removeEventListener('dashboard:refresh', onRefresh)
    window.api.stopPolling()
  }
}
