import { ipcMain } from 'electron'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { isEmpty } from 'lodash'
import { assetPath } from '../config/config.js'
import { selectPage,selectByStatus, updateStatus, remove as deleteVideo, findFirstByStatus } from '../dao/video.js'
import { selectByID as selectF2FModelByID } from '../dao/f2f-model.js'
import { selectByID as selectVoiceByID } from '../dao/voice.js'
import {
  insert as insertVideo,
  count,
  update,
  selectByID as selectVideoByID
} from '../dao/video.js'
import { makeAudio4Video, copyAudio4Video } from './voice.js'
import { makeVideo as makeVideoApi,getVideoStatus } from '../api/f2f.js'
import log from '../logger.js'
import { getVideoDuration } from '../util/ffmpeg.js'

const MODEL_NAME = 'video'

/**
 * 分页查询合成结果
 * @param {number} page
 * @param {number} pageSize
 * @returns
 */
async function page({ page, pageSize, name = '' }) {
  // 查询的有waiting状态的视频
  const waitingVideos = selectByStatus('waiting').map((v) => v.id)
  const total = count(name)
  const rows = selectPage({ page, pageSize, name })
  const list = await Promise.all(
    rows.map(async (video) => {
      if (video.status === 'success') {
        video = await ensureSuccessVideoMeta(video)
      } else {
        const rel = toRelativeVideoPath(video.file_path, resolveTaskCode(video))
        video = {
          ...video,
          file_path: rel ? path.join(assetPath.model, rel) : video.file_path
        }
      }

      if (video.status === 'waiting') {
        video.progress = `${waitingVideos.indexOf(video.id) + 1} / ${waitingVideos.length}`
      }
      return video
    })
  )

  return {
    total,
    list
  }
}

async function findVideo(videoId) {
  let video = selectVideoByID(videoId)
  if (video?.status === 'success') {
    video = await ensureSuccessVideoMeta(video)
    return video
  }
  const rel = toRelativeVideoPath(video.file_path, resolveTaskCode(video))
  return {
    ...video,
    file_path: rel ? path.join(assetPath.model, rel) : video.file_path
  }
}

function countVideo(name = '') {
  return count(name)
}

function saveVideo({ id, model_id, name, text_content, voice_id, audio_path }) {
  const video = selectVideoByID(id)
  if(audio_path){
    audio_path = copyAudio4Video(audio_path)
  }

  if (video) {
    return update({ id, model_id, name, text_content, voice_id, audio_path })
  }
  return insertVideo({ model_id, name, status: 'draft', text_content, voice_id, audio_path })
}

/**
 * 合成视频
 * 更新视频状态为waiting
 * @param {number} videoId
 * @returns
 */
function makeVideo(videoId) {
  update({ id: videoId, status: 'waiting' })
  return videoId
}

export async function synthesisVideo(videoId) {
  try{
    update({
      id: videoId,
      file_path: null,
      status: 'pending',
      message: '正在提交任务',
    })

    // 查询Video
    const video = selectVideoByID(videoId)
    log.debug('~ makeVideo ~ video:', video)

    // 根据modelId获取model信息
    const model = selectF2FModelByID(video.model_id)
    log.debug('~ makeVideo ~ model:', model)

    let audioPath
    if(video.audio_path){
      // 将audio_path复制到ttsProduct目录下
      audioPath = video.audio_path
    }else{
      // 根据model信息中的voiceId获取voice信息
      const voice = selectVoiceByID(video.voice_id || model.voice_id)
      log.debug('~ makeVideo ~ voice:', voice)

      // 调用tts接口生成音频
      audioPath = await makeAudio4Video({
        voiceId: voice.id,
        text: video.text_content
      })
      log.debug('~ makeVideo ~ audioPath:', audioPath)
    }

    // 调用视频生成接口（audio/video 为 face2face/temp 下的文件名，由 proxy 同步到 GPU 机）
    log.info('提交合成:', { audioPath, videoPath: model.video_path })
    const { result, param } = await makeVideoByF2F(audioPath, model.video_path)

    log.debug('~ makeVideo ~ result, param:', result, param)

    // 插入视频表
    if(10000 === result.code){ // 成功
      update({
        id: videoId,
        file_path: null,
        status: 'pending',
        message: result,
        audio_path: audioPath,
        param,
        code: param.code
      })
    }else{ // 失败
      update({
        id: videoId,
        file_path: null,
        status: 'failed',
        message: result.msg,
        audio_path: audioPath,
        param,
        code: param.code
      })
    }
  } catch (error) {
    log.error('~ synthesisVideo ~ error:', error.message)
    updateStatus(videoId, 'failed', error.message)
  }

  // 6. 返回视频id
  return videoId
}

