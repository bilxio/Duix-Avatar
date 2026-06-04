import path from 'path'
import os from 'os'

const isDev = process.env.NODE_ENV === 'development'
const isWin = process.platform === 'win32'

// 开发时走本机 proxy_tcp（127.0.0.1），由代理 SFTP 同步文件到远端 GPU 机再转发 API。
// 若直连 192.168.x.x，TTS 会在远端容器里找文件，而 wav 只在本机 ~/duix_avatar_data，会报 file not exists。
export const serviceUrl = {
  face2face: isDev ? 'http://127.0.0.1:8383/easy' : 'http://127.0.0.1:8383/easy',
  tts: isDev ? 'http://127.0.0.1:18180' : 'http://127.0.0.1:18180'
}

export const assetPath = {
  model: isWin
    ? path.join('D:', 'duix_avatar_data', 'face2face', 'temp')
    : path.join(os.homedir(), 'duix_avatar_data', 'face2face', 'temp'), // 模特视频
  ttsProduct: isWin
    ? path.join('D:', 'duix_avatar_data', 'face2face', 'temp')
    : path.join(os.homedir(), 'duix_avatar_data', 'face2face', 'temp'), // TTS 产物
  ttsRoot: isWin
    ? path.join('D:', 'duix_avatar_data', 'voice', 'data')
    : path.join(os.homedir(), 'duix_avatar_data', 'voice', 'data'), // TTS服务根目录
  ttsTrain: isWin
    ? path.join('D:', 'duix_avatar_data', 'voice', 'data', 'origin_audio')
    : path.join(os.homedir(), 'duix_avatar_data', 'voice', 'data', 'origin_audio') // TTS 训练产物
}
