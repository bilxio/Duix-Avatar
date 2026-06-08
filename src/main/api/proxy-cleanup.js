import axios from 'axios'
import { proxyAdminUrl } from '../config/config.js'
import log from '../logger.js'

/**
 * 调用 proxy Admin API 清理远端作品产物并取消后台轮询
 * @param {{ code?: string, audioBasename?: string, protectedBasenames?: string[] }} payload
 */
export async function cleanupRemoteVideoArtifacts(payload) {
  if (!proxyAdminUrl) {
    return null
  }

  try {
    const health = await axios.get(`${proxyAdminUrl}/internal/health`, { timeout: 3000 })
    if (!health.data?.ok) {
      log.warn('~ cleanupRemoteVideoArtifacts ~ proxy admin 不可用')
      return null
    }
  } catch (error) {
    log.warn('~ cleanupRemoteVideoArtifacts ~ proxy 未启动，跳过远端清理:', error.message)
    return null
  }

  const res = await axios.post(`${proxyAdminUrl}/internal/cleanup/video`, payload, {
    timeout: 60_000,
  })
  log.info('~ cleanupRemoteVideoArtifacts ~', JSON.stringify(res.data))
  return res.data
}

/**
 * 调用 proxy Admin API 清理远端模特资产（参考视频、训练 wav、TTS 产物）
 * @param {{ modelVideoBasename?: string, originAudioBasename?: string, voiceDataRelPaths?: string[] }} payload
 */
export async function cleanupRemoteModelArtifacts(payload) {
  if (!proxyAdminUrl) {
    return null
  }

  try {
    const health = await axios.get(`${proxyAdminUrl}/internal/health`, { timeout: 3000 })
    if (!health.data?.ok) {
      log.warn('~ cleanupRemoteModelArtifacts ~ proxy admin 不可用')
      return null
    }
  } catch (error) {
    log.warn('~ cleanupRemoteModelArtifacts ~ proxy 未启动，跳过远端清理:', error.message)
    return null
  }

  const res = await axios.post(`${proxyAdminUrl}/internal/cleanup/model`, payload, {
    timeout: 60_000,
  })
  log.info('~ cleanupRemoteModelArtifacts ~', JSON.stringify(res.data))
  return res.data
}
