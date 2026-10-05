/** 格栅清污批量登记相关的领域类型。 */
import type { EntryRow } from './types'

/** 清污班组：汛期多个泵站同时清格栅，按班组区分入账归属。 */
export type CleanTeam = '甲班' | '乙班' | '丙班'

/** 圈号阶段：按所属泵站、格栅类型圈定待清污编号后得到的候选格。 */
export type BatchCandidate = {
  id: number
  清污编号: string
  所属泵站: string
  格栅类型: string
  污物量: string
  清污人: string
  清污日期: string
  /** 污物量是否超限：超限格不许混进普通批次，必须单独走复核。 */
  overLimit: boolean
  /** 是否已在复核队列里：在复核未结案前不再参与圈号。 */
  inReview: boolean
}

/** 逐条回执的结果码。 */
export type ReceiptKind =
  | 'posted' // 进了：状态已转已完工
  | 'duplicate' // 同一批里被重复框到，只算一次（第一次入账，后续在这里挂名）
  | 'over-limit' // 污物量超限，被挡下并转复核队列
  | 'conflict' // 已被先到的另一批入账（并发，只入账先到的那一批）
  | 'reviewing' // 该格已在复核队列中，不能重复登记
  | 'not-pending' // 状态不是待清污，挡下
  | 'missing' // 编号找不到，挡下
  | 'invalid' // 污物量或清污人没填，挡下

/** 批量提交后逐条回执：哪条进了、哪条被挡、挡的是哪一格，都写明。 */
export type BatchReceipt = {
  id: number
  清污编号: string
  所属泵站: string
  格栅类型: string
  kind: ReceiptKind
  /** 人话结论，例如「已入账，状态转为已完工」。 */
  message: string
  /** 并发挡单时，写明先到的是哪个班组、哪一批。 */
  ownerBatchNo?: string
  ownerTeam?: CleanTeam
  /** 超限时带上实测污物量，方便复核。 */
  污物量?: string
}

/** 批量提交的整体回执。 */
export type BatchSubmitResult = {
  batchNo: string
  team: CleanTeam
  submittedAt: string
  posted: BatchReceipt[]
  blocked: BatchReceipt[]
  reviewRouted: BatchReceipt[]
  /** 去重后实际入账的格数。 */
  postedCount: number
  /** 被挡下的格数（含重复框到的挂名条数，绝不静默丢掉）。 */
  blockedCount: number
}

/** 超限复核队列条目：污物量超限的格单独拉出来走复核。 */
export type ScreenReviewItem = {
  id: number
  清污编号: string
  所属泵站: string
  格栅类型: string
  污物量: string
  清污人: string
  班组: CleanTeam
  来源批次号: string
  进入复核时间: string
}

/** 清污完工后在清淤侧生成的「待复核」活：按班组挂账。 */
export type DredgeReviewTask = {
  id: string
  清淤编号: string
  来源: '格栅清污批量完工'
  来源批次号: string
  来源清污编号: string
  所属泵站: string
  格栅类型: string
  清淤班组: CleanTeam
  污物量: string
  清污人: string
  完工时间: string
  状态: '待复核' | '已复核'
}

export type BatchState = {
  seq: number
  dredgeSeq: number
  /** 每一条清污记录当前被哪个批次锁定（入账后写入），并发挡单靠它判定。 */
  locks: Record<number, { batchNo: string; team: CleanTeam; at: string }>
  reviewQueue: ScreenReviewItem[]
  dredgeTasks: DredgeReviewTask[]
}

export type BatchEntry = {
  id: number
  污物量: string
  清污人: string
}

export type ReviewActionResult = {
  ok: boolean
  message: string
  task?: DredgeReviewTask
  screenRow?: EntryRow
}
