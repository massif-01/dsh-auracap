// Developer-only isolated UI runner; production API and client, fixture device status.
// node --experimental-vm-modules scripts/preview-backup.mjs
import { fixture } from './backup-fixture.mjs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const connected = process.env.AURACAP_PREVIEW_CONNECTED !== '0'
const app = await fixture({ home: process.env.AURACAP_PREVIEW_HOME, empty: process.env.AURACAP_PREVIEW_EMPTY === '1', network: async url => {
  if (url === 'https://github.com/login/device/code') return new Response(JSON.stringify({ device_code: 'fixture-device', user_code: 'DEMO-CODE', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 }))
  throw Error('No external network in isolated UI verification: ' + url)
} })
const vendor = new URL('../output/preview-support/vendor/', import.meta.url)
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>AuraCap · isolated backup verification</title><style>html,body,#root{height:100%;margin:0}body{--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fafafa;--dsw-alias-bg-layer-2:#f5f6f8;--dsw-alias-border-l1:#0000001a;--dsw-alias-border-l2:#00000029;--dsw-alias-brand-primary:#0f1115;--dsw-alias-state-success-primary:#49836b}</style></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>
window.__ModuleLoader__={load({factory}){const plugin=factory(name=>{if(name==='react')return React;throw Error(name)});const tables={};plugin.apply({locale:{register(ns,lang,t){tables[lang]=t},bind(){return key=>tables[/^zh/i.test(document.documentElement.lang)?'zh':'en']?.[key]}},slots:{inject(name,fn){fn()},register(config,Component){if(config.name==='main')ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component));return()=>{}}}})}};
</script><script src="/client.js"></script></body></html>`
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost')
    if(['/auracap/api/github/status','/auracap/api/github/sync','/auracap/api/github/shortcut'].includes(url.pathname)) {
      res.setHeader('x-auracap-generation',app.gate.generation);res.setHeader('content-type','application/json')
      const status = await (await fetch(app.origin + '/auracap/api/github/status')).json()
      return res.end(JSON.stringify({...status,connected,repo:connected?{owner:'preview',name:'auracap'}:null,queueCount:0,lastSyncAt:null,config:'fixture-only'}))
    }
    if(url.pathname.startsWith('/auracap/')) {
      const response=await fetch(app.origin+req.url,{method:req.method,headers:{...req.headers,origin:app.origin},...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})})
      res.writeHead(response.status,Object.fromEntries(response.headers))
      if(response.body) await pipeline(Readable.fromWeb(response.body),res);else res.end()
      return
    }
    const files={'/react.js':new URL('react-18.3.1.min.js',vendor),'/react-dom.js':new URL('react-dom-18.3.1.min.js',vendor),'/client.js':new URL('../client.js',import.meta.url)}
    if(files[url.pathname]) {res.setHeader('content-type','text/javascript');return res.end(await readFile(files[url.pathname]))}
    res.setHeader('content-type','text/html');res.end(html)
  } catch(error) {if(!res.headersSent)res.writeHead(500);res.end(error.message)}
})
server.listen(Number(process.env.AURACAP_PREVIEW_PORT || 0),'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,home:app.home})))
process.on('SIGTERM',async()=>{await new Promise(resolve=>server.close(resolve));await app.close();process.exit(0)})
