const { getIndex, getRecord, deleteRecord } = require('../../utils/storage')
const { formatTime, formatDuration, formatDb, levelOf } = require('../../utils/format')

const TAGS = ['居家', '办公', '街道', '施工', '娱乐', '交通', '其他']

Page({
  data: {
    list: [],
    loading: false,
    filterIndex: 0,
    filters: ['全部'].concat(TAGS)
  },

  onShow() {
    // 每次进入刷新，避免新增/删除后列表不同步
    this.loadList()
  },

  loadList() {
    if (this.data.loading) return
    this.setData({ loading: true })
    const index = getIndex()
    const keyword = this.data.filters[this.data.filterIndex]
    const list = index
      .filter((item) => keyword === '全部' || item.tag === keyword)
      .map((item) => {
        const level = levelOf(item.leq)
        return Object.assign({}, item, {
          timeText: formatTime(item.startTime),
          durationText: formatDuration(item.durationMs),
          leqText: formatDb(item.leq, '--'),
          levelLabel: level.label,
          levelColor: level.color
        })
      })
    this.setData({ list, loading: false })
  },

  onFilterChange(e) {
    this.setData({ filterIndex: Number(e.detail.value) || 0 })
    this.loadList()
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/detail/index?id=${id}` })
  },

  onItemLongPress(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除记录',
      content: '删除后不可恢复，确认删除？',
      success: (res) => {
        if (!res.confirm) return
        deleteRecord(id)
        this.loadList()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.redirectTo({ url: '/pages/index/index' })
      }
    })
  }
})
