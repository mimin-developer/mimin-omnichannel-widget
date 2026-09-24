import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../src/widget.css', import.meta.url))
const target = fileURLToPath(new URL('../dist/omnichannel.css', import.meta.url))
copyFileSync(source, target)
