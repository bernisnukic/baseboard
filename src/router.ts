type RouteHandler = (container: HTMLElement, params: Record<string, string>) => (() => void) | void | Promise<(() => void) | void>

const routes: { pattern: RegExp; keys: string[]; handler: RouteHandler }[] = []
let currentCleanup: (() => void) | null = null

export function route(path: string, handler: RouteHandler): void {
  const keys: string[] = []
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, (_, key) => {
      keys.push(key)
      return '([^/]+)'
    }) + '$'
  )
  routes.push({ pattern, keys, handler })
}

export function startRouter(): void {
  const container = document.getElementById('content')!
  const resolve = async () => {
    const hash = window.location.hash.slice(1) || '/'
    if (currentCleanup) {
      currentCleanup()
      currentCleanup = null
    }
    for (const r of routes) {
      const match = hash.match(r.pattern)
      if (match) {
        const params: Record<string, string> = {}
        r.keys.forEach((key, i) => { params[key] = match[i + 1] })
        const result = r.handler(container, params)
        // Handle async handlers (tab pages)
        const cleanup = result instanceof Promise ? await result : result
        if (typeof cleanup === 'function') currentCleanup = cleanup
        return
      }
    }
    // 404
    container.textContent = 'Page not found'
  }

  window.addEventListener('hashchange', () => resolve())
  resolve()

  // Handle data-link clicks
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-link]')
    if (target) {
      e.preventDefault()
      window.location.hash = target.getAttribute('data-link')!
    }
  })
}
