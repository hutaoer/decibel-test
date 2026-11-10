/**
 * 隐私协议与麦克风授权
 *
 * 合规要点（以微信官方最新规则为准）：
 * 1. 录音属于隐私接口，必须在 mp 后台《用户隐私保护指引》声明「访问你的麦克风」并通过审核，
 *    否则 wx.authorize 会报 "api scope is not declared in the privacy agreement"。
 * 2. 授权必须在用户有预期行为后触发（点击「开始测量」），禁止进入小程序即弹窗。
 * 3. 用户拒绝后只停用测量功能，不得阻断其他功能。
 */

/** 隐私协议：判断是否需要在小程序内弹窗征求同意 */
function ensurePrivacy() {
  return new Promise((resolve) => {
    if (typeof wx.getPrivacySetting !== 'function') {
      resolve(true)
      return
    }
    wx.getPrivacySetting({
      success: (res) => {
        if (!res || !res.needAuthorization) {
          resolve(true)
          return
        }
        if (typeof wx.requirePrivacyAuthorize !== 'function') {
          resolve(true)
          return
        }
        wx.requirePrivacyAuthorize({
          success: () => resolve(true),
          fail: () => resolve(false)
        })
      },
      fail: () => resolve(true)
    })
  })
}

/**
 * 麦克风授权
 * @returns {Promise<'granted'|'denied'|'error'>}
 */
function ensureRecordAuth() {
  return new Promise((resolve) => {
    wx.getSetting({
      success: (res) => {
        const scope = res && res.authSetting ? res.authSetting['scope.record'] : undefined
        if (scope === true) {
          resolve('granted')
          return
        }
        if (scope === false) {
          resolve('denied')
          return
        }
        wx.authorize({
          scope: 'scope.record',
          success: () => resolve('granted'),
          fail: (err) => {
            const msg = (err && err.errMsg) || ''
            resolve(/deny|cancel|auth deny/.test(msg) ? 'denied' : 'error')
          }
        })
      },
      fail: () => resolve('error')
    })
  })
}

/** 引导用户去设置页开启权限 */
function openSetting() {
  wx.openSetting({
    fail: () => {
      wx.showToast({ title: '无法打开设置页', icon: 'none' })
    }
  })
}

module.exports = {
  ensurePrivacy,
  ensureRecordAuth,
  openSetting
}
