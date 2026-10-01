import { resolve } from 'node:path'
import { createBridge } from '../server/bridge'
import { TEST_PORT, TEST_URL } from './config'

// Do not inherit a developer's production .env authentication or credential file.
const app = createBridge({
  host: '127.0.0.1', port: TEST_PORT, origins: [TEST_URL],
  allowedHosts: ['127.0.0.1', 'localhost'], allowUnix: false,
  staticDir: resolve(process.env.E2E_STATIC_DIR || 'dist'),
  credentialFile: resolve('.local/e2e-credentials.json'),
})
const stop = () => { app.stop(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
