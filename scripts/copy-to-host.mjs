import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
const root = process.env.MIMIN_HOST_PUBLIC_DIR || resolve('..', 'mimin-workflow', 'public', 'omnichannel-widget')
const target = resolve(root, `v${version}`)
mkdirSync(target, { recursive: true })
copyFileSync(resolve('dist', 'omnichannel.js'), resolve(target, 'omnichannel.js'))
copyFileSync(resolve('dist', 'omnichannel.css'), resolve(target, 'omnichannel.css'))
console.log(`Copied omnichannel.js and omnichannel.css to ${target}`)
