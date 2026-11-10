/**
 * 分贝计算内核（纯逻辑，不依赖 UI）
 *
 * 关键口径：
 * 1. 瞬时值：PCM 帧 -> RMS -> dBFS -> 加校准偏移 K -> dB SPL（估算）
 * 2. 平均值：必须使用能量平均 Leq = 10*log10(mean(10^(Li/10)))，禁止算术平均
 * 3. 时间加权：F 档 tau=0.125s，S 档 tau=1s，一阶指数平滑
 */

const REF_AMPLITUDE = 32768 // 16bit PCM 满量程幅值
/**
 * dBFS -> dB SPL 估算偏移。
 * 满量程（0 dBFS）约对应 94 dB SPL 是行业常用估算基准，
 * 因此 K 的量级是 90~100，而不是个位数：
 * 安静室内 RMS 约 100/32768 ≈ -50 dBFS，加 94 得 44 dB，符合实际。
 * 手机麦克风增益差异大，真机标定后可通过校准入口调整。
 */
const DEFAULT_K = 94
const K_MIN = 74
const K_MAX = 114
const CLIP_RATIO = 0.98 // 超过满量程该比例视为削波

/** RMS -> 估算声压级 */
function dbFromRms(rms, k) {
  if (!rms || rms <= 0) return null
  const dbfs = 20 * Math.log10(rms / REF_AMPLITUDE)
  return dbfs + (typeof k === 'number' ? k : DEFAULT_K)
}

/** 能量平均（Leq） */
function energyMean(dbList) {
  if (!dbList || !dbList.length) return null
  let sum = 0
  for (let i = 0; i < dbList.length; i++) {
    sum += Math.pow(10, dbList[i] / 10)
  }
  return 10 * Math.log10(sum / dbList.length)
}

/** 多段合并的加权能量平均：Leq = 10*log10( Σ(Ti*10^(Li/10)) / ΣTi ) */
function mergeLeq(segments) {
  if (!segments || !segments.length) return null
  let energy = 0
  let total = 0
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg || !seg.durationMs || seg.leq == null) continue
    energy += seg.durationMs * Math.pow(10, seg.leq / 10)
    total += seg.durationMs
  }
  if (!total) return null
  return 10 * Math.log10(energy / total)
}

class DbMeter {
  constructor(options) {
    const opts = options || {}
    this.sampleRate = opts.sampleRate || 16000
    this.blockMs = opts.blockMs || 100
    this.blockSamples = Math.round((this.sampleRate * this.blockMs) / 1000)
    this.rangeMin = opts.rangeMin != null ? opts.rangeMin : 30
    this.rangeMax = opts.rangeMax != null ? opts.rangeMax : 110
    this.k = opts.k != null ? opts.k : DEFAULT_K
    this.tau = opts.tau || 0.125 // F 档
    this.peakThreshold = opts.peakThreshold != null ? opts.peakThreshold : 85
    this.waveSize = opts.waveSize || 60
    this.maxPeaks = opts.maxPeaks || 20
    this.reset()
  }

  setK(k) {
    this.k = k
  }

  setTau(tau) {
    this.tau = tau
  }

  setPeakThreshold(v) {
    this.peakThreshold = v
  }

  reset() {
    this.blockSumSq = 0
    this.blockCount = 0
    this.energySum = 0
    this.blockNum = 0
    this.lmax = null
    this.lmin = null
    this.display = null
    this.clipped = false
    this.series = [] // 每秒一个点：[{ t: ms, db }]
    this.wave = [] // 最近 waveSize 个块级显示点
    this.peaks = []
    this._currentPeak = null
    this._secondAcc = { sum: 0, count: 0 }
    this._clipStreak = 0
  }

