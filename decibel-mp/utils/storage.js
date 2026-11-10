/**
 * 本地存储层
 * 硬约束：微信小程序单个 key 上限 1MB、总容量 10MB（以官方文档为准）。
 * 因此采用「索引 + 详情分 key」：索引只放列表需要的轻字段，曲线数据单独存。
 */

const KEY_SETTINGS = 'db_settings_v1'
const KEY_INDEX = 'db_index_v1'
const PREFIX_REC = 'db_rec_'
const MAX_RECORDS = 200
const SCHEMA_VERSION = 1

/**
 * K 的量级说明：K 是 dBFS -> dB SPL 的偏移量，满量程约对应 94 dB SPL，
 * 因此正常范围是 74~114。早期版本误把默认值写成 10，导致读数全为负数；
 * 读取旧数据时按此阈值做一次迁移。
 */
const DEFAULT_K = 94
const LEGACY_K_THRESHOLD = 60

function defaultSettings() {
  return {
    k: DEFAULT_K,
    peakThreshold: 85,
    weighted: 'F',
    rangeMin: 30,
    rangeMax: 110,
    schemaVersion: SCHEMA_VERSION
  }
}

function getSettings() {
  try {
    const s = wx.getStorageSync(KEY_SETTINGS)
    if (!s || typeof s !== 'object') return defaultSettings()
    const merged = Object.assign(defaultSettings(), s)
    // 迁移：老版本 K 为个位数（如 10），不是有效偏移量，重置为默认值
    if (typeof merged.k !== 'number' || merged.k < LEGACY_K_THRESHOLD) {
      merged.k = DEFAULT_K
      wx.setStorageSync(KEY_SETTINGS, merged)
    }
    return merged
  } catch (e) {
    return defaultSettings()
  }
}

function saveSettings(settings) {
  try {
    wx.setStorageSync(KEY_SETTINGS, Object.assign(getSettings(), settings))
    return true
  } catch (e) {
    return false
  }
}

function getIndex() {
  try {
    const list = wx.getStorageSync(KEY_INDEX)
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function getRecord(id) {
  try {
    return wx.getStorageSync(PREFIX_REC + id) || null
  } catch (e) {
    return null
  }
}

/**
 * 保存记录：先写详情，成功后再更新索引，避免「索引有、详情无」的脏数据
 * @returns {{ok: boolean, reason?: string}}
 */
function saveRecord(record) {
  if (getIndex().length >= MAX_RECORDS) {
    return { ok: false, reason: 'full' }
  }
  try {
    wx.setStorageSync(PREFIX_REC + record.id, record)
  } catch (e) {
    return { ok: false, reason: 'storage' }
  }
  try {
    const index = getIndex()
    index.unshift({
      id: record.id,
      startTime: record.startTime,
      durationMs: record.durationMs,
      leq: record.leq,
      tag: record.tag
    })
    wx.setStorageSync(KEY_INDEX, index)
    return { ok: true }
  } catch (e) {
    // 索引写失败则回滚详情
    try {
      wx.removeStorageSync(PREFIX_REC + record.id)
    } catch (e2) {
      /* ignore */
    }
    return { ok: false, reason: 'storage' }
  }
}

function updateRecord(record) {
  try {
    wx.setStorageSync(PREFIX_REC + record.id, record)
    const index = getIndex()
    const hit = index.find((item) => item.id === record.id)
    if (hit) {
      hit.leq = record.leq
      hit.durationMs = record.durationMs
      hit.tag = record.tag
      wx.setStorageSync(KEY_INDEX, index)
    }
    return true
  } catch (e) {
    return false
  }
}

function deleteRecord(id) {
  try {
    wx.removeStorageSync(PREFIX_REC + id)
    const index = getIndex().filter((item) => item.id !== id)
    wx.setStorageSync(KEY_INDEX, index)
    return true
  } catch (e) {
    return false
  }
}

/**
 * 一次性迁移：早期版本 K 误写为 10，历史记录的声级全部偏低 (DEFAULT_K - 10) dB。
 * 这里按记录自身保存的 k 值整体平移，让老数据重新变得可读。
 * 幂等：迁移后记录 k 变为 DEFAULT_K，不会再被处理。
 * @returns {number} 迁移条数
 */
function migrateLegacyRecords() {
  let count = 0
  try {
    const index = getIndex()
    if (!index.length) return 0
    index.forEach((item) => {
      let rec = null
      try {
        rec = wx.getStorageSync(PREFIX_REC + item.id)
      } catch (e) {
        return
      }
      if (!rec || typeof rec.k !== 'number' || rec.k >= LEGACY_K_THRESHOLD) return
      const oldK = rec.k
      const delta = DEFAULT_K - oldK
      if (typeof rec.leq === 'number') rec.leq += delta
      if (typeof rec.lmax === 'number') rec.lmax += delta
      if (typeof rec.lmin === 'number') rec.lmin += delta
      if (Array.isArray(rec.series)) {
        rec.series = rec.series.map((p) => (p && typeof p.db === 'number' ? Object.assign({}, p, { db: p.db + delta }) : p))
      }
      if (Array.isArray(rec.peaks)) {
        rec.peaks = rec.peaks.map((p) => (p && typeof p.value === 'number' ? Object.assign({}, p, { value: p.value + delta }) : p))
      }
      rec.k = DEFAULT_K
      rec.migratedFrom = oldK
      try {
        wx.setStorageSync(PREFIX_REC + rec.id, rec)
        item.leq = rec.leq
        count += 1
      } catch (e) {
        /* 单条失败不影响整体 */
      }
    })
    if (count) wx.setStorageSync(KEY_INDEX, index)
  } catch (e) {
    /* 迁移失败不阻塞启动 */
  }
  return count
}

module.exports = {
  MAX_RECORDS,
  SCHEMA_VERSION,
  DEFAULT_K,
  getSettings,
  saveSettings,
  getIndex,
  getRecord,
  saveRecord,
  updateRecord,
  deleteRecord,
  migrateLegacyRecords
}
