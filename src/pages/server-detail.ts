import { el, clear, navigate } from '../lib/dom.js'
import { confirmDialog } from '../lib/dialog.js'

export function renderServerDetail(container: HTMLElement, params: Record<string, string>): (() => void) | void {
  clear(container)
  const serverId = params.id

  const wrapper = el('div')
  container.appendChild(wrapper)

  // Cache: stores rendered DOM per tab so switching is instant
  const tabCache = new Map<string, HTMLElement>()

  async function load() {
    const server = await window.api.getServer(serverId)
    if (!server) { navigate('#/'); return }

    clear(wrapper)

    // Header
    const header = el('div', { className: 'detail-header' },
      el('div', {},
        el('div', { className: 'detail-title' }, server.name),
        el('div', { className: 'detail-subtitle' }, `${server.host}:${server.port} (${server.type})`)
      ),
      el('div', { className: 'detail-actions' },
        el('button', { className: 'btn btn-primary btn-sm' }, 'Remote Console'),
        el('button', { className: 'btn btn-ghost btn-sm' }, 'Duplicate'),
        el('button', { className: 'btn btn-ghost btn-sm' }, 'Edit'),
        el('button', { className: 'btn btn-danger btn-sm' }, 'Delete')
      )
    )
    wrapper.appendChild(header)

    const [consoleBtn, dupBtn, editBtn, deleteBtn] = header.querySelectorAll('button')
    consoleBtn.onclick = () => navigate(`#/server/${serverId}/console`)
    dupBtn.onclick = async () => {
      try {
        const newServer = await (window as any).api.duplicateServer(serverId)
        navigate(`#/server/${newServer.id}/edit`)
      } catch (err: any) {
        alert('Error: ' + err.message)
      }
    }
    editBtn.onclick = () => navigate(`#/server/${serverId}/edit`)
    deleteBtn.onclick = async () => {
      if (await confirmDialog('Delete Server', `Are you sure you want to delete "${server.name}"?`)) {
        await window.api.deleteServer(serverId)
        navigate('#/')
      }
    }

    // Power controls
    const powerBar = el('div', { className: 'power-bar' })
    for (const [action, label, cls] of [
      ['on', 'Power On', 'btn-success'],
      ['off', 'Power Off', 'btn-danger'],
      ['reset', 'Reset', 'btn-warning'],
      ['cycle', 'Power Cycle', 'btn-warning'],
      ['soft', 'Soft Off', 'btn-ghost'],
    ] as const) {
      const btn = el('button', { className: `btn btn-sm ${cls}` }, label)
      btn.onclick = async () => {
        if (!await confirmDialog('Power Action', `${label} "${server.name}"?`)) return
        try {
          await window.api.powerAction(serverId, action)
        } catch (err: any) {
          alert('Error: ' + err.message)
        }
      }
      powerBar.appendChild(btn)
    }
    wrapper.appendChild(powerBar)

    // Tabs
    const tabsEl = el('div', { className: 'tabs' })
    const tabContent = el('div', { style: 'position:relative' })
    const spinner = el('div', { className: 'tab-spinner' }, 'Refreshing...')
    spinner.style.display = 'none'
    wrapper.appendChild(tabsEl)
    wrapper.appendChild(spinner)
    wrapper.appendChild(tabContent)

    const tabDefs = ['Info', 'Sensors', 'Event Log']
    let activeTab = 'Info'
    let fetchGeneration = 0  // Incremented on each tab switch; stale fetches are discarded

    function renderTabs() {
      clear(tabsEl)
      for (const name of tabDefs) {
        const tab = el('div', { className: `tab ${name === activeTab ? 'active' : ''}` }, name)
        tab.onclick = () => {
          activeTab = name
          renderTabs()
          showTab(name)
        }
        tabsEl.appendChild(tab)
      }
    }

    function showTab(name: string) {
      const gen = ++fetchGeneration
      const cached = tabCache.get(name)
      clear(tabContent)

      if (cached) {
        // Show stale data immediately
        tabContent.appendChild(cached.cloneNode(true))
        // Revalidate in background
        spinner.style.display = ''
        fetchTabData(name).then(content => {
          if (gen !== fetchGeneration) return  // Stale — user switched tabs
          clear(tabContent)
          tabContent.appendChild(content)
          tabCache.set(name, content.cloneNode(true) as HTMLElement)
          spinner.style.display = 'none'
        }).catch(() => {
          if (gen === fetchGeneration) spinner.style.display = 'none'
        })
      } else {
        // First load
        tabContent.appendChild(el('div', { className: 'loading' }, 'Loading...'))
        fetchTabData(name).then(content => {
          if (gen !== fetchGeneration) return  // Stale
          clear(tabContent)
          tabContent.appendChild(content)
          tabCache.set(name, content.cloneNode(true) as HTMLElement)
        }).catch(err => {
          if (gen !== fetchGeneration) return  // Stale
          clear(tabContent)
          tabContent.appendChild(el('div', { className: 'card' },
            el('p', { style: 'color:var(--danger)' }, 'Error: ' + err.message)
          ))
        })
      }
    }

    async function fetchTabData(name: string): Promise<HTMLElement> {
      if (name === 'Info') {
        const [chassis, fru] = await Promise.all([
          window.api.getChassisStatus(serverId),
          window.api.getFruInfo(serverId)
        ])
        const table = el('table')
        const rows: [string, string][] = [
          ['Power State', chassis.powerOn ? 'ON' : 'OFF'],
          ['Manufacturer', fru.manufacturer],
          ['Product', fru.productName],
          ['Serial Number', fru.serialNumber],
          ['Part Number', fru.partNumber],
          ['BMC Firmware', fru.bmcVersion],
          ['Firmware Date', fru.firmwareVersion],
        ]
        if (fru.systemName) rows.push(['System Name', fru.systemName])
        if (fru.hostname) rows.push(['Hostname', fru.hostname])
        if (fru.uuid) rows.push(['UUID', fru.uuid])
        if (fru.ambientTemp) rows.push(['Ambient Temp', fru.ambientTemp])
        if (fru.powerOnHours !== undefined) rows.push(['Power On Hours', String(fru.powerOnHours)])
        if (fru.restartCount !== undefined) rows.push(['Restart Count', String(fru.restartCount)])
        if (chassis.lastPowerEvent) rows.push(['Last Power Event', chassis.lastPowerEvent])
        if (chassis.intrusion) rows.push(['Chassis Intrusion', chassis.intrusion])
        for (const [k, v] of rows) {
          table.appendChild(el('tr', {}, el('th', {}, k), el('td', {}, v || '-')))
        }
        return el('div', { className: 'card table-wrap' }, table)

      } else if (name === 'Sensors') {
        const sensors = await window.api.getSensorReadings(serverId)
        const table = el('table')
        table.appendChild(el('tr', {},
          el('th', {}, 'Sensor'), el('th', {}, 'Value'), el('th', {}, 'Unit'), el('th', {}, 'Status')
        ))
        for (const s of sensors) {
          table.appendChild(el('tr', {},
            el('td', {}, s.name),
            el('td', {}, s.value),
            el('td', {}, s.unit),
            el('td', { className: `sensor-${s.status}` }, s.status.toUpperCase())
          ))
        }
        return el('div', { className: 'card table-wrap' }, table)

      } else {
        const entries = await window.api.getSelEntries(serverId)
        const table = el('table')
        table.appendChild(el('tr', {},
          el('th', {}, '#'), el('th', {}, 'Time'), el('th', {}, 'Sensor'), el('th', {}, 'Event')
        ))
        for (const e of entries) {
          const cls = e.severity === 'critical' ? 'sensor-critical' :
                      e.severity === 'warning' ? 'sensor-warning' : ''
          table.appendChild(el('tr', { className: cls },
            el('td', {}, e.id), el('td', {}, e.timestamp), el('td', {}, e.sensor), el('td', {}, e.event)
          ))
        }
        return el('div', { className: 'card table-wrap' }, table)
      }
    }

    renderTabs()
    showTab('Info')
  }

  load()
  return () => {}
}
