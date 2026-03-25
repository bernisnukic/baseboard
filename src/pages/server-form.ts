import { el, clear, navigate } from '../lib/dom.js'

export function renderServerForm(container: HTMLElement, params: Record<string, string>): void {
  clear(container)
  const isDuplicate = window.location.hash.includes('/duplicate')
  const isEdit = !isDuplicate && params.id && params.id !== 'new'
  const loadFromId = params.id && params.id !== 'new' ? params.id : null

  const form = el('div', { className: 'card', style: 'max-width:600px' })
  container.appendChild(form)

  const title = el('h2', { style: 'margin-bottom:20px' }, isEdit ? 'Edit Server' : isDuplicate ? 'Duplicate Server' : 'Add Server')
  form.appendChild(title)

  const fields = {
    name: createField('Name', 'text', 'My Server'),
    host: createField('Host / IP', 'text', '192.168.1.100'),
    port: createField('Web/IPMI Port', 'number', '623'),
    kvmPort: createField('KVM Console Port', 'number', '3900'),
    type: createSelect('Type', { ipmi: 'Generic IPMI', imm2: 'Lenovo IMM2', idrac: 'Dell iDRAC', supermicro: 'Supermicro' }),
    username: createField('Username', 'text', 'USERID'),
    password: createField(isEdit ? 'Password (leave blank to keep)' : 'Password', 'password', ''),
  }

  // Jump server dropdown
  const jumpSelect = document.createElement('select') as HTMLSelectElement
  const jumpNone = document.createElement('option')
  jumpNone.value = ''
  jumpNone.textContent = 'Direct (no proxy)'
  jumpSelect.appendChild(jumpNone)
  const jumpGroup = el('div', { className: 'form-group' }, el('label', {}, 'Jump Server'), jumpSelect)

  // Project dropdown
  const projectSelect = document.createElement('select') as HTMLSelectElement
  const projectNone = document.createElement('option')
  projectNone.value = ''
  projectNone.textContent = 'No project'
  projectSelect.appendChild(projectNone)
  const projectGroup = el('div', { className: 'form-group' }, el('label', {}, 'Project'), projectSelect)

  const row1 = el('div', { className: 'form-row' }, fields.name.group, fields.type.group)
  const row2 = el('div', { className: 'form-row' }, fields.host.group, fields.port.group)
  const row3 = el('div', { className: 'form-row' }, fields.username.group, fields.password.group)
  const row4 = el('div', { className: 'form-row' }, fields.kvmPort.group, jumpGroup)
  const row5 = el('div', { className: 'form-row' }, projectGroup, el('div'))

  form.appendChild(row1)
  form.appendChild(row2)
  form.appendChild(row3)
  form.appendChild(row4)
  form.appendChild(row5)

  // Manage jump servers link
  const manageBtn = el('button', { className: 'btn btn-ghost btn-sm', style: 'font-size:11px;margin-bottom:16px' }, 'Manage Jump Servers')
  manageBtn.onclick = () => navigate('#/jump-servers')
  form.appendChild(manageBtn)

  // Type changes default ports
  fields.type.input.onchange = () => {
    const t = fields.type.input.value
    if (t === 'imm2') { fields.kvmPort.input.value = '3900'; fields.port.input.value = '443' }
    else if (t === 'idrac') { fields.kvmPort.input.value = '5900'; fields.port.input.value = '443' }
    else if (t === 'supermicro') { fields.kvmPort.input.value = '5900'; fields.port.input.value = '623' }
    else { fields.kvmPort.input.value = '5900'; fields.port.input.value = '623' }
  }

  // Actions
  const actions = el('div', { className: 'form-actions' },
    el('button', { className: 'btn btn-primary' }, isEdit ? 'Save' : 'Add Server'),
    el('button', { className: 'btn btn-ghost' }, 'Cancel')
  )
  form.appendChild(actions)

  const saveBtn = actions.children[0] as HTMLButtonElement
  const cancelBtn = actions.children[1] as HTMLButtonElement
  cancelBtn.onclick = () => navigate('#/')

  saveBtn.onclick = async () => {
    const config: any = {
      name: fields.name.input.value.trim(),
      host: fields.host.input.value.trim(),
      port: parseInt(fields.port.input.value) || 623,
      kvmPort: parseInt(fields.kvmPort.input.value) || 3900,
      type: fields.type.input.value,
      username: fields.username.input.value.trim(),
    }

    if (!config.name || !config.host || !config.username) {
      alert('Name, host, and username are required')
      return
    }

    config.projectId = projectSelect.value || undefined

    const jumpId = jumpSelect.value
    if (jumpId) {
      const jump = await (window as any).api.getJumpServer(jumpId)
      if (jump) {
        config.proxy = {
          host: jump.host,
          port: jump.sshPort,
          sshPort: jump.sshPort,
          username: jump.username,
          mode: 'ssh',
          jumpId: jump.id
        }
      }
    } else {
      config.proxy = undefined
    }

    const password = fields.password.input.value
    try {
      saveBtn.disabled = true
      if (isEdit) {
        await window.api.updateServer(params.id, config, password || undefined)
      } else {
        if (!password) { alert('Password is required'); saveBtn.disabled = false; return }
        await window.api.addServer(config, password)
      }
      navigate('#/')
    } catch (err: any) {
      alert('Error: ' + err.message)
      saveBtn.disabled = false
    }
  }

  // Load jump servers, projects, and existing data
  ;(async () => {
    const [jumps, projects] = await Promise.all([
      (window as any).api.getJumpServers(),
      (window as any).api.getProjects()
    ])

    for (const j of jumps) {
      const opt = document.createElement('option')
      opt.value = j.id
      opt.textContent = `${j.name} (${j.username}@${j.host}:${j.sshPort})`
      jumpSelect.appendChild(opt)
    }

    for (const p of projects) {
      const opt = document.createElement('option')
      opt.value = p.id
      opt.textContent = p.name
      projectSelect.appendChild(opt)
    }

    if (loadFromId) {
      const server = await window.api.getServer(loadFromId)
      if (!server) { navigate('#/'); return }
      fields.name.input.value = isDuplicate ? server.name + ' (copy)' : server.name
      fields.host.input.value = server.host
      fields.port.input.value = String(server.port)
      fields.kvmPort.input.value = String(server.kvmPort)
      fields.type.input.value = server.type
      fields.username.input.value = server.username
      if ((server as any).projectId) projectSelect.value = (server as any).projectId
      if ((server.proxy as any)?.jumpId) jumpSelect.value = (server.proxy as any).jumpId
    }
  })()
}

function createField(label: string, type: string, placeholder: string) {
  const input = el('input', { type, placeholder }) as HTMLInputElement
  const group = el('div', { className: 'form-group' }, el('label', {}, label), input)
  return { group, input }
}

function createSelect(label: string, options: Record<string, string>) {
  const input = document.createElement('select') as HTMLSelectElement
  for (const [value, text] of Object.entries(options)) {
    const opt = document.createElement('option')
    opt.value = value
    opt.textContent = text
    input.appendChild(opt)
  }
  const group = el('div', { className: 'form-group' }, el('label', {}, label), input)
  return { group, input }
}
