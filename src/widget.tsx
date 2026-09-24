import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

export interface OmnichannelOptions {
  username: string
  websiteId: string
  /** Origin of the Mimin application, for example https://app.example.com. */
  appUrl: string
  position?: 'left' | 'right'
  zIndex?: number
}

export interface OmnichannelController {
  open(): void
  close(): void
  destroy(): void
}

declare const __WIDGET_VERSION__: string

interface Theme {
  buttonColor: string
  buttonTextColor: string
  iconSrc: string
  title: string
}

const defaultTheme: Theme = {
  buttonColor: '#0096a2',
  buttonTextColor: '#ffffff',
  iconSrc: '',
  title: 'Chat with us',
}

const visitorPattern = /^ow_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function newVisitorId(): string {
  if (typeof crypto.randomUUID === 'function') return `ow_${crypto.randomUUID()}`
  // getRandomValues also works on HTTP embedding sites where randomUUID may be unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `ow_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function getStored(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function setStored(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* private mode: memory for this page only */ }
}

function validColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && CSS.supports('color', value) ? value : fallback
}

function validImage(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
  } catch { return '' }
}

function normalizeTheme(value: unknown): Theme {
  if (!value || typeof value !== 'object') return defaultTheme
  const data = value as Record<string, unknown>
  return {
    buttonColor: validColor(data.buttonColor, defaultTheme.buttonColor),
    buttonTextColor: validColor(data.buttonTextColor, defaultTheme.buttonTextColor),
    iconSrc: validImage(data.iconSrc),
    title: typeof data.title === 'string' ? data.title.slice(0, 100) : defaultTheme.title,
  }
}

function ChatGlyph({ close = false }: { close?: boolean }) {
  return close
    ? <svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19" /></svg>
    : <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.5A7.5 7.5 0 1 1 20 11.5Z" /><path d="M7.5 11.5h9" /></svg>
}

function Widget({ options, appOrigin, visitorId, greetingSeen, storagePrefix, host }: {
  options: OmnichannelOptions
  appOrigin: string
  visitorId: string
  greetingSeen: boolean
  storagePrefix: string
  host: HTMLElement
}) {
  const [open, setOpen] = useState(host.dataset.open === 'true')
  const [everOpened, setEverOpened] = useState(host.dataset.open === 'true')
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [invalid, setInvalid] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const frameUrl = useMemo(() => {
    const url = new URL(`/web-chat/embed/${encodeURIComponent(options.username)}`, appOrigin)
    url.searchParams.set('website_id', options.websiteId)
    url.searchParams.set('visitor_id', visitorId)
    if (greetingSeen) url.searchParams.set('greeting_seen', '1')
    return url.href
  }, [appOrigin, options.username, options.websiteId, visitorId, greetingSeen])

  useEffect(() => {
    const controller = new AbortController()
    let stopped = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const url = new URL('/api/omnichannel-widget/theme', appOrigin)
    url.searchParams.set('website_id', options.websiteId)
    const loadTheme = async (attempt: number) => {
      try {
        const response = await fetch(url, { credentials: 'omit', signal: controller.signal })
        if (response.status === 400 || response.status === 404) { setInvalid(true); return }
        if (!response.ok) throw new Error(`Theme service returned ${response.status}`)
        setTheme(normalizeTheme(await response.json()))
      } catch {
        if (!stopped && attempt < 3) {
          retryTimer = setTimeout(() => loadTheme(attempt + 1), [1_000, 3_000, 8_000][attempt])
        }
      }
    }
    void loadTheme(0)
    return () => {
      stopped = true
      controller.abort()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [appOrigin, options.websiteId])

  useEffect(() => {
    const onControl = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail
      setOpen(next)
      if (next) setEverOpened(true)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== appOrigin || event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'mimin:omnichannel:greeting-seen') {
        setStored(`${storagePrefix}:greeting`, '1')
      } else if (event.data?.type === 'mimin:omnichannel:locale-set') {
        if (event.data.locale === 'id' || event.data.locale === 'en') {
          setStored(`${storagePrefix}:locale`, event.data.locale)
        }
      } else if (event.data?.type === 'mimin:omnichannel:theme') {
        setTheme(normalizeTheme(event.data.theme))
        const savedLocale = getStored(`${storagePrefix}:locale`)
        if (savedLocale === 'id' || savedLocale === 'en') {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'mimin:omnichannel:locale-apply', locale: savedLocale }, appOrigin,
          )
        }
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    host.addEventListener('mimin:control', onControl)
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      host.removeEventListener('mimin:control', onControl)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [appOrigin, host, storagePrefix])

  if (invalid) return null

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) setEverOpened(true)
  }

  return (
    <div className={`mimin-widget mimin-widget--${options.position === 'left' ? 'left' : 'right'}${open ? ' mimin-widget--open' : ''}`}
      style={{ [options.position === 'left' ? 'left' : 'right']: '20px', zIndex: options.zIndex ?? 2147483000 }}>
      {everOpened && <section className="mimin-panel" role="dialog" aria-label={theme.title} style={{ display: open ? 'flex' : 'none' }}>
        <div className="mimin-panel-bar">
          <span className="mimin-panel-title">{theme.title}</span>
          <button type="button" className="mimin-close" aria-label="Close chat" onClick={toggle}><ChatGlyph close /></button>
        </div>
        <iframe className="mimin-chat-frame" ref={iframeRef} src={frameUrl} title={theme.title} allow="clipboard-write" />
      </section>}
      <button type="button" className="mimin-launcher" style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
        aria-label={open ? 'Close chat' : theme.title} aria-expanded={open} title={theme.title} onClick={toggle}>
        {open ? <ChatGlyph close /> : theme.iconSrc ? <img className="mimin-launcher-image" src={theme.iconSrc} alt="" /> : <ChatGlyph />}
      </button>
    </div>
  )
}

