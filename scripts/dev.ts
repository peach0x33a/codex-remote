export {}
const bridgePort = process.env.BRIDGE_PORT || '3001'
const children = [
  Bun.spawn(['bun', '--watch', 'server/index.ts'], { env: { ...process.env, PORT: bridgePort, NODE_ENV: 'development' }, stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'run', 'dev:web'], { stdout: 'inherit', stderr: 'inherit' }),
]
let stopping = false
const stop = () => { if (stopping) return; stopping = true; children.forEach(child => child.kill()); }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await Promise.race(children.map(child => child.exited))
stop()
await Promise.all(children.map(child => child.exited))
