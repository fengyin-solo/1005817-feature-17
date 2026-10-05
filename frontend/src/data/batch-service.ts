import { listRows, saveRows } from './local-store'
import type { EntryRow } from './types'
import type {
  BatchCandidate,
  BatchEntry,
  BatchReceipt,
  BatchState,
  BatchSubmitResult,
  CleanTeam,
  DredgeReviewTask,
  ReviewActionResult,
  ScreenReviewItem,
} from './batch-types'

// 批量领域状态独立存放：格锁（并发只认先到批次）、超限复核队列、清淤待复核活。
const BATCH_STORAGE_KEY = 'drainage-pump:screen-batch'
// 污物量上限（立方米）：超过这个数不许混在普通批次里，必须单独走复核。
export const SCREEN_DIRT_LIMIT_M3 = 5

function emptyState(): BatchState {
  return { seq: 0, dredgeSeq: 0, locks: {}, reviewQueue: [], dredgeTasks: [] }
}

// 无浏览器环境（如规则验证脚本）下用内存兜底，行为与 local-store 保持一致。
let memoryState: BatchState | null = null

function readState(): BatchState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return (memoryState ??= emptyState())
  }
  const raw = window.localStorage.getItem(BATCH_STORAGE_KEY)
  if (!raw) {
    return emptyState()
  }
  try {
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<BatchState>) }
  } catch {
    return emptyState()
  }
}

function writeState(state: BatchState): void {
  memoryState = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(state))
  }
}

/** 测试用：清掉批次锁、复核队列与联动生成的清淤待复核活。 */
export function resetBatchState(): BatchState {
  const fresh = emptyState()
  writeState(fresh)
  return fresh
}

export function loadBatchState(): BatchState {
  return readState()
}

/** 污物量解析：兼容 "6.2"、"6.2m³"、"5 立方米" 这类填法；解析不出返回 null。 */
export function parseDirtAmount(value: string): number | null {
  const matched = String(value ?? '').match(/\d+(?:\.\d+)?/)
  if (!matched) {
    return null
  }
  const amount = Number(matched[0])
  return Number.isFinite(amount) ? amount : null
}

