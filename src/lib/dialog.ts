import { el } from './dom.js'

export function confirmDialog(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el('div', { className: 'confirm-overlay' })
    const dialog = el('div', { className: 'confirm-dialog' },
      el('h3', {}, title),
      el('p', {}, message),
    )

    const actions = el('div', { className: 'confirm-actions' })
    const cancelBtn = el('button', { className: 'btn btn-ghost', type: 'button' }, 'Cancel')
    const confirmBtn = el('button', { className: 'btn btn-danger', type: 'button' }, 'Confirm')

    cancelBtn.onclick = () => { overlay.remove(); resolve(false) }
    confirmBtn.onclick = () => { overlay.remove(); resolve(true) }

    // Escape key cancels
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { overlay.remove(); resolve(false); document.removeEventListener('keydown', onKey) }
      if (e.key === 'Enter') { overlay.remove(); resolve(true); document.removeEventListener('keydown', onKey) }
    }
    document.addEventListener('keydown', onKey)

    actions.appendChild(cancelBtn)
    actions.appendChild(confirmBtn)
    dialog.appendChild(actions)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    confirmBtn.focus()
  })
}
