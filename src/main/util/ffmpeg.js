import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import log from '../logger.js'

function resolveBinary(name, pathMap) {
  const key = `${process.env.NODE_ENV}-${process.platform}`
  const bundled = pathMap[key]
  if (bundled && fs.existsSync(bundled)) {
    return bundled
  }
  if (process.platform === 'darwin') {
    const candidates = [
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    try {
      const found = execSync(`which ${name}`, { encoding: 'utf8' }).trim()
      if (found && fs.existsSync(found)) {
        return found
      }
    } catch {
      // PATH 中未找到
    }
  }
  return bundled
}

function initFFmpeg() {
  const ffmpegPath = {
    'development-win32': path.join(__dirname, '../../resources/ffmpeg/win-amd64/bin/ffmpeg.exe'),
    'development-linux': path.join(__dirname, '../../resources/ffmpeg/linux-amd64/ffmpeg'),
    'production-win32': path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'resources',
      'ffmpeg',
      'win-amd64',
      'bin',
      'ffmpeg.exe'
    ),
    'production-linux': path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'resources',
      'ffmpeg',
      'linux-amd64',
      'ffmpeg'
    )
  }

  if(process.env.NODE_ENV === undefined){
    process.env.NODE_ENV = 'production'
  }

  const envKey = `${process.env.NODE_ENV}-${process.platform}`
  const ffmpegPathValue = resolveBinary('ffmpeg', ffmpegPath)
  log.debug('ENV:', envKey)
  log.info('FFmpeg path:', ffmpegPathValue)
  if (ffmpegPathValue) {
    ffmpeg.setFfmpegPath(ffmpegPathValue)
  }

  const ffprobePath = {
    'development-win32': path.join(__dirname, '../../resources/ffmpeg/win-amd64/bin/ffprobe.exe'),
    'development-linux': path.join(__dirname, '../../resources/ffmpeg/linux-amd64/ffprobe'),
    'production-win32': path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'resources',
      'ffmpeg',
      'win-amd64',
      'bin',
      'ffprobe.exe'
    ),
    'production-linux': path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'resources',
      'ffmpeg',
      'linux-amd64',
      'ffprobe'
    )
  }

  const ffprobePathValue = resolveBinary('ffprobe', ffprobePath)
  log.info('FFprobe path:', ffprobePathValue)
  if (ffprobePathValue) {
    ffmpeg.setFfprobePath(ffprobePathValue)
  } else {
    log.warn('FFprobe not configured for', envKey, '- install ffmpeg or add resources/ffmpeg/darwin')
  }
}

initFFmpeg()

export function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .save(audioPath)
      .on('end', () => {
        log.info('audio split done')
        resolve(true)
      })
      .on('error', (err) => {
        reject(err)
      })
  })
}

export async function toH264(videoPath, outputPath) {
  // const hasNvidia = await detectNvidia()
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .videoCodec('libx264')
      .outputOptions('-pix_fmt yuv420p')
      .save(outputPath)
      .on('end', () => {
        log.info('video convert to h264 done')
        resolve(true)
      })
      .on('error', (err) => {
        reject(err)
      })
  })
}

function detectNvidia() {
  return new Promise((resolve) => {
    const exec = require('child_process').exec;
    exec('nvidia-smi', (error, stdout, stderr) => {
      if (error || stderr) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath).ffprobe((err, data) => {
      if (err) {
        log.error('~ getVideoDuration ~', err)
        reject(err)
        return
      }
      const formatDur = parseFloat(data?.format?.duration)
      if (formatDur > 0) {
        resolve(formatDur)
        return
      }
      const videoStream = data?.streams?.find((s) => s.codec_type === 'video')
      const streamDur = parseFloat(videoStream?.duration ?? data?.streams?.[0]?.duration)
      if (streamDur > 0) {
        resolve(streamDur)
        return
      }
      log.error('~ getVideoDuration ~ no duration:', videoPath)
      reject(new Error('No duration found'))
    })
  })
}
