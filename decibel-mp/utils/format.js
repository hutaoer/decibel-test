/**
 * 格式化与业务口径
 * 噪声等级参考 GB 3096-2008；暴露剂量参考 NIOSH 85 dBA/8h、3dB 交换率。
 * 均为科普参考，非计量结果与医疗建议。
 */

/** 噪声等级（区间为产品简化口径，非标准限值本身） */
function levelOf(db) {
  if (db == null || isNaN(db)) return { key: 'unknown', label: '—', color: '#888780', desc: '暂无数据' }
  if (db < 45) return { key: 'quiet', label: '安静', color: '#1d9e75', desc: '适合休息与专注' }
  if (db < 55) return { key: 'comfy', label: '舒适', color: '#639922', desc: '接近居住区昼间水平' }
  if (db < 70) return { key: 'noisy', label: '偏吵', color: '#ef9f27', desc: '可能影响通话与专注' }
  if (db < 85) return { key: 'loud', label: '吵闹', color: '#d85a30', desc: '长时间停留建议防护' }
  return { key: 'danger', label: '危险', color: '#e24b4a', desc: '接近职业暴露限值' }
}

/** NIOSH 允许暴露时间（小时）：T = 8 * 2^(-(L-85)/3) */
function allowHours(db) {
  if (db == null || isNaN(db)) return null
  return 8 * Math.pow(2, -(db - 85) / 3)
}

/** 噪声剂量百分比：实际暴露时长 / 允许时长 */
function dosePercent(db, durationMs) {
  if (db == null || !durationMs) return 0
  const hours = allowHours(db)
  if (!hours) return 0
  return (durationMs / 3600000 / hours) * 100
}

/** 毫秒 -> mm:ss / h:mm:ss */
function formatDuration(ms) {
  if (!ms && ms !== 0) return '--:--'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 时间戳 -> YYYY-MM-DD HH:mm */
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 数值展示：保留 1 位小数；空值回落 */
function formatDb(db, fallback) {
  if (db == null || isNaN(db)) return fallback != null ? fallback : '--'
  return db.toFixed(1)
}

/** 生成记录 id */
function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

module.exports = {
  levelOf,
  allowHours,
  dosePercent,
  formatDuration,
  formatTime,
  formatDb,
  genId
}
