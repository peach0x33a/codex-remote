export const TEST_PORT = Number(process.env.E2E_PORT || 14731)
export const MOCK_PORT = Number(process.env.MOCK_PORT || 14501)
export const TEST_URL = 'http://127.0.0.1:' + TEST_PORT
export const MOCK_URL = 'http://127.0.0.1:' + MOCK_PORT
export const MOCK_ENDPOINT = 'ws://127.0.0.1:' + MOCK_PORT
