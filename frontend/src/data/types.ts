/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// —— 格栅清污批量登记专用结构 ——

// 批量提交时，按「所属泵站 + 格栅类型」圈好的一条清污编号要登记的内容。
export type ScreenBatchItem = {
  id: number
  污物量: number
  清污人: string
}

export type ScreenSubmitMode = '普通批次' | '复核超限'

// 逐条回执：入账的、被挡的都必须带回来，被挡的要说清挡住的是哪一格、为什么挡。
export type ScreenReceiptLine = {
  id: number
  清污编号: string
  所属泵站: string
  格栅类型: string
  污物量: number | ''
  accepted: boolean
  reason: string
  入账班组?: string
  batchNo?: string
}

export type ScreenBatchResult = {
  ok: boolean
  message: string
  mode: ScreenSubmitMode
  crew: string
  batchNo?: string
  accepted: ScreenReceiptLine[]
  blocked: ScreenReceiptLine[]
  // 重复框到的编号只算一次：在这里点明，不静默处理。
  duplicates: { id: number; 清污编号: string }[]
  dredgeFollowUpId?: number
}

export type ScreenReviewResult = {
  ok: boolean
  message: string
  accepted: ScreenReceiptLine[]
  blocked: ScreenReceiptLine[]
  dredgeFollowUpId?: number
}
