import { resolve } from 'node:path'
import { createBridge } from '../server/bridge'
import { AUTH_TEST_KEY, AUTH_TEST_PORT, AUTH_TEST_URL, TEST_PORT, TEST_URL } from './config'

// Do not inherit a developer's production .env authentication or credential file.
const app = createBridge({
  host: '127.0.0.1', port: TEST_PORT, origins: [TEST_URL],
  allowedHosts: ['127.0.0.1', 'localhost'], allowUnix: false,
  staticDir: resolve(process.env.E2E_STATIC_DIR || 'dist'),
  credentialFile: resolve('.local/e2e-credentials.json'),
})
const authenticatedApp = createBridge({
  host: '127.0.0.1', port: AUTH_TEST_PORT, origins: [AUTH_TEST_URL], accessKey: AUTH_TEST_KEY,
  allowedHosts: ['127.0.0.1', 'localhost'], allowUnix: false,
  staticDir: resolve(process.env.E2E_STATIC_DIR || 'dist'),
  credentialFile: resolve('.local/e2e-login-credentials.json'),
})
const stop = () => { app.stop(); authenticatedApp.stop(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