/** 从 video 记录或 param JSON 解析 face2face 任务 code */
function resolveTaskCode(video) {
  if (video?.code) {
    return video.code
  }
  if (!video?.param) {
    return null
  }
  try {
    const param = typeof video.param === 'string' ? JSON.parse(video.param) : video.param
    return param?.code || null
  } catch {
    return null
  }
}

/** 将 DB / API 中的路径统一为 temp 目录下的相对文件名 */
function toRelativeVideoPath(filePath, taskCode) {
  if (!filePath) {
    return taskCode ? `${taskCode}-r.mp4` : null
  }
  let rel = String(filePath).replace(/\\/g, '/')
  if (rel.startsWith('/code/data/')) {
    rel = rel.slice('/code/data/'.length)
  }
  if (path.isAbsolute(rel)) {
    rel = path.basename(rel)
  }
  rel = rel.replace(/^\/+/, '')
  if (!rel || !/\.(mp4|avi|mov)$/i.test(rel)) {
    return taskCode ? `${taskCode}-r.mp4` : rel
  }
  return rel
}

/** 将服务端 result 路径转为本地 temp 下的相对路径 */
function normalizeResultRelPath(result, taskCode) {
  return toRelativeVideoPath(result, taskCode)
}

/** 解析 success 视频在本地 temp 下的绝对路径（兼容错误的前导 /） */
function resolveLocalVideoFullPath(video) {
  const code = resolveTaskCode(video)
  const candidates = [
    toRelativeVideoPath(video?.file_path, code),
    code ? `${code}-r.mp4` : null,
    code ? `${code}-r.avi` : null
  ].filter(Boolean)
  for (const rel of [...new Set(candidates)]) {
    const full = path.join(assetPath.model, rel)
    if (fs.existsSync(full)) {
      return { full, rel }
    }
  }
  const rel = toRelativeVideoPath(video?.file_path, code)
  return rel ? { full: path.join(assetPath.model, rel), rel } : { full: null, rel: null }
}

/** 列表/详情展示前修复错误的 file_path、duration */
async function ensureSuccessVideoMeta(video) {
  if (video.status !== 'success') {
    return video
  }
  const { full, rel } = resolveLocalVideoFullPath(video)
  if (!full || !rel || !fs.existsSync(full)) {
    return { ...video, file_path: full || video.file_path }
  }
  let duration = Number(video.duration) || 0
  if (!duration) {
    try {
      duration = await getVideoDuration(full)
    } catch (err) {
      log.warn('~ ensureSuccessVideoMeta ~ getVideoDuration:', err.message)
    }
  }
  const storedRel = toRelativeVideoPath(video.file_path, resolveTaskCode(video))
  if (storedRel !== rel || (duration && !Number(video.duration))) {
    update({ id: video.id, file_path: rel, duration })
  }
  return { ...video, file_path: full, duration }
}

/** proxy 下载或 gen-video 产物的常见文件名 */
function localResultCandidates(video, remoteResult) {
  const code = resolveTaskCode(video)
  if (!code) {
    return []
  }
  const list = [
    `${code}-r.mp4`,
    `${code}-r.avi`,
    path.join('temp', code, 'result.avi'),
    path.join(code, 'result.avi')
  ]
  if (remoteResult) {
    const rel = normalizeResultRelPath(remoteResult, code)
    if (rel) {
      list.unshift(rel)
    }
  }
  return [...new Set(list)]
}

/** 若结果文件已在本地 temp，标记为 success（Mac+proxy 场景常见） */
async function tryMarkVideoSuccess(video, message = '视频处理完成', remoteResult) {
  for (const rel of localResultCandidates(video, remoteResult)) {
    const full = path.join(assetPath.model, rel)
    if (!fs.existsSync(full)) {
      continue
    }
    let duration = 0
    try {
      duration = await getVideoDuration(full)
    } catch (err) {
      log.warn('~ tryMarkVideoSuccess ~ getVideoDuration:', err.message)
    }
    update({
      id: video.id,
      status: 'success',
      message,
      progress: 100,
      file_path: rel,
      duration
    })
    log.info('合成完成(本地结果):', rel)
    return true
  }
  return false
}

