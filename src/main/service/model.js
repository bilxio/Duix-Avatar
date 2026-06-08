import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import dayjs from 'dayjs'
import { isEmpty } from 'lodash'
import {
  insert,
  selectPage,
  count,
  selectByID,
  remove as deleteModelRow,
  countByVoiceId as countModelsByVoiceId
} from '../dao/f2f-model.js'
import {
  selectByModelId,
  countByModelId,
  countByModelIdAndStatuses,
  countByVoiceId as countVideosByVoiceId
} from '../dao/video.js'
import { selectByID as selectVoiceByID, remove as deleteVoiceRow } from '../dao/voice.js'
import { train as trainVoice } from './voice.js'
import { removeVideoById } from './video.js'
import { assetPath } from '../config/config.js'
import { cleanupRemoteModelArtifacts } from '../api/proxy-cleanup.js'
import log from '../logger.js'
import { extractAudio, toH264 } from '../util/ffmpeg.js'
import { connect } from '../db/index.js'

const MODEL_NAME = 'model'

async function addModel(modelName, videoPath) {
  if (!fs.existsSync(assetPath.model)) {
    fs.mkdirSync(assetPath.model, {
      recursive: true
    })
  }
  const extname = path.extname(videoPath)
  const modelFileName = dayjs().format('YYYYMMDDHHmmssSSS') + extname
  const modelPath = path.join(assetPath.model, modelFileName)

  await toH264(videoPath, modelPath)

  if (!fs.existsSync(assetPath.ttsTrain)) {
    fs.mkdirSync(assetPath.ttsTrain, {
      recursive: true
    })
  }
  const audioPath = path.join(assetPath.ttsTrain, modelFileName.replace(extname, '.wav'))
  return extractAudio(modelPath, audioPath).then(async () => {
    const relativeAudioPath = path.relative(assetPath.ttsRoot, audioPath)
    if (!fs.existsSync(audioPath)) {
      throw new Error(`训练音频未生成: ${audioPath}`)
    }
    log.info('训练音频(本地):', audioPath, '→ TTS reference_audio:', relativeAudioPath)
    const voiceId = await trainVoice(relativeAudioPath, 'zh')
    const relativeModelPath = path.relative(assetPath.model, modelPath)
    return insert({
      modelName,
      videoPath: relativeModelPath,
      audioPath: relativeAudioPath,
      voiceId
    })
  })
}

function page({ page, pageSize, name = '' }) {
  const total = count(name)
  return {
    total,
    list: selectPage({ page, pageSize, name }).map((model) => ({
      ...model,
      video_path: path.join(assetPath.model, model.video_path),
      audio_path: path.join(assetPath.ttsRoot, model.audio_path)
    }))
  }
}

function findModel(modelId) {
  const model = selectByID(modelId)
  return {
    ...model,
    video_path: path.join(assetPath.model, model.video_path),
    audio_path: path.join(assetPath.ttsRoot, model.audio_path)
  }
}

function getRemovePreview(modelId) {
  const model = selectByID(modelId)
  if (!model) {
    throw new Error('模特不存在')
  }
  const videoCount = countByModelId(modelId)
  const pendingCount = countByModelIdAndStatuses(modelId, ['waiting', 'pending'])
  return {
    modelId,
    videoCount,
    pendingCount,
    hasRelatedVideos: videoCount > 0
  }
}

function isVoiceStillReferenced(voiceId, excludingModelId) {
  if (!voiceId) return false
  return countModelsByVoiceId(voiceId, excludingModelId) > 0 || countVideosByVoiceId(voiceId) > 0
}

function unlinkIfExists(filePath, bucket) {
  if (isEmpty(filePath) || !fs.existsSync(filePath)) {
    if (!isEmpty(filePath)) {
      log.warn('~ removeModel ~ file missing:', filePath)
    }
    return
  }
  try {
    fs.unlinkSync(filePath)
    bucket.push(filePath)
    log.info('~ removeModel ~ deleted local:', filePath)
  } catch (error) {
    log.warn('~ removeModel ~ unlink failed:', filePath, error.message)
  }
}

function normalizeVoiceDataRelPath(url) {
  if (!url) return null
  let rel = String(url).replace(/\\/g, '/')
  if (rel.startsWith('/code/data/')) {
    rel = rel.slice('/code/data/'.length)
  }
  rel = rel.replace(/^\/+/, '')
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
    return null
  }
  return rel
}

async function removeModel(modelId) {
  const model = selectByID(modelId)
  if (!model) {
    throw new Error('模特不存在')
  }

  log.debug('~ removeModel ~ modelId:', modelId)

  const relatedVideos = selectByModelId(modelId)
  const deletedVideoIds = []
  const deletedFiles = []

  for (const video of relatedVideos) {
    if (['waiting', 'pending'].includes(video.status)) {
      log.info('~ removeModel ~ 取消关联合成任务 videoId=', video.id, 'status=', video.status)
    }
    await removeVideoById(video.id, { skipModelVideoProtection: true })
    deletedVideoIds.push(video.id)
  }

  const modelVideoPath = path.join(assetPath.model, model.video_path || '')
  const modelAudioPath = path.join(assetPath.ttsRoot, model.audio_path || '')
  unlinkIfExists(modelVideoPath, deletedFiles)
  unlinkIfExists(modelAudioPath, deletedFiles)

  const voiceDataRelPaths = []
  if (model.voice_id) {
    const voice = selectVoiceByID(model.voice_id)
    const asrRel = normalizeVoiceDataRelPath(voice?.asr_format_audio_url)
    if (asrRel) {
      voiceDataRelPaths.push(asrRel)
      const asrLocal = path.join(assetPath.ttsRoot, asrRel)
      unlinkIfExists(asrLocal, deletedFiles)
    }
  }

  try {
    await cleanupRemoteModelArtifacts({
      modelVideoBasename: model.video_path ? path.basename(model.video_path) : undefined,
      originAudioBasename: model.audio_path ? path.basename(model.audio_path) : undefined,
      voiceDataRelPaths
    })
  } catch (error) {
    log.warn('~ removeModel ~ remote cleanup:', error.message)
  }

  const db = connect()
  const finalizeDelete = db.transaction(() => {
    if (model.voice_id && !isVoiceStillReferenced(model.voice_id, modelId)) {
      deleteVoiceRow(model.voice_id)
      log.info('~ removeModel ~ deleted voice:', model.voice_id)
    }
    deleteModelRow(modelId)
  })
  finalizeDelete()

  log.info('~ removeModel ~ done', {
    modelId,
    deletedVideoIds,
    voiceId: model.voice_id,
    deletedFiles
  })
}

function countModel(name = '') {
  return count(name)
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/addModel', (event, ...args) => {
    return addModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/page', (event, ...args) => {
    return page(...args)
  })
  ipcMain.handle(MODEL_NAME + '/find', (event, ...args) => {
    return findModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/count', (event, ...args) => {
    return countModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/removePreview', (event, ...args) => {
    return getRemovePreview(...args)
  })
  ipcMain.handle(MODEL_NAME + '/remove', (event, ...args) => {
    return removeModel(...args)
  })
}
