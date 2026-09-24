import { Omnichannel } from './widget'

const input = (id: string) => (document.getElementById(id) as HTMLInputElement).value

document.getElementById('mount')?.addEventListener('click', () => {
  Omnichannel.init({
    username: input('username'),
    websiteId: input('websiteId'),
    appUrl: input('appUrl'),
  })
})
document.getElementById('unmount')?.addEventListener('click', () => Omnichannel.destroy())