  /**
   * 输入一帧 PCM 数据（ArrayBuffer，16bit 单声道）
   * @returns {number|null} 平滑后的实时显示值
   */
  pushFrame(buffer) {
    if (!buffer) return this.display
    let pcm
    try {
      pcm = new Int16Array(buffer)
    } catch (e) {
      return this.display
    }
    if (!pcm.length) return this.display

    let sumSq = 0
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i]
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / pcm.length)

    // 削波检测：连续 3 帧接近满量程
    if (rms > REF_AMPLITUDE * CLIP_RATIO) {
      this._clipStreak += 1
      if (this._clipStreak >= 3) this.clipped = true
    } else {
      this._clipStreak = 0
    }

    // 实时显示值（指数平滑）
    const frameDb = dbFromRms(rms, this.k)
    if (frameDb != null) {
      if (this.display == null) {
        this.display = frameDb
      } else {
        const dt = pcm.length / this.sampleRate
        const alpha = 1 - Math.exp(-dt / this.tau)
        this.display = this.display + alpha * (frameDb - this.display)
      }
    }

    // 按 100ms 块累计并结算
    this.blockSumSq += sumSq
    this.blockCount += pcm.length
    while (this.blockCount >= this.blockSamples) {
      const ratio = this.blockSamples / this.blockCount
      const segSumSq = this.blockSumSq * ratio
      const blockRms = Math.sqrt(segSumSq / this.blockSamples)
      const blockDb = dbFromRms(blockRms, this.k)
      if (blockDb != null) this._onBlock(blockDb)
      this.blockSumSq -= segSumSq
      this.blockCount -= this.blockSamples
    }

    return this.display
  }

  _onBlock(db) {
    const t = this.blockNum * this.blockMs
    this.blockNum += 1
    this.energySum += Math.pow(10, db / 10)

    if (this.lmax == null || db > this.lmax) this.lmax = db
    if (this.lmin == null || db < this.lmin) this.lmin = db

    // 每秒抽稀一点存曲线
    this._secondAcc.sum += db
    this._secondAcc.count += 1
    if (this._secondAcc.count >= Math.round(1000 / this.blockMs)) {
      this.series.push({ t, db: this._secondAcc.sum / this._secondAcc.count })
      this._secondAcc = { sum: 0, count: 0 }
    }

    // 波形显示点
    this.wave.push(db)
    if (this.wave.length > this.waveSize) this.wave.shift()

    // 峰值事件：超阈值持续 >=1s 记一次
    if (db >= this.peakThreshold) {
      if (!this._currentPeak) {
        this._currentPeak = { t, value: db, durationMs: 0 }
      } else {
        if (db > this._currentPeak.value) this._currentPeak.value = db
        this._currentPeak.durationMs = t + this.blockMs - this._currentPeak.t
      }
    } else if (this._currentPeak) {
      this._flushPeak()
    }
  }

  _flushPeak() {
    if (!this._currentPeak) return
    if (this._currentPeak.durationMs >= 1000 && this.peaks.length < this.maxPeaks) {
      this.peaks.push({
        t: this._currentPeak.t,
        value: this._currentPeak.value,
        durationMs: this._currentPeak.durationMs,
        threshold: this.peakThreshold
      })
    }
    this._currentPeak = null
  }

  /** 测量过程中的即时统计（不关闭进行中的峰值事件，可高频调用） */
  peekStats() {
    const durationMs = this.blockNum * this.blockMs
    const leq = this.blockNum ? 10 * Math.log10(this.energySum / this.blockNum) : null
    return {
      leq,
      lmax: this.lmax,
      lmin: this.lmin,
      durationMs,
      blocks: this.blockNum,
      clipped: this.clipped,
      peaks: this.peaks.slice(0, this.maxPeaks)
    }
  }

  /** 结束测量，返回统计结果 */
  getStats() {
    this._flushPeak()
    const durationMs = this.blockNum * this.blockMs
    const leq = this.blockNum ? 10 * Math.log10(this.energySum / this.blockNum) : null
    return {
      leq,
      lmax: this.lmax,
      lmin: this.lmin,
      durationMs,
      blocks: this.blockNum,
      clipped: this.clipped,
      series: this.series.slice(0, 600),
      peaks: this.peaks.slice(0, this.maxPeaks),
      k: this.k,
      weighted: this.tau <= 0.2 ? 'F' : 'S'
    }
  }
}

module.exports = {
  REF_AMPLITUDE,
  DEFAULT_K,
  K_MIN,
  K_MAX,
  dbFromRms,
  energyMean,
  mergeLeq,
  DbMeter
}