export function isOverLimit(amount: number): boolean {
  return amount > SCREEN_DIRT_LIMIT_M3
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function todayText(): string {
  return nowText().slice(0, 10)
}

function nextBatchNo(state: BatchState, prefix: string): string {
  state.seq += 1
  return `${prefix}-${todayText().replace(/-/g, '')}-${String(state.seq).padStart(3, '0')}`
}

function nextDredgeNo(state: BatchState): string {
  state.dredgeSeq += 1
  return `DRED-REV-${String(state.dredgeSeq).padStart(4, '0')}`
}

/**
 * 圈号：按所属泵站 + 格栅类型把「待清污」的清污编号圈出来。
 * 已完工、清污中、复核中的格都不会进圈，避免把不能登记的格带给班组。
 */
export function selectCandidates(station: string, screenType: string): BatchCandidate[] {
  const state = readState()
  const reviewIds = new Set(state.reviewQueue.map((item) => item.id))
  const stationKey = station.trim()
  const typeKey = screenType.trim()
  return listRows('screen')
    .filter((row) => String(row.status) === '待清污')
    .filter((row) => !stationKey || String(row['所属泵站'] ?? '') === stationKey)
    .filter((row) => !typeKey || String(row['格栅类型'] ?? '') === typeKey)
    .map((row) => {
      const amount = parseDirtAmount(String(row['污物量'] ?? ''))
      return {
        id: Number(row.id),
        清污编号: String(row['清污编号'] ?? ''),
        所属泵站: String(row['所属泵站'] ?? ''),
        格栅类型: String(row['格栅类型'] ?? ''),
        污物量: String(row['污物量'] ?? ''),
        清污人: String(row['清污人'] ?? ''),
        清污日期: String(row['清污日期'] ?? ''),
        overLimit: amount !== null && isOverLimit(amount),
        inReview: reviewIds.has(Number(row.id)),
      }
    })
}

/** 圈号下拉用：当前还在待清污的泵站、格栅类型。 */
export function pendingStationAndTypes(): { stations: string[]; types: string[] } {
  const pending = listRows('screen').filter((row) => String(row.status) === '待清污')
  const stations = [...new Set(pending.map((row) => String(row['所属泵站'] ?? '')).filter(Boolean))]
  const types = [...new Set(pending.map((row) => String(row['格栅类型'] ?? '')).filter(Boolean))]
  return { stations, types }
}

function receipt(
  row: EntryRow | undefined,
  id: number,
  kind: BatchReceipt['kind'],
  message: string,
  extra: Partial<BatchReceipt> = {},
): BatchReceipt {
  return {
    id,
    清污编号: row ? String(row['清污编号'] ?? '') : `#${id}`,
    所属泵站: row ? String(row['所属泵站'] ?? '') : '',
    格栅类型: row ? String(row['格栅类型'] ?? '') : '',
    kind,
    message,
    ...extra,
  }
}

function createDredgeTask(
  state: BatchState,
  row: EntryRow,
  batchNo: string,
  team: CleanTeam,
  cleaner: string,
  amount: string,
  at: string,
): DredgeReviewTask {
  return {
    id: `DR-${row.id}-${batchNo}`,
    清淤编号: nextDredgeNo(state),
    来源: '格栅清污批量完工',
    来源批次号: batchNo,
    来源清污编号: String(row['清污编号'] ?? ''),
    所属泵站: String(row['所属泵站'] ?? ''),
    格栅类型: String(row['格栅类型'] ?? ''),
    清淤班组: team,
    污物量: amount,
    清污人: cleaner,
    完工时间: at,
    状态: '待复核',
  }
}

function dedupeEntries(entries: BatchEntry[]): { first: Map<number, BatchEntry>; duplicateIds: number[] } {
  const first = new Map<number, BatchEntry>()
  const duplicateIds: number[] = []
  for (const entry of entries) {
    if (first.has(entry.id)) {
      duplicateIds.push(entry.id)
    } else {
      first.set(entry.id, entry)
    }
  }
  return { first, duplicateIds }
}

/**
 * 批量提交普通批次（污物量不超限的格）。
 * 同步执行：在单线程内整批原子判定，另一个班组提交同一批时，逐格拿不到先到锁，
 * 只会拿到 conflict 回执 —— 只入账先到的那一批。
 */
export function submitCleanBatch(team: CleanTeam, entries: BatchEntry[]): BatchSubmitResult {
  const state = readState()
  const batchNo = nextBatchNo(state, 'PL')
  const submittedAt = nowText()

  const posted: BatchReceipt[] = []
  const blocked: BatchReceipt[] = []
  const reviewRouted: BatchReceipt[] = []

  const rows = listRows('screen')
  const { first, duplicateIds } = dedupeEntries(entries)
  const duplicated = new Set(duplicateIds)
  const nextRows = [...rows]

  // 按编号顺序处理，保证同一格永远是「第一次出现」入账。
  for (const [id, entry] of [...first.entries()].sort((a, b) => a[0] - b[0])) {
    const index = nextRows.findIndex((row) => Number(row.id) === id)
    const row = index >= 0 ? nextRows[index] : undefined

    if (!row) {
      blocked.push(receipt(undefined, id, 'missing', `清污编号 #${id} 找不到，这条被挡下，未入账`))
      continue
    }

    if (state.reviewQueue.some((item) => item.id === id)) {
      blocked.push(receipt(row, id, 'reviewing', '该格污物量超限，已在复核队列中，不能走普通批次，请在复核区处理'))
      continue
    }

    // 已被先到的另一批入账：并发挡单，写明先到班组和批次。
    const lock = state.locks[id]
    if (lock && !(lock.team === team && lock.batchNo === batchNo)) {
      blocked.push(
        receipt(row, id, 'conflict', `已被${lock.team}的批次 ${lock.batchNo} 抢先入账，本批不再重复入账`, {
          ownerBatchNo: lock.batchNo,
          ownerTeam: lock.team,
        }),
      )
      continue
    }

    const status = String(row.status)
    if (status === '待复核') {
      blocked.push(receipt(row, id, 'reviewing', '该格处于待复核状态，复核结案前不能登记'))
      continue
    }
    if (status !== '待清污') {
      blocked.push(receipt(row, id, 'not-pending', `当前状态为「${status}」，不是待清污，这条被挡下，未入账`))
      continue
    }

    const cleaner = entry.清污人.trim()
    const amountText = entry.污物量.trim()
    const amount = parseDirtAmount(amountText)
    if (!cleaner || amount === null) {
      blocked.push(
        receipt(row, id, 'invalid', `登记信息不完整（污物量：${amountText || '空'}，清污人：${cleaner || '空'}），这条被挡下，未入账`, {
          污物量: amountText,
        }),
      )
      continue
    }
    if (isOverLimit(amount)) {
      blocked.push(
        receipt(row, id, 'over-limit', `污物量 ${amountText} 超过单格上限 ${SCREEN_DIRT_LIMIT_M3}m³，不许混在普通批次里，请单独转复核`, {
          污物量: amountText,
        }),
      )
      continue
    }

    // 入账：待清污 → 已完工，写格锁，并给该班组的清淤侧挂一笔待复核的活。
    const updated: EntryRow = {
      ...row,
      status: '已完工',
      pending: false,
      abnormal: false,
      污物量: amountText,
      清污人: cleaner,
      清污日期: todayText(),
      清污状态: '已完工',
    }
    nextRows[index] = updated
    state.locks[id] = { batchNo, team, at: submittedAt }
    state.dredgeTasks.push(
      createDredgeTask(state, updated, batchNo, team, cleaner, amountText, submittedAt),
    )
    posted.push(receipt(row, id, 'posted', `已入账：状态由待清污转为已完工，清污人 ${cleaner}，污物量 ${amountText}`))

    // 同一批里又被框到的同名格：只算一次，但逐条挂名，不许静默丢掉。
    if (duplicated.has(id)) {
      blocked.push(
        receipt(row, id, 'duplicate', `本批重复框选，只按第一次入账（批次 ${batchNo}），本条不重复记账`, {
          ownerBatchNo: batchNo,
          ownerTeam: team,
          污物量: amountText,
        }),
      )
    }
  }

  saveRows('screen', nextRows)
  writeState(state)

  return {
    batchNo,
    team,
    submittedAt,
    posted,
    blocked,
    reviewRouted,
    postedCount: posted.length,
    blockedCount: blocked.length,
  }
}

/**
 * 超限格单独转复核：从普通批次里拉出来，进复核队列，清污状态置为「待复核」。
 * 同样按格加锁、去重、防并发。
 */
export function routeOverLimitToReview(
  team: CleanTeam,
  entries: BatchEntry[],
): { batchNo: string; routed: BatchReceipt[]; blocked: BatchReceipt[] } {
  const state = readState()
  const batchNo = nextBatchNo(state, 'RV')
  const at = nowText()
  const routed: BatchReceipt[] = []
  const blocked: BatchReceipt[] = []

  const rows = listRows('screen')
  const nextRows = [...rows]
  const { first } = dedupeEntries(entries)

  for (const [id, entry] of first) {
    const index = nextRows.findIndex((row) => Number(row.id) === id)
    const row = index >= 0 ? nextRows[index] : undefined
    if (!row) {
      blocked.push(receipt(undefined, id, 'missing', `清污编号 #${id} 找不到，这条被挡下`))
      continue
    }
    const lock = state.locks[id]
    if (lock) {
      blocked.push(
        receipt(row, id, 'conflict', `已被${lock.team}的批次 ${lock.batchNo} 先行处理，转复核被挡下`, {
          ownerBatchNo: lock.batchNo,
          ownerTeam: lock.team,
        }),
      )
      continue
    }
    if (state.reviewQueue.some((item) => item.id === id)) {
      blocked.push(receipt(row, id, 'reviewing', '该格已在复核队列中，不要重复转交'))
      continue
    }
    if (String(row.status) !== '待清污') {
      blocked.push(receipt(row, id, 'not-pending', `当前状态为「${row.status}」，不是待清污，转复核被挡下`))
      continue
    }
    const amountText = entry.污物量.trim() || String(row['污物量'] ?? '')
    const amount = parseDirtAmount(amountText)
    if (amount === null || !isOverLimit(amount)) {
      blocked.push(
        receipt(row, id, 'over-limit', `污物量 ${amountText || '空'} 未达到超限标准（> ${SCREEN_DIRT_LIMIT_M3}m³），应走普通批次，不要占复核`, {
          污物量: amountText,
        }),
      )
      continue
    }
    const cleaner = entry.清污人.trim() || String(row['清污人'] ?? '')

    const item: ScreenReviewItem = {
      id,
      清污编号: String(row['清污编号'] ?? ''),
      所属泵站: String(row['所属泵站'] ?? ''),
      格栅类型: String(row['格栅类型'] ?? ''),
      污物量: amountText,
      清污人: cleaner,
      班组: team,
      来源批次号: batchNo,
      进入复核时间: at,
    }
    state.reviewQueue.push(item)
    state.locks[id] = { batchNo, team, at }
    nextRows[index] = {
      ...row,
      status: '待复核',
      pending: true,
      abnormal: true,
      污物量: amountText,
      清污人: cleaner,
      清污状态: '待复核',
    }
    routed.push(
      receipt(row, id, 'over-limit', `污物量 ${amountText} 超限，已单独转入复核队列（复核单 ${batchNo}），不与普通批次混交`, {
        污物量: amountText,
      }),
    )
  }

  saveRows('screen', nextRows)
  writeState(state)
  return { batchNo, routed, blocked }
}

/** 复核结案：通过则完工并给清淤侧挂待复核活；退回则回到待清污，移出复核队列。 */
export function resolveReview(id: number, pass: boolean, operatorTeam: CleanTeam): ReviewActionResult {
  const state = readState()
  const queueIndex = state.reviewQueue.findIndex((item) => item.id === id)
  if (queueIndex < 0) {
    return { ok: false, message: '复核队列里没有这条记录' }
  }
  const item = state.reviewQueue[queueIndex]
  const rows = listRows('screen')
  const rowIndex = rows.findIndex((row) => Number(row.id) === id)
  if (rowIndex < 0) {
    return { ok: false, message: `清污记录 #${id} 已不存在` }
  }
  const row = rows[rowIndex]
  const at = nowText()

  state.reviewQueue.splice(queueIndex, 1)

  if (pass) {
    const updated: EntryRow = {
      ...row,
      status: '已完工',
      pending: false,
      abnormal: false,
      污物量: item.污物量,
      清污人: item.清污人,
      清污日期: todayText(),
      清污状态: '已完工（超限复核通过）',
    }
    rows[rowIndex] = updated
    const task = createDredgeTask(state, updated, item.来源批次号, item.班组, item.清污人, item.污物量, at)
    state.dredgeTasks.push(task)
    saveRows('screen', rows)
    writeState(state)
    return {
      ok: true,
      message: `复核通过：${item.清污编号} 完工，已给${item.班组}的清淤侧生成待复核活 ${task.清淤编号}`,
      task,
      screenRow: updated,
    }
  }

  rows[rowIndex] = {
    ...row,
    status: '待清污',
    pending: true,
    abnormal: false,
    清污状态: '待清污（复核退回）',
  }
  // 退回后释放格锁：别的班组可以重新圈到它。
  delete state.locks[id]
  saveRows('screen', rows)
  writeState(state)
  return {
    ok: true,
    message: `复核退回：${item.清污编号} 回到待清污，格锁已释放，可由${operatorTeam}重新登记`,
    screenRow: rows[rowIndex],
  }
}

export function listReviewQueue(): ScreenReviewItem[] {
  return readState().reviewQueue
}

/** 清淤侧的待复核活：按班组取（完工之后该班组的清淤那边要出现待复的活）。 */
export function listDredgeReviewTasks(team?: CleanTeam): DredgeReviewTask[] {
  const tasks = readState().dredgeTasks
  return team ? tasks.filter((task) => task.清淤班组 === team) : tasks
}

/** 清淤班组把待复核的活复核掉。 */
export function completeDredgeReview(id: string): ReviewActionResult {
  const state = readState()
  const task = state.dredgeTasks.find((item) => item.id === id)
  if (!task) {
    return { ok: false, message: '没有这笔待复核活' }
  }
  if (task.状态 === '已复核') {
    return { ok: false, message: '这笔活已经复核过了' }
  }
  task.状态 = '已复核'
  writeState(state)
  return { ok: true, message: `${task.清淤编号} 已复核，来源批次 ${task.来源批次号}` }
}