export async function loopPending() {
  let finishedPending = false
  try {
    const video = findFirstByStatus('pending')
    if (!video) {
      synthesisNext()
      return
    }

    const taskCode = resolveTaskCode(video)
    if (!taskCode) {
      log.warn('~ loopPending ~ pending 任务尚无 code，稍后重试 id=', video.id)
      return
    }
    const task = { ...video, code: taskCode }

    if (await tryMarkVideoSuccess(task)) {
      finishedPending = true
      return
    }

    const statusRes = await getVideoStatus(taskCode)

    if ([9999, 10002, 10003].includes(statusRes.code)) {
      updateStatus(video.id, 'failed', statusRes.msg)
      finishedPending = true
    } else if (statusRes.code === 10004) {
      if (await tryMarkVideoSuccess(task, '视频处理完成')) {
        finishedPending = true
      } else {
        log.warn('~ loopPending ~ 任务不存在且本地无结果文件:', taskCode)
      }
    } else if (statusRes.code === 10000) {
      const data = statusRes.data || {}
      if (data.status === 1) {
        if (data.progress >= 100 && data.result) {
          if (await tryMarkVideoSuccess(task, data.msg || '视频处理完成', data.result)) {
            finishedPending = true
            return
          }
        }
        updateStatus(video.id, 'pending', data.msg, data.progress ?? 0)
      } else if (data.status === 2) {
        if (await tryMarkVideoSuccess(task, data.msg || '视频处理完成', data.result)) {
          finishedPending = true
          return
        }
        const rel = normalizeResultRelPath(data.result, taskCode)
        const full = rel ? path.join(assetPath.model, rel) : null
        if (full && fs.existsSync(full)) {
          let duration = 0
          try {
            duration = await getVideoDuration(full)
          } catch (err) {
            log.warn('~ loopPending ~ getVideoDuration:', err.message)
          }
          update({
            id: video.id,
            status: 'success',
            message: data.msg,
            progress: data.progress,
            file_path: rel,
            duration
          })
          finishedPending = true
        } else {
          log.warn('~ loopPending ~ status=2 本地尚无结果文件，继续轮询:', taskCode)
        }
      } else if (data.status === 3) {
        updateStatus(video.id, 'failed', data.msg)
        finishedPending = true
      }
    }
  } catch (err) {
    log.error('~ loopPending ~', err.message, err.stack)
  } finally {
    if (finishedPending) {
      synthesisNext()
    }
    setTimeout(() => {
      loopPending()
    }, 2000)
  }
}

/**
 * 合成下一个视频
 */
function synthesisNext() {
  // 查询所有未完成的视频任务
  const video = findFirstByStatus('waiting')
  if (video) {
    synthesisVideo(video.id)
  }
}

function removeVideo(videoId) {
  // 查询视频
  const video = selectVideoByID(videoId)
  log.debug('~ removeVideo ~ videoId:', videoId)

  // 删除视频
  const videoRel = toRelativeVideoPath(video.file_path, resolveTaskCode(video))
  const videoPath = videoRel ? path.join(assetPath.model, videoRel) : ''
  if (!isEmpty(videoRel) && fs.existsSync(videoPath)) {
    fs.unlinkSync(videoPath)
  }

  // 删除音频
  const audioPath = path.join(assetPath.model, video.audio_path || '')
  if (!isEmpty(video.audio_path) && fs.existsSync(audioPath)) {
    fs.unlinkSync(audioPath)
  }

  // 删除视频表
  return deleteVideo(videoId)
}

function exportVideo(videoId, outputPath) {
  const video = selectVideoByID(videoId)
  const { full } = resolveLocalVideoFullPath(video)
  if (!full || !fs.existsSync(full)) {
    throw new Error('视频文件不存在')
  }
  fs.copyFileSync(full, outputPath)
}

/**
 * 调用face2face生成视频
 * @param {string} audioPath
 * @param {string} videoPath
 * @returns
 */
async function makeVideoByF2F(audioPath, videoPath) {
  const uuid = crypto.randomUUID()
  const param = {
    audio_url: audioPath,
    video_url: videoPath,
    code: uuid,
    chaofen: 0,
    watermark_switch: 0,
    pn: 1
  }
  const result = await makeVideoApi(param)
  return { param, result }
}

function modify(video) {
  return update(video)
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/page', (event, ...args) => {
    return page(...args)
  })
  ipcMain.handle(MODEL_NAME + '/make', (event, ...args) => {
    return makeVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/modify', (event, ...args) => {
    return modify(...args)
  })
  ipcMain.handle(MODEL_NAME + '/save', (event, ...args) => {
    return saveVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/find', (event, ...args) => {
    return findVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/count', (event, ...args) => {
    return countVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/export', (event, ...args) => {
    return exportVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/remove', (event, ...args) => {
    return removeVideo(...args)
  })
}
