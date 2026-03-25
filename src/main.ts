import './style.css'
import { route, startRouter } from './router.js'
import { renderDashboard } from './pages/dashboard.js'
import { renderServerForm } from './pages/server-form.js'
import { renderServerDetail } from './pages/server-detail.js'
import { renderConsole } from './pages/console.js'
import { renderJumpServers } from './pages/jump-servers.js'
import { initTabs, openTab, hasTab, switchTab } from './tabs.js'

const content = document.getElementById('content')!
const tabBar = document.getElementById('tab-bar')!
const tabPanels = document.getElementById('tab-panels')!

initTabs(tabBar, tabPanels)

// Create the pinned home tab
openTab('home', 'Servers', '', '#/', (container) => {
  return renderDashboard(container)
}, true)

// Non-tab pages (forms): show in #content, hide tab panels
function showContent(handler: (container: HTMLElement, params: Record<string, string>) => (() => void) | void) {
  return (container: HTMLElement, params: Record<string, string>) => {
    // Hide tab panels, show content area
    for (const panel of tabPanels.querySelectorAll('.tab-content-panel') as NodeListOf<HTMLElement>) {
      panel.style.display = 'none'
    }
    content.style.display = ''
    tabPanels.style.display = 'none'
    return handler(container, params)
  }
}

// Tab pages: hide #content, open/switch tab
async function serverTabPage(
  suffix: string,
  handler: (container: HTMLElement, params: Record<string, string>) => (() => void) | void,
  _container: HTMLElement,
  params: Record<string, string>
): Promise<void> {
  const id = params.id
  const tabId = `${id}-${suffix}`
  content.style.display = 'none'
  tabPanels.style.display = ''

  if (hasTab(tabId)) {
    switchTab(tabId)
    return
  }

  // Get server info for tab label
  let name = 'Server'
  let type = 'ipmi'
  try {
    const server = await window.api.getServer(id)
    if (server) { name = server.name; type = server.type }
  } catch {}

  const label = suffix === 'console' ? `${name} [KVM]` : name
  const hash = suffix === 'console' ? `#/server/${id}/console` : `#/server/${id}`

  openTab(tabId, label, type, hash, (tabContainer) => {
    return handler(tabContainer, params)
  })
}

// Route: home/dashboard
route('/', (_container, _params) => {
  content.style.display = 'none'
  tabPanels.style.display = ''
  switchTab('home')
  window.dispatchEvent(new CustomEvent('dashboard:refresh'))
})

// Routes: forms (not tabs)
route('/jump-servers', showContent(renderJumpServers))
route('/server/new', showContent(renderServerForm))
route('/server/:id/edit', showContent(renderServerForm))

// Routes: server pages (tabs)
route('/server/:id/console', (container, params) => {
  return serverTabPage('console', renderConsole, container, params) as any
})
route('/server/:id', (container, params) => {
  return serverTabPage('detail', renderServerDetail, container, params) as any
})

startRouter()
