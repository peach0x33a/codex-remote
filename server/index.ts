import { createBridge } from './bridge'

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3000)
const origin = process.env.APP_ORIGIN
const accessKey = process.env.APP_ACCESS_KEY || ''
const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]']
const publicOrigin = origin && !loopback.includes(new URL(origin).hostname)
if ((!loopback.includes(host) || publicOrigin) && (!origin || accessKey.length < 16)) {
  throw new Error('对外监听需要 APP_ORIGIN=https://你的域名 和至少 16 字符的 APP_ACCESS_KEY。')
}
if (origin && !/^https?:\/\//.test(origin)) throw new Error('APP_ORIGIN 必须是完整的 http(s) 源地址。')
const origins = origin ? [new URL(origin).origin] : [
  'http://127.0.0.1:' + port, 'http://localhost:' + port,
  ...(process.env.NODE_ENV === 'development' ? ['http://127.0.0.1:' + (process.env.WEB_PORT || 5173), 'http://localhost:' + (process.env.WEB_PORT || 5173)] : []),
]
const app = createBridge({
  host, port, origins, accessKey,
  allowedHosts: process.env.APP_ALLOWED_HOSTS?.split(',').map(s => s.trim()).filter(Boolean),
  allowUnix: process.env.ALLOW_UNIX_SOCKETS !== 'false',
  staticDir: new URL('../dist/', import.meta.url).pathname,
  credentialFile: process.env.APP_CREDENTIALS_FILE || '.local/credentials.json',
})
console.log('Codex Remote listening on ' + (origin || 'http://' + host + ':' + app.server.port))
const stop = () => { app.stop(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
