import { el, clear, navigate } from '../lib/dom.js'
import { confirmDialog } from '../lib/dialog.js'

export function renderJumpServers(container: HTMLElement): void {
  clear(container)

  const wrapper = el('div', { style: 'max-width:700px' })
  container.appendChild(wrapper)

  const header = el('div', { className: 'detail-header' },
    el('h2', { className: 'detail-title' }, 'Jump Servers'),
    el('div', { className: 'detail-actions' },
      el('button', { className: 'btn btn-ghost btn-sm' }, 'Back')
    )
  )
  wrapper.appendChild(header)
  ;(header.querySelector('button') as HTMLButtonElement).onclick = () => navigate('#/')

  const list = el('div', { style: 'margin-bottom:24px' })
  wrapper.appendChild(list)

  // Add form
  const formCard = el('div', { className: 'card', style: 'margin-top:16px' },
    el('h3', { style: 'margin-bottom:12px;font-size:14px' }, 'Add Jump Server')
  )
  const nameInput = el('input', { type: 'text', placeholder: 'e.g. Bicom Jump' }) as HTMLInputElement
  const hostInput = el('input', { type: 'text', placeholder: '185.59.93.56' }) as HTMLInputElement
  const portInput = el('input', { type: 'number', placeholder: '22' }) as HTMLInputElement
  portInput.value = '22'
  const userInput = el('input', { type: 'text', placeholder: 'bernisn' }) as HTMLInputElement

  formCard.appendChild(el('div', { className: 'form-row' },
    el('div', { className: 'form-group' }, el('label', {}, 'Name'), nameInput),
    el('div', { className: 'form-group' }, el('label', {}, 'Username'), userInput)
  ))
  formCard.appendChild(el('div', { className: 'form-row' },
    el('div', { className: 'form-group' }, el('label', {}, 'Host'), hostInput),
    el('div', { className: 'form-group' }, el('label', {}, 'SSH Port'), portInput)
  ))

  const addBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'button' }, 'Add Jump Server')
  formCard.appendChild(addBtn)
  wrapper.appendChild(formCard)

  async function load() {
    const jumps = await (window as any).api.getJumpServers()
    clear(list)

    if (jumps.length === 0) {
      list.appendChild(el('p', { style: 'color:var(--text-secondary);font-size:13px' }, 'No jump servers configured. Add one below.'))
      return
    }

    for (const j of jumps) {
      const card = el('div', { className: 'card', style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' },
        el('div', {},
          el('span', { style: 'font-weight:600;font-size:14px' }, j.name),
          el('span', { style: 'color:var(--text-secondary);font-size:12px;margin-left:12px;font-family:monospace' },
            `${j.username}@${j.host}:${j.sshPort}`)
        ),
        el('button', { className: 'btn btn-danger btn-sm' }, 'Delete')
      )
      const delBtn = card.querySelector('.btn-danger') as HTMLButtonElement
      delBtn.onclick = async () => {
        if (await confirmDialog('Delete Jump Server', `Delete "${j.name}"?`)) {
          await (window as any).api.deleteJumpServer(j.id)
          load()
        }
      }
      list.appendChild(card)
    }
  }

  addBtn.onclick = async () => {
    const name = nameInput.value.trim()
    const host = hostInput.value.trim()
    const sshPort = parseInt(portInput.value) || 22
    const username = userInput.value.trim()

    if (!name || !host || !username) {
      alert('Name, host, and username are required')
      return
    }

    try {
      await (window as any).api.addJumpServer({ name, host, sshPort, username })
    } catch (err: any) {
      alert('Error adding jump server: ' + err.message)
      return
    }
    nameInput.value = ''
    hostInput.value = ''
    portInput.value = '22'
    userInput.value = ''
    load()
  }

  load()
}
