const { getSettings, migrateLegacyRecords } = require('./utils/storage')

App({
  globalData: {
    settings: null
  },

  onLaunch() {
    // 启动时载入本地设置（校准偏移 K、阈值、档位等）
    this.globalData.settings = getSettings()
    // 一次性修正早期 K=10 造成的负值历史记录（幂等，正常数据不会被处理）
    const fixed = migrateLegacyRecords()
    if (fixed > 0) console.log(`[migrate] 已修正 ${fixed} 条历史记录的分贝值`)
  }
})
