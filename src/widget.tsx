import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MessageCircleMore, X } from 'lucide-react'

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

type WidgetLocale = 'en' | 'id'

const labels: Record<WidgetLocale, { open: string; close: string }> = {
  en: { open: 'Open chat', close: 'Close chat' },
  id: { open: 'Buka chat', close: 'Tutup chat' },
}

const defaultTheme: Theme = {
  buttonColor: '#0096a2',
  buttonTextColor: '#ffffff',
  iconSrc: '',
  title: '',
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

function Widget({ options, appOrigin, visitorId, greetingSeen, storagePrefix, host }: {
  options: OmnichannelOptions
  appOrigin: string
  visitorId: string
  greetingSeen: boolean
  storagePrefix: string
  host: HTMLElement
}) {
  const [open, setOpen] = useState(host.dataset.open === 'true')
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [ready, setReady] = useState(false)
  const [locale, setLocale] = useState<WidgetLocale>(() => {
    const saved = getStored(`${storagePrefix}:locale`)
    if (saved === 'id' || saved === 'en') return saved
    return navigator.language.toLowerCase().startsWith('id') ? 'id' : 'en'
  })
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const localeRef = useRef(locale)
  const reduceMotion = useReducedMotion()

  useEffect(() => { localeRef.current = locale }, [locale])
  const title = theme.title

  const frameUrl = useMemo(() => {
    const url = new URL(`/web-chat/embed/${encodeURIComponent(options.username)}`, appOrigin)
    url.searchParams.set('website_id', options.websiteId)
    url.searchParams.set('visitor_id', visitorId)
    if (greetingSeen) url.searchParams.set('greeting_seen', '1')
    return url.href
  }, [appOrigin, options.username, options.websiteId, visitorId, greetingSeen])

  useEffect(() => {
    const onControl = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail
      setOpen(next)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== appOrigin || event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'mimin:omnichannel:greeting-seen') {
        setStored(`${storagePrefix}:greeting`, '1')
      } else if (event.data?.type === 'mimin:omnichannel:locale-set') {
        if (event.data.locale === 'id' || event.data.locale === 'en') {
          setStored(`${storagePrefix}:locale`, event.data.locale)
          setLocale(event.data.locale)
        }
      } else if (event.data?.type === 'mimin:omnichannel:locale-ready') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'mimin:omnichannel:locale-apply', locale: localeRef.current }, appOrigin,
        )
      } else if (event.data?.type === 'mimin:omnichannel:theme') {
        setTheme(normalizeTheme(event.data.theme))
        setReady(true)
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'mimin:omnichannel:locale-apply', locale: localeRef.current }, appOrigin,
        )
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

  const toggle = () => {
    const next = !open
    setOpen(next)
  }

  return (
    <div className={`mimin-widget mimin-widget--${options.position === 'left' ? 'left' : 'right'}${open && ready ? ' mimin-widget--open' : ''}`}
      style={{ [options.position === 'left' ? 'left' : 'right']: '20px', zIndex: options.zIndex ?? 2147483000 }}>
      <motion.section className="mimin-panel" role="dialog" aria-label={title || labels[locale].open}
        aria-hidden={!open || !ready} inert={!open || !ready}
        initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.96, visibility: 'hidden' }}
        animate={open && ready
          ? { opacity: 1, y: 0, scale: 1, visibility: 'visible' }
          : { opacity: 0, y: 14, scale: 0.96, transitionEnd: { visibility: 'hidden' } }}
        transition={reduceMotion ? { duration: 0 } : { duration: open && ready ? 0.28 : 0.18, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: open && ready ? 'auto' : 'none' }}>
        <div className="mimin-panel-bar">
          <span className="mimin-panel-title">{title}</span>
          <button type="button" className="mimin-close" aria-label={labels[locale].close} onClick={toggle}><X aria-hidden="true" size={20} strokeWidth={2} /></button>
        </div>
        <iframe className="mimin-chat-frame" ref={iframeRef} src={frameUrl} title={title || labels[locale].open} allow="clipboard-write" />
      </motion.section>
      {ready && <motion.button type="button" className={`mimin-launcher${title && !open ? ' mimin-launcher--titled' : ''}`} style={{ backgroundColor: theme.buttonColor, color: theme.buttonTextColor }}
        whileHover={reduceMotion ? undefined : { scale: 1.06 }}
        whileTap={reduceMotion ? undefined : { scale: 0.94 }}
        transition={{ duration: 0.18 }}
        aria-label={open ? labels[locale].close : title || labels[locale].open} aria-expanded={open} title={open ? labels[locale].close : title || labels[locale].open} onClick={toggle}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={open ? 'close' : 'chat'} className="mimin-launcher-content"
            initial={reduceMotion ? false : { opacity: 0, rotate: -35, scale: 0.75 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, rotate: 35, scale: 0.75 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}>
            {open ? <X aria-hidden="true" size={22} strokeWidth={2} />
              : <>{theme.iconSrc ? <img className="mimin-launcher-image" src={theme.iconSrc} alt="" />
                : <MessageCircleMore aria-hidden="true" size={23} strokeWidth={1.9} />}
                {title && <span className="mimin-launcher-label">{title}</span>}</>}
          </motion.span>
        </AnimatePresence>
      </motion.button>}
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
