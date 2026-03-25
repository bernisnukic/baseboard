export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const elem = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') elem.className = v
      else elem.setAttribute(k, v)
    }
  }
  for (const child of children) {
    if (typeof child === 'string') elem.appendChild(document.createTextNode(child))
    else elem.appendChild(child)
  }
  return elem
}

export function clear(container: HTMLElement): void {
  while (container.firstChild) container.removeChild(container.firstChild)
}

export function navigate(hash: string): void {
  window.location.hash = hash
}
