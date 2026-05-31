// Ambient declarations for the vendored noVNC RFB client.
//
// noVNC ships as plain JavaScript with no type definitions, so importing
// rfb.js from TypeScript otherwise raises TS7016 ("implicitly has an 'any'
// type"). This types only the surface the app actually uses (see
// src/pages/console.ts); the rest of the client stays untyped JS.
//
// noVNC is licensed under MPL-2.0 — see ./LICENSE.txt.
// Upstream: https://github.com/novnc/noVNC

export interface RFBCredentials {
  username?: string
  password?: string
  target?: string
}

export interface RFBOptions {
  shared?: boolean
  credentials?: RFBCredentials
  repeaterID?: string
  wsProtocols?: string[]
}

// RFB extends EventTarget upstream, which provides the addEventListener used
// for the 'connect' / 'disconnect' / 'credentialsrequired' events.
export default class RFB extends EventTarget {
  constructor(target: HTMLElement, urlOrChannel: string, options?: RFBOptions)

  scaleViewport: boolean
  clipViewport: boolean
  resizeSession: boolean
  background: string

  sendCtrlAltDel(): void
  sendCredentials(credentials: RFBCredentials): void
  disconnect(): void
}
