import { connect } from '../db/index.js'

export function insert({ modelName, videoPath, audioPath, voiceId }) {
  const db = connect()
  const stmt = db.prepare(
    'INSERT INTO f2f_model (name, video_path, audio_path, voice_id, created_at) VALUES (?, ?, ?, ?, ?)'
  )
  const info = stmt.run(
    modelName,
    videoPath,
    audioPath,
    voiceId == null || voiceId === false ? null : voiceId,
    Date.now()
  )
  return info.lastInsertRowid
}

export function selectPage({ page, pageSize, name = '' }) {
  const db = connect()
  const offset = (page - 1) * pageSize
  const rows = db
    .prepare(
      `SELECT * FROM f2f_model WHERE name like '%${name}%' ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`
    )
    .all()
  return rows
}

export function count(name = '') {
  const db = connect()
  const rows = db
    .prepare(`SELECT COUNT(*) as total FROM f2f_model WHERE name like '%${name}%'`)
    .get()
  return rows.total
}

export function selectByID(id) {
  const db = connect()
  const stmt = db.prepare('SELECT * FROM f2f_model WHERE id = ?')
  const row = stmt.get(id)
  return row
}

export function remove(id) {
  const db = connect()
  db.prepare(`DELETE FROM f2f_model WHERE id = ?`).run(id)
}

export function countByVoiceId(voiceId, excludingModelId = null) {
  const db = connect()
  if (excludingModelId != null) {
    const row = db
      .prepare(`SELECT COUNT(*) as total FROM f2f_model WHERE voice_id = ? AND id != ?`)
      .get(voiceId, excludingModelId, { silent: true })
    return row.total
  }
  const row = db.prepare(`SELECT COUNT(*) as total FROM f2f_model WHERE voice_id = ?`).get(voiceId, { silent: true })
  return row.total
}
