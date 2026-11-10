/**
 * 系统与设备信息工具
 * 说明：wx.getWindowInfo / wx.getDeviceInfo / wx.getAppBaseInfo 为较新 API，
 * 低版本基础库不存在，故全部做特性检测并回落到 wx.getSystemInfoSync()。
 * 具体基础库版本要求以微信官方文档核实为准。
 */

function getSystemInfo() {
  if (typeof wx.getSystemInfoSync === 'function') {
    try {
      return wx.getSystemInfoSync() || {}
    } catch (e) {
      return {}
    }
  }
  return {}
}

/** 设备像素比，Canvas 2D 需要按 dpr 放大画布 */
function getPixelRatio() {
  if (typeof wx.getWindowInfo === 'function') {
    try {
      return wx.getWindowInfo().pixelRatio || 2
    } catch (e) {
      /* 继续回落 */
    }
  }
  return getSystemInfo().pixelRatio || 2
}

/** 基础库版本，用于 audioMode 等新参数的能力判断 */
function getSDKVersion() {
  if (typeof wx.getAppBaseInfo === 'function') {
    try {
      return wx.getAppBaseInfo().SDKVersion || ''
    } catch (e) {
      /* 继续回落 */
    }
  }
  return getSystemInfo().SDKVersion || ''
}

/** 版本比较：a >= b 返回 true */
function compareVersion(a, b) {
  const va = String(a || '').split('.')
  const vb = String(b || '').split('.')
  const len = Math.max(va.length, vb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(va[i] || '0', 10) || 0
    const nb = parseInt(vb[i] || '0', 10) || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

function gteVersion(a, b) {
  return compareVersion(a, b) >= 0
}

/** 机型标识，用于按机型存校准值 */
function getDeviceKey() {
  if (typeof wx.getDeviceInfo === 'function') {
    try {
      const info = wx.getDeviceInfo()
      return `${info.brand || ''}-${info.model || ''}`
    } catch (e) {
      /* 继续回落 */
    }
  }
  const info = getSystemInfo()
  return `${info.brand || ''}-${info.model || ''}`
}

module.exports = {
  getSystemInfo,
  getPixelRatio,
  getSDKVersion,
  compareVersion,
  gteVersion,
  getDeviceKey
}
