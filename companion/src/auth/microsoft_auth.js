'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { Authflow } = require('prismarine-auth')

/**
 * Resolves the secure user-specific local token directory outside of the repo.
 * Follows OS standards:
 * - Windows: %LOCALAPPDATA%\GuiaIA\auth
 * - Linux/macOS: ~/.config/guiaia/auth
 */
function getAuthStorageDir() {
  let baseDir
  if (process.platform === 'win32') {
    baseDir = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  } else {
    baseDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  }

  const authDir = path.join(baseDir, 'GuiaIA', 'auth')
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true, mode: 0o700 })
  }
  return authDir
}

/**
 * Checks if cached tokens exist for a specific account.
 */
function hasCachedTokens(username, customDir = null) {
  if (!username || typeof username !== 'string') return false
  const storageDir = customDir || getAuthStorageDir()
  const accountDir = path.join(storageDir, username)
  return fs.existsSync(accountDir)
}

/**
 * Clears stored Microsoft OAuth cache for an account.
 */
function clearAuthTokens(username, customDir = null) {
  if (!username || typeof username !== 'string') return false
  const storageDir = customDir || getAuthStorageDir()
  const accountDir = path.join(storageDir, username)
  if (fs.existsSync(accountDir)) {
    fs.rmSync(accountDir, { recursive: true, force: true })
    return true
  }
  return false
}

/**
 * Creates a configured Authflow instance using the local protected storage directory.
 * @param {string} username - Account email or profile name
 * @param {object} options - Optional callbacks including onMsaCode
 */
function createMicrosoftAuthFlow(username, options = {}) {
  if (!username || typeof username !== 'string') {
    throw new Error('Valid username or email required for Microsoft Auth')
  }

  const storageDir = options.customStorageDir || getAuthStorageDir()
  const authflow = new Authflow(username, storageDir, {
    flow: 'msal',
    authTitle: '00000000402b5328', // Minecraft Java Client ID
    onMsaCode: options.onMsaCode || ((data) => {
      console.log(`[GuiaIA Auth] Para iniciar sesion con Microsoft, visita: ${data.verification_uri}`)
      console.log(`[GuiaIA Auth] E introduce el codigo: ${data.user_code}`)
    })
  })

  return {
    authflow,
    storageDir,
    async getMinecraftToken() {
      return await authflow.getMinecraftJavaToken()
    }
  }
}

/**
 * Builds standard Mineflayer connection options for Microsoft authentication.
 */
function buildMineflayerAuthOptions({ username, authMode = 'microsoft', customStorageDir = null, onMsaCode = null }) {
  if (authMode === 'offline') {
    return {
      username: username || 'GuiaBot',
      auth: 'offline'
    }
  }

  const storageDir = customStorageDir || getAuthStorageDir()
  return {
    username,
    auth: 'microsoft',
    profilesFolder: storageDir,
    onMsaCode: onMsaCode || ((data) => {
      console.log(`\n================ GUIAIA AUTHENTICATION ================`)
      console.log(`Visita:  ${data.verification_uri}`)
      console.log(`Codigo:  ${data.user_code}`)
      console.log(`=======================================================\n`)
    })
  }
}

module.exports = {
  getAuthStorageDir,
  hasCachedTokens,
  clearAuthTokens,
  createMicrosoftAuthFlow,
  buildMineflayerAuthOptions
}
