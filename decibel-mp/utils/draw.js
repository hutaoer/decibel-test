/**
 * Canvas 2D 绘制工具
 * 仪表盘 / 实时波形 / 历史曲线
 * 注意：Canvas 2D 需按 dpr 放大画布再 ctx.scale(dpr, dpr)，否则模糊。
 */

const LEVEL_SEGMENTS = [
  { from: 30, to: 55, color: '#639922' },
  { from: 55, to: 70, color: '#ef9f27' },
  { from: 70, to: 110, color: '#e24b4a' }
]

/** 初始化 Canvas 2D 节点 */
function initCanvas(page, id) {
  return new Promise((resolve, reject) => {
    const query = wx.createSelectorQuery()
    if (page) query.in(page)
    query
      .select(`#${id}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0]
        if (!item || !item.node) {
          reject(new Error(`canvas #${id} 未找到`))
          return
        }
        const canvas = item.node
        const ctx = canvas.getContext('2d')
        const { getPixelRatio } = require('./system')
        const dpr = getPixelRatio()
        canvas.width = item.width * dpr
        canvas.height = item.height * dpr
        ctx.scale(dpr, dpr)
        resolve({ canvas, ctx, width: item.width, height: item.height })
      })
  })
}

function _clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

/**
 * 半环形仪表盘
 * @param {Object} o { ctx, width, height, value, rangeMin, rangeMax }
 */
function drawGauge(o) {
  const { ctx, width, height, value } = o
  const rangeMin = o.rangeMin != null ? o.rangeMin : 30
  const rangeMax = o.rangeMax != null ? o.rangeMax : 110
  ctx.clearRect(0, 0, width, height)

  const cx = width / 2
  const cy = height * 0.94
  const radius = Math.min(width / 2 - 6, height * 0.9)
  const lineWidth = Math.max(10, radius * 0.16)

  // db -> canvas 角度：左端 π，顶部 3π/2，右端 2π
  const toAngle = (db) => {
    const t = _clamp((db - rangeMin) / (rangeMax - rangeMin), 0, 1)
    return Math.PI * (1 + t)
  }

  ctx.lineCap = 'butt'

  // 底弧
  ctx.beginPath()
  ctx.strokeStyle = '#edebe4'
  ctx.lineWidth = lineWidth
  ctx.arc(cx, cy, radius, Math.PI, Math.PI * 2)
  ctx.stroke()

  // 分段彩弧
  LEVEL_SEGMENTS.forEach((seg) => {
    const start = toAngle(Math.max(seg.from, rangeMin))
    const end = toAngle(Math.min(seg.to, rangeMax))
    if (end <= start) return
    ctx.beginPath()
    ctx.strokeStyle = seg.color
    ctx.lineWidth = lineWidth
    ctx.arc(cx, cy, radius, start, end)
    ctx.stroke()
  })

  // 刻度端点文字
  ctx.fillStyle = '#888780'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(String(rangeMin), cx - radius - 2, cy + 14)
  ctx.textAlign = 'right'
  ctx.fillText(String(rangeMax), cx + radius + 2, cy + 14)

  // 指针
  if (value != null && !isNaN(value)) {
    const angle = toAngle(value)
    const inner = radius * 0.24
    const outer = radius * 0.92
    const x1 = cx + Math.cos(angle) * inner
    const y1 = cy + Math.sin(angle) * inner
    const x2 = cx + Math.cos(angle) * outer
    const y2 = cy + Math.sin(angle) * outer
    ctx.beginPath()
    ctx.strokeStyle = '#2c2c2a'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()

    ctx.beginPath()
    ctx.fillStyle = '#2c2c2a'
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * 实时柱状波形
 * @param {Object} o { ctx, width, height, points, rangeMin, rangeMax }
 */
function drawWave(o) {
  const { ctx, width, height, points } = o
  const rangeMin = o.rangeMin != null ? o.rangeMin : 30
  const rangeMax = o.rangeMax != null ? o.rangeMax : 110
  ctx.clearRect(0, 0, width, height)

  const total = 60
  const gap = 2
  const barWidth = Math.max(2, (width - gap * (total - 1)) / total)
  const list = points || []

  for (let i = 0; i < total; i++) {
    const db = list[i]
    const x = i * (barWidth + gap)
    if (db == null) {
      // 无数据画底槽
      ctx.fillStyle = '#f1efe8'
      ctx.fillRect(x, height - 4, barWidth, 4)
      continue
    }
    const t = _clamp((db - rangeMin) / (rangeMax - rangeMin), 0.04, 1)
    const barHeight = Math.max(4, height * t)
    ctx.fillStyle = '#85b7eb'
    ctx.fillRect(x, height - barHeight, barWidth, barHeight)
  }
}

/**
 * 历史曲线（记录详情）
 * @param {Object} o { ctx, width, height, series, threshold, rangeMin, rangeMax }
 */
function drawSeries(o) {
  const { ctx, width, height, series } = o
  const rangeMin = o.rangeMin != null ? o.rangeMin : 30
  const rangeMax = o.rangeMax != null ? o.rangeMax : 110
  const threshold = o.threshold != null ? o.threshold : 85
  ctx.clearRect(0, 0, width, height)

  const padding = { top: 12, right: 8, bottom: 20, left: 30 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom
  const list = (series || []).filter((p) => p && p.db != null)

  const toY = (db) => {
    const t = _clamp((db - rangeMin) / (rangeMax - rangeMin), 0, 1)
    return padding.top + chartH * (1 - t)
  }

  // 网格与刻度
  ctx.strokeStyle = '#edebe4'
  ctx.fillStyle = '#888780'
  ctx.font = '10px sans-serif'
  ctx.lineWidth = 1
  const ticks = [rangeMin, 55, 70, rangeMax]
  ticks.forEach((db) => {
    const y = toY(db)
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(width - padding.right, y)
    ctx.stroke()
    ctx.textAlign = 'right'
    ctx.fillText(String(db), padding.left - 4, y + 3)
  })

  // 阈值线
  if (threshold > rangeMin && threshold < rangeMax) {
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = '#e24b4a'
    ctx.beginPath()
    ctx.moveTo(padding.left, toY(threshold))
    ctx.lineTo(width - padding.right, toY(threshold))
    ctx.stroke()
    ctx.restore()
  }

  if (!list.length) {
    ctx.fillStyle = '#888780'
    ctx.textAlign = 'center'
    ctx.fillText('暂无曲线数据', width / 2, height / 2)
    return
  }

  const maxT = list[list.length - 1].t || 1
  const toX = (t) => padding.left + (chartW * t) / maxT

  ctx.beginPath()
  ctx.strokeStyle = '#185fa5'
  ctx.lineWidth = 2
  list.forEach((p, i) => {
    const x = toX(p.t)
    const y = toY(p.db)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // 单点兜底：画一个圆点，避免只有一点时看不见
  if (list.length === 1) {
    ctx.beginPath()
    ctx.fillStyle = '#185fa5'
    ctx.arc(toX(list[0].t), toY(list[0].db), 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

module.exports = {
  initCanvas,
  drawGauge,
  drawWave,
  drawSeries
}
