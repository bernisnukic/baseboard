import { el, clear } from './lib/dom.js'

export interface Tab {
  id: string
  label: string
  badge?: string
  hash: string
  contentEl: HTMLElement
  cleanup?: () => void
  pinned?: boolean
}

let tabs: Tab[] = []
let activeTabId: string | null = null
let tabBar: HTMLElement | null = null
let tabContentArea: HTMLElement | null = null

export function initTabs(barContainer: HTMLElement, contentContainer: HTMLElement): void {
  tabBar = barContainer
  tabContentArea = contentContainer
}

export function openTab(id: string, label: string, badge: string, hash: string, render: (container: HTMLElement) => (() => void) | void, pinned?: boolean): void {
  const existing = tabs.find(t => t.id === id)
  if (existing) {
    switchTab(id)
    return
  }

  const contentEl = el('div', { className: 'tab-content-panel' })
  contentEl.style.display = 'none'

  tabContentArea!.appendChild(contentEl)

  const cleanup = render(contentEl) || undefined

  const tab: Tab = { id, label, badge, hash, contentEl, cleanup: cleanup as (() => void) | undefined, pinned }
  tabs.push(tab)

  renderTabBar()
  switchTab(id)
}

export function switchTab(id: string): void {
  activeTabId = id
  for (const tab of tabs) {
    tab.contentEl.style.display = tab.id === id ? '' : 'none'
  }
  renderTabBar()
}

export function closeTab(id: string): void {
  const tab = tabs.find(t => t.id === id)
  if (!tab || tab.pinned) return

  const idx = tabs.indexOf(tab)
  if (tab.cleanup) tab.cleanup()
  tab.contentEl.remove()
  tabs.splice(idx, 1)

  if (activeTabId === id) {
    if (tabs.length > 0) {
      const newIdx = Math.min(idx, tabs.length - 1)
      switchTab(tabs[newIdx].id)
      window.location.hash = tabs[newIdx].hash
    } else {
      activeTabId = null
      renderTabBar()
    }
  } else {
    renderTabBar()
  }
}

export function closeAllTabs(): void {
  const pinned = tabs.filter(t => t.pinned)
  const closable = tabs.filter(t => !t.pinned)
  for (const tab of closable) {
    if (tab.cleanup) tab.cleanup()
    tab.contentEl.remove()
  }
  tabs = pinned
  if (pinned.length > 0) {
    switchTab(pinned[0].id)
  } else {
    activeTabId = null
  }
  renderTabBar()
}

export function hasTab(id: string): boolean {
  return tabs.some(t => t.id === id)
}

export function getActiveTabId(): string | null {
  return activeTabId
}

export function getTabCount(): number {
  return tabs.length
}

function renderTabBar(): void {
  if (!tabBar) return
  clear(tabBar)

  tabBar.style.display = 'flex'

  for (const tab of tabs) {
    const isActive = tab.id === activeTabId
    const tabEl = el('div', { className: `tab-item ${isActive ? 'active' : ''} ${tab.pinned ? 'pinned' : ''}` })

    if (tab.badge) {
      const badgeEl = el('span', { className: `tab-badge badge-${tab.badge}` }, tab.badge)
      tabEl.appendChild(badgeEl)
    }

    const labelEl = el('span', { className: 'tab-label' }, tab.label)
    tabEl.appendChild(labelEl)

    if (!tab.pinned) {
      const closeBtn = el('span', { className: 'tab-close' }, '\u00d7')
      closeBtn.onclick = (e) => {
        e.stopPropagation()
        closeTab(tab.id)
      }
      tabEl.appendChild(closeBtn)
    }

    tabEl.onclick = () => {
      switchTab(tab.id)
      window.location.hash = tab.hash
    }

    tabBar.appendChild(tabEl)
  }
}
