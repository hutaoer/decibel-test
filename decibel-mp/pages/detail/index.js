const { getRecord, updateRecord, deleteRecord, getSettings } = require('../../utils/storage')
const { initCanvas, drawSeries } = require('../../utils/draw')
const { formatTime, formatDuration, formatDb, levelOf, dosePercent } = require('../../utils/format')

const TAGS = ['居家', '办公', '街道', '施工', '娱乐', '交通', '其他']

Page({
  data: {
    record: null,
    leqText: '--',
    lmaxText: '--',
    lminText: '--',
    durationText: '--',
    timeText: '',
    levelLabel: '',
    levelColor: '#888780',
    doseText: '0',
    clippedText: '',
    peaksText: '0'
  },

  onLoad(options) {
    this.id = options && options.id
    this.settings = getSettings()
    this.loadRecord()
  },

  onReady() {
    initCanvas(this, 'chart')
      .then((chart) => {
        this.chartCtx = chart
        this.renderChart()
      })
      .catch((err) => {
        console.error('[detail] canvas 初始化失败', err)
      })
  },

  loadRecord() {
    const rec = this.id ? getRecord(this.id) : null
    if (!rec) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    const level = levelOf(rec.leq)
    const dose = dosePercent(rec.leq, rec.durationMs)
    this.record = rec
    this.setData({
      record: rec,
      leqText: formatDb(rec.leq, '--'),
      lmaxText: formatDb(rec.lmax, '--'),
      lminText: formatDb(rec.lmin, '--'),
      durationText: formatDuration(rec.durationMs),
      timeText: formatTime(rec.startTime),
      levelLabel: level.label,
      levelColor: level.color,
      doseText: dose.toFixed(0),
      clippedText: rec.clipped ? '部分时段超量程，平均值可能偏低' : '',
      peaksText: String((rec.peaks || []).length)
    })
  },

  renderChart() {
    if (!this.chartCtx || !this.record) return
    const s = this.settings
    drawSeries({
      ctx: this.chartCtx.ctx,
      width: this.chartCtx.width,
      height: this.chartCtx.height,
      series: this.record.series,
      threshold: s.peakThreshold,
      rangeMin: s.rangeMin,
      rangeMax: s.rangeMax
    })
  },

  onEditTag() {
    wx.showActionSheet({
      itemList: TAGS,
      success: (res) => {
        const tag = TAGS[res.tapIndex]
        if (!tag || !this.record) return
        this.record.tag = tag
        updateRecord(this.record)
        this.setData({ 'record.tag': tag })
        wx.showToast({ title: '已更新', icon: 'success' })
      },
      fail: () => {}
    })
  },

  onShareTap() {
    // 海报生成依赖 Canvas 导出与相册权限，下一轮实现（见项目档案待办）
    wx.showToast({ title: '海报分享下一轮实现', icon: 'none' })
  },

  onDelete() {
    wx.showModal({
      title: '删除记录',
      content: '删除后不可恢复，确认删除？',
      success: (res) => {
        if (!res.confirm) return
        deleteRecord(this.id)
        wx.navigateBack()
      }
    })
  },

  onShareAppMessage() {
    // 本地数据对方不可见，故 path 指向首页，标题如实描述
    return {
      title: `我刚测了：平均 ${this.data.leqText} dB`,
      path: '/pages/index/index'
    }
  }
})
