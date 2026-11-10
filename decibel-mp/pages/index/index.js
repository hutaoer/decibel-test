const { DbMeter, K_MIN, K_MAX } = require('../../utils/decibel')
const { initCanvas, drawGauge, drawWave } = require('../../utils/draw')
const { getSettings, saveSettings, saveRecord } = require('../../utils/storage')
const { ensurePrivacy, ensureRecordAuth, openSetting } = require('../../utils/permission')
const { formatDuration, formatDb, levelOf, genId } = require('../../utils/format')
const { gteVersion, getSDKVersion, getDeviceKey } = require('../../utils/system')

const MAX_DURATION = 600000 // 微信录音接口硬上限 10 分钟
const FLUSH_INTERVAL = 100 // 10Hz 刷新

Page({
  data: {
    status: 'idle', // idle | measuring | paused | stopping
    displayText: '--',
    level: { label: '点击开始测量', color: '#888780', desc: '结果仅供参考' },
    stat: { leq: '--', lmax: '--', lmin: '--' },
    durationText: '00:00',
    peaksText: '0',
    permissionDenied: false,
    kText: '94'
  },

  onLoad() {
    this.destroyed = false
    this.timer = null
    this.meter = null
    this.startAt = 0
    this.settings = getSettings()
    this.setData({ kText: String(this.settings.k) })

    this.recorder = wx.getRecorderManager()
    this._bindRecorder()
  },

  onReady() {
    // Canvas 必须在节点渲染完成后初始化
    Promise.all([initCanvas(this, 'gauge'), initCanvas(this, 'wave')])
      .then(([gauge, wave]) => {
        this.gaugeCtx = gauge
        this.waveCtx = wave
        this._render()
      })
      .catch((err) => {
        console.error('[index] canvas 初始化失败', err)
      })
  },

  onUnload() {
    this.destroyed = true
    this._stopTimer()
    this._safeStop()
  },

  onHide() {
    // 切后台：暂停测量，保留已统计数据（后台无法持续采集）
    if (this.data.status === 'measuring') {
      this._pause('小程序进入后台，已暂停测量')
    }
  },

  onShow() {
    // 回到前台不自动继续，由用户主动点击「继续」
  },

  /* ---------- 录音监听 ---------- */

  _bindRecorder() {
    this.recorder.onFrameRecorded((res) => {
      if (this.destroyed || this.data.status !== 'measuring' || !this.meter) return
      if (!res || !res.frameBuffer) return
      this.meter.pushFrame(res.frameBuffer)
    })

    this.recorder.onStop((res) => {
      const filePath = res && res.tempFilePath
      // 隐私红线：不保存音频文件，停止后立即删除临时文件
      if (filePath) {
        try {
          wx.getFileSystemManager().unlink({ filePath })
        } catch (e) {
          /* ignore */
        }
      }
      if (this.destroyed || this.data.status === 'idle') return
      this._finish()
    })

    this.recorder.onError((err) => {
      const msg = (err && err.errMsg) || ''
      this._stopTimer()
      this.setData({ status: 'idle' })
      const friendly = /occupy|busy|占用|denied|权限/.test(msg)
        ? '麦克风被占用或权限不足，请关闭其他录音应用后重试'
        : '录音异常，请重试'
      wx.showModal({ title: '无法测量', content: friendly, showCancel: false })
    })
  },

  /* ---------- 测量控制 ---------- */

  async onStart() {
    if (this.data.status !== 'idle') return

    const privacyOk = await ensurePrivacy()
    if (!privacyOk) {
      wx.showToast({ title: '需先同意隐私协议', icon: 'none' })
      return
    }

    const auth = await ensureRecordAuth()
    if (auth === 'denied') {
      this.setData({ permissionDenied: true })
      return
    }
    if (auth === 'error') {
      wx.showToast({ title: '授权失败，请稍后重试', icon: 'none' })
      return
    }

    this._begin()
  },

  _begin() {
    const s = this.settings
    this.meter = new DbMeter({
      k: s.k,
      tau: s.weighted === 'S' ? 1 : 0.125,
      peakThreshold: s.peakThreshold,
      rangeMin: s.rangeMin,
      rangeMax: s.rangeMax
    })
    this.startAt = Date.now()

    const options = {
      duration: MAX_DURATION,
      sampleRate: 16000, // 与 encodeBitRate 匹配：16000 -> 24000~96000
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'PCM', // onFrameRecorded 帧回调仅支持 mp3 / PCM
      frameSize: 1 // 单位 KB，回调频率需真机验证
    }
    // audioMode 需基础库 3.17.3+（以官方文档核实）：recording 为高保真场景，避免 AGC 自动增益破坏测量
    if (gteVersion(getSDKVersion(), '3.17.3')) {
      options.audioMode = 'recording'
    }

    try {
      this.recorder.start(options)
    } catch (e) {
      wx.showToast({ title: '录音启动失败', icon: 'none' })
      return
    }

    this.setData({ status: 'measuring', permissionDenied: false })
    this._startTimer()
  },

  onPause() {
    if (this.data.status !== 'measuring') return
    this._pause()
  },

  _pause(tip) {
    try {
      this.recorder.pause()
    } catch (e) {
      /* ignore */
    }
    this._stopTimer()
    this.setData({ status: 'paused' })
    if (tip) wx.showToast({ title: tip, icon: 'none' })
  },

  onResume() {
    if (this.data.status !== 'paused') return
    try {
      this.recorder.resume()
    } catch (e) {
      /* ignore */
    }
    this.setData({ status: 'measuring' })
    this._startTimer()
  },

  onStopTap() {
    if (this.data.status === 'idle' || this.data.status === 'stopping') return
    this.setData({ status: 'stopping' })
    this._stopTimer()
    this._safeStop()
  },

  _safeStop() {
    try {
      this.recorder.stop()
    } catch (e) {
      // stop 抛错时直接走结束流程，避免卡在 stopping
      this._finish()
    }
  },

  _finish() {
    this._stopTimer()
    // 页面已卸载（切后台回收/退出）时不走保存流程，避免异常跳转
    if (this.destroyed) return
    if (!this.meter) {
      this.setData({ status: 'idle' })
      return
    }

    const stats = this.meter.getStats()
    this.setData({ status: 'idle' })

    if (stats.durationMs < 3000) {
      wx.showToast({ title: '测量时间过短，未保存', icon: 'none' })
      this.meter = null
      this._render()
      return
    }

    const now = Date.now()
    const record = Object.assign({}, stats, {
      id: genId(),
      startTime: this.startAt,
      endTime: now,
      tag: '未命名',
      note: '',
      deviceKey: getDeviceKey(),
      schemaVersion: 1,
      createdAt: now
    })

    const result = saveRecord(record)
    if (!result.ok) {
      const msg = result.reason === 'full' ? '记录已满，请清理后再保存' : '保存失败，请清理空间后重试'
      wx.showModal({ title: '保存失败', content: msg, showCancel: false })
      return
    }

    this.meter = null
    wx.navigateTo({ url: `/pages/detail/index?id=${record.id}` })
  },

  /* ---------- 刷新与渲染 ---------- */

  _startTimer() {
    this._stopTimer()
    this.timer = setInterval(() => this._flush(), FLUSH_INTERVAL)
  },

  _stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  _flush() {
    if (!this.meter) return
    const s = this.meter.peekStats()
    const raw = this.meter.display
    // 低于量程下限时显示「<30」而不是负数：负值说明校准基准不对，
    // 直接甩给用户毫无意义，且会让人以为程序坏了
    const display = raw == null ? null : Math.min(this.settings.rangeMax, Math.max(this.settings.rangeMin, raw))
    const belowRange = raw != null && raw < this.settings.rangeMin
    const level = levelOf(display)

    // 只 setData 变化的展示字段，避免大数据传输（波形走 canvas 直绘）
    this.setData({
      displayText: raw == null ? '--' : (belowRange ? `＜${this.settings.rangeMin}` : formatDb(display, '--')),
      level,
      'stat.leq': formatDb(s.leq, '--'),
      'stat.lmax': formatDb(s.lmax, '--'),
      'stat.lmin': formatDb(s.lmin, '--'),
      durationText: formatDuration(s.durationMs),
      peaksText: String(s.peaks.length)
    })

    this._render()
  },

  _render() {
    const s = this.settings
    const display = this.meter && this.meter.display != null
      ? Math.min(s.rangeMax, Math.max(s.rangeMin, this.meter.display))
      : null
    if (this.gaugeCtx) {
      drawGauge({
        ctx: this.gaugeCtx.ctx,
        width: this.gaugeCtx.width,
        height: this.gaugeCtx.height,
        value: display,
        rangeMin: s.rangeMin,
        rangeMax: s.rangeMax
      })
    }
    if (this.waveCtx) {
      drawWave({
        ctx: this.waveCtx.ctx,
        width: this.waveCtx.width,
        height: this.waveCtx.height,
        points: this.meter ? this.meter.wave : [],
        rangeMin: s.rangeMin,
        rangeMax: s.rangeMax
      })
    }
  },

  /* ---------- 其他交互 ---------- */

  onCalibrate() {
    const cur = this.settings.k
    wx.showModal({
      title: '校准读数',
      content: `当前基准 K=${cur}。若读数比实际偏小 5 dB 就输入 5，偏大 5 dB 就输入 -5（可填 -20~20）。`,
      editable: true,
      placeholderText: '例如 5 或 -3',
      success: (res) => {
        if (!res.confirm || !res.content) return
        const delta = parseFloat(res.content)
        if (isNaN(delta) || delta < -20 || delta > 20) {
          wx.showToast({ title: '请输入 -20 ~ 20 的差值', icon: 'none' })
          return
        }
        // 用户输入的是「差值」，累加到基准上并限定在有效区间（74~114）
        const next = Math.min(K_MAX, Math.max(K_MIN, Math.round(cur + delta)))
        this.settings.k = next
        saveSettings({ k: next })
        if (this.meter) this.meter.setK(next) // 测量中调整立即生效
        this.setData({ kText: String(next) })
        wx.showToast({ title: `K=${next}`, icon: 'success' })
      }
    })
  },

  onOpenSetting() {
    openSetting()
  },

  onGoRecords() {
    wx.navigateTo({ url: '/pages/records/index' })
  }
})
