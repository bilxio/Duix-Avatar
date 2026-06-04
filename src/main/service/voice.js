import { selectAll, insert, selectByID } from '../dao/voice.js'
import { preprocessAndTran, makeAudio as makeAudioApi } from '../api/tts.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { assetPath } from '../config/config.js'
import log from '../logger.js'
import { ipcMain } from 'electron'
import dayjs from 'dayjs'

const MODEL_NAME = 'voice'

function formatTrainError(msg) {
  if (!msg) return '语音模型训练失败'
  if (msg.includes('NoneType') && msg.includes('send')) {
    return (
      'ASR 语音识别服务未就绪（duix-avatar-asr 未启动或仍在加载）。' +
      '请在 GPU 服务器执行 docker ps 确认 asr/tts 均为 Running，' +
      '启动后等待 2～5 分钟再提交定制；若刚做过视频合成，请确认代理已执行 docker start 恢复容器。'
    )
  }
  if (/connection refused/i.test(msg)) {
    return '无法连接 ASR 服务，请检查 duix-avatar-asr 容器是否在运行（端口 10095）。'
  }
  if (/asr failed/i.test(msg)) {
    return (
      '语音识别失败（ASR 未返回有效文本）。常见原因：① 模特视频里人声不清晰或太短（建议 10 秒以上连续中文说话）；' +
      '② 刚合成完视频后 ASR 尚未完全加载——等 1～2 分钟再提交，或看 proxy 日志是否出现「ASR 模型加载完成」；' +
      '③ 8GB 显存机器需保持 gen-video 停止后再训练。'
    )
  }
  return msg
}

export function getAllTimbre() {
  return selectAll()
}

export async function train(path, lang = 'zh') {
  path = path.replace(/\\/g, '/') // 将路径中的\替换为/
  const res = await preprocessAndTran({
    format: path.split('.').pop(),
    reference_audio: path,
    lang
  })
  log.debug('~ train ~ res:', res)
  if (res.code !== 0) {
    throw new Error(formatTrainError(res.msg))
  } else {
    const { asr_format_audio_url, reference_audio_text } = res
    return insert({ origin_audio_path: path, lang, asr_format_audio_url, reference_audio_text })
  }
}

export function makeAudio4Video({voiceId, text}) {
  return makeAudio({voiceId, text, targetDir: assetPath.ttsProduct})
}

export function copyAudio4Video(filePath) {
  // 将filePath复制到ttsProduct目录下
  const targetDir = assetPath.ttsProduct
  const fileName = dayjs().format('YYYYMMDDHHmmssSSS') + path.extname(filePath)
  const targetPath = path.join(targetDir, fileName)
  fs.copyFileSync(filePath, targetPath)
  return fileName
}

export async function makeAudio({voiceId, text, targetDir}) {
  const uuid = crypto.randomUUID()
  const voice = selectByID(voiceId)

  return makeAudioApi({
    speaker: uuid,
    text,
    format: 'wav',
    topP: 0.7,
    max_new_tokens: 1024,
    chunk_length: 100,
    repetition_penalty: 1.2,
    temperature: 0.7,
    need_asr: false,
    streaming: false,
    is_fixed_seed: 0,
    is_norm: 1,
    reference_audio: voice.asr_format_audio_url,
    reference_text: voice.reference_audio_text
  })
    .then((res) => {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, {
          recursive: true
        })
      }
      fs.writeFileSync(path.join(targetDir, `${uuid}.wav`), res, 'binary')
      return `${uuid}.wav`
    })
    .catch((error) => {
      log.error('Error generating audio:', error)
      throw error
    })
}

/**
 * 试听音频
 * @param {string} voiceId
 * @param {string} text
 * @returns
 */
export async function audition(voiceId, text) {
  const tmpDir = require('os').tmpdir()
  console.log("🚀 ~ audition ~ tmpDir:", tmpDir)
  const audioPath = await makeAudio({ voiceId, text, targetDir: tmpDir })
  return path.join(tmpDir, audioPath)
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/audition', (event, ...args) => {
    return audition(...args)
  })
}