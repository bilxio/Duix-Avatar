import { connect } from '../db/index.js'

export function selectPage({ page, pageSize, name = '' }) {
  const db = connect()
  const offset = (page - 1) * pageSize
  const rows = db
    .prepare(
      `SELECT *
      FROM video
      WHERE name like '%${name}%'
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}; `
    )
    .all({ silent: true })
  return rows
}

export function count(name = '') {
  const db = connect()
  const rows = db.prepare(`SELECT COUNT(*) as total FROM video WHERE name like '%${name}%'`).get({ silent: true })
  return rows.total
}

/**
 * 新增视频
 * @param {string} name 视频名称
 * @param {string} file_path 视频路径
 * @param {string} status 视频状态
 * @param {string} message 视频消息
 * @param {number} model_id 模特id
 * @param {string} audio_path 音频路径
 * @param {object} param 视频参数
 * @param {string} code 视频code
 * @param {string} text_content 视频文本内容
 * @param {number} voice_id 语音id
 * @returns
 */
export function insert(video) {
  const db = connect()
  const columns = Object.keys(video)
  const stmt = db.prepare(
    `insert into video (${columns.join(',')}, created_at)
     values (${columns.map(() => '?').join(',')}, ?)`
  )
  const info = stmt.run(
    ...Object.values(video).map((value) =>
      typeof value === 'object' && value !== null ? JSON.stringify(value) : value,
    ),
    Date.now()
  )
  return info.lastInsertRowid
}

export function remove(id) {
  const db = connect()
  db.prepare(`DELETE FROM video WHERE id = ?`).run(id)
}

export function update(video) {
  const sets = Object.keys(video)
    .map((key) => `${key} = ?`)
    .join(',')
  const db = connect()
  const info = db
    .prepare(`UPDATE video SET ${sets} WHERE id = ?`)
    .run(
      ...Object.values(video).map((value) =>
        typeof value === 'object' && value !== null ? JSON.stringify(value) : value
      ),
      video.id
    )
  return info
}

export function selectByStatus(status) {
  const db = connect()
  const rows = db.prepare(`SELECT * FROM video WHERE status = ?`).all(status, { silent: true })
  return rows
}

export function findFirstByStatus(status) {
  const db = connect()
  const withCode = db
    .prepare(
      `SELECT * FROM video WHERE status = ? AND code IS NOT NULL AND code != '' ORDER BY id ASC LIMIT 1`
    )
    .get(status, { silent: true })
  if (withCode) {
    return withCode
  }
  return db
    .prepare(`SELECT * FROM video WHERE status = ? ORDER BY id ASC LIMIT 1`)
    .get(status, { silent: true })
}

export function updateStatus(id, status, message, progress = 0, file_path = '') {
  const db = connect()
  db.prepare(
    `UPDATE video SET status = ?, message = ?, progress = ?, file_path = ? WHERE id = ?`
  ).run(status, message, progress, file_path, id)
}

export function selectByID(id) {
  const db = connect()
  const row = db.prepare(`SELECT * FROM video WHERE id = ?`).get(id)
  return row
}

export function selectByModelId(modelId) {
  const db = connect()
  return db.prepare(`SELECT * FROM video WHERE model_id = ? ORDER BY id ASC`).all(modelId, { silent: true })
}

export function countByModelId(modelId) {
  const db = connect()
  const row = db.prepare(`SELECT COUNT(*) as total FROM video WHERE model_id = ?`).get(modelId, { silent: true })
  return row.total
}

export function countByModelIdAndStatuses(modelId, statuses) {
  const db = connect()
  const placeholders = statuses.map(() => '?').join(',')
  const row = db
    .prepare(`SELECT COUNT(*) as total FROM video WHERE model_id = ? AND status IN (${placeholders})`)
    .get(modelId, ...statuses, { silent: true })
  return row.total
}

export function countByVoiceId(voiceId) {
  const db = connect()
  const row = db.prepare(`SELECT COUNT(*) as total FROM video WHERE voice_id = ?`).get(voiceId, { silent: true })
  return row.total
}