let mounted: { root: Root; host: HTMLElement } | null = null

function control(open: boolean) {
  if (!mounted) return
  mounted.host.dataset.open = String(open)
  mounted.host.dispatchEvent(new CustomEvent('mimin:control', { detail: open }))
}

function destroy() {
  if (!mounted) return
  mounted.root.unmount()
  mounted.host.remove()
  mounted = null
}

export const Omnichannel = {
  init(options: OmnichannelOptions): OmnichannelController {
    if (!options?.username?.trim() || !options.websiteId?.trim() || !options.appUrl?.trim()) {
      throw new Error('Omnichannel.init requires username, websiteId, and appUrl')
    }
    const appUrl = new URL(options.appUrl)
    if (!['http:', 'https:'].includes(appUrl.protocol)) throw new Error('appUrl must be an HTTP(S) URL')
    destroy()

    const storagePrefix = `mimin:omnichannel:${appUrl.host}:${options.username}:${options.websiteId}`
    const storedId = getStored(`${storagePrefix}:visitor`)
    const visitorId = storedId && visitorPattern.test(storedId) ? storedId : newVisitorId()
    setStored(`${storagePrefix}:visitor`, visitorId)
    const greetingSeen = getStored(`${storagePrefix}:greeting`) === '1'

    const host = document.createElement('div')
    host.id = 'mimin-omnichannel-widget'
    host.dataset.open = 'false'
    const shadow = host.attachShadow({ mode: 'open' })
    const stylesheet = document.createElement('link')
    stylesheet.rel = 'stylesheet'
    stylesheet.href = import.meta.env.DEV
      ? new URL('./widget.css?direct', import.meta.url).href
      : new URL(`/omnichannel-widget/v${__WIDGET_VERSION__}/omnichannel.css`, appUrl.origin).href
    const container = document.createElement('div')
    shadow.append(stylesheet, container)
    document.body.append(host)
    const root = createRoot(container)
    const instance = { root, host }
    mounted = instance
    root.render(<Widget options={options} appOrigin={appUrl.origin} visitorId={visitorId}
      greetingSeen={greetingSeen} storagePrefix={storagePrefix} host={host} />)

    return {
      open: () => { if (mounted === instance) control(true) },
      close: () => { if (mounted === instance) control(false) },
      destroy: () => { if (mounted === instance) destroy() },
    }
  },
  open: () => control(true),
  close: () => control(false),
  destroy,
}

// A plain external module tag works on hosts that disallow inline scripts.
// Manual `import { Omnichannel } ...; Omnichannel.init(...)` remains supported.
if (typeof document !== 'undefined') {
  const script = Array.from(document.querySelectorAll<HTMLScriptElement>(
    'script[type="module"][data-mimin-username][data-mimin-website-id][data-mimin-app-url]',
  )).find((element) => element.src === import.meta.url)
  if (script) {
    Omnichannel.init({
      username: script.dataset.miminUsername || '',
      websiteId: script.dataset.miminWebsiteId || '',
      appUrl: script.dataset.miminAppUrl || '',
    })
  }
}
