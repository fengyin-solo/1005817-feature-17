import { listRows, nextSeq, saveRows } from '@/data/local-store'
import type {
  EntryRow,
  ScreenBatchItem,
  ScreenBatchResult,
  ScreenReceiptLine,
  ScreenReviewResult,
} from '@/data/types'

const SCREEN_KEY = 'screen'
const DREDGE_KEY = 'dredge'

// 待清污状态：只有这个状态的格栅能被圈进批量登记。
const PENDING_CLEAN = '待清污'
// 污物量超限、等待复核的状态：不许混在普通批次里提交。
const PENDING_REVIEW = '待复核'
const DONE = '已完工'
const RE_CLEAN = '需复清'

// 不同格栅类型的单次清污污物量上限（kg）：粗格栅拦的东西大，限额高；细格栅一超就说明来污异常。
const DIRT_LIMIT_BY_TYPE: Record<string, number> = {
  粗格栅: 150,
  细格栅: 60,
  回转式格栅: 100,
}
const DEFAULT_DIRT_LIMIT = 100

export function dirtLimit(格栅类型: string): number {
  return DIRT_LIMIT_BY_TYPE[格栅类型] ?? DEFAULT_DIRT_LIMIT
}

export function isOverLimit(格栅类型: string, 污物量: number): boolean {
  return 污物量 > dirtLimit(格栅类型)
}

// 各泵站、各格栅类型分别有哪些「待清污」的格栅，圈编号时只圈得到这些。
export function screenCandidates(): {
  stations: string[]
  groups: { station: string; type: string; rows: EntryRow[] }[]
} {
  const rows = listRows(SCREEN_KEY).filter((row) => String(row.status) === PENDING_CLEAN)
  const stations = [...new Set(rows.map((row) => String(row['所属泵站'] ?? '')))]
  const map = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const key = `${String(row['所属泵站'] ?? '')}__${String(row['格栅类型'] ?? '')}`
    const bucket = map.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      map.set(key, [row])
    }
  }
  const groups = [...map.entries()].map(([key, bucket]) => {
    const [station, type] = key.split('__')
    return { station, type, rows: bucket }
  })
  return { stations, groups }
}

export function pendingReviewRows(): EntryRow[] {
  return listRows(SCREEN_KEY).filter((row) => String(row.status) === PENDING_REVIEW)
}

function rowVersion(row: EntryRow): number {
  const value = Number(row._version)
  return Number.isFinite(value) ? value : 0
}

function todayStr(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function newBatchNo(): string {
  const seq = nextSeq('screenBatch', 1)
  const compact = todayStr().replace(/-/g, '')
  return `PL-${compact}-${String(seq).padStart(2, '0')}`
}

function makeLine(
  row: EntryRow,
  item: ScreenBatchItem | undefined,
  accepted: boolean,
  reason: string,
): ScreenReceiptLine {
  return {
    id: Number(row.id),
    清污编号: String(row['清污编号'] ?? ''),
    所属泵站: String(row['所属泵站'] ?? ''),
    格栅类型: String(row['格栅类型'] ?? ''),
    污物量: item ? item.污物量 : (row['污物量'] === '' ? '' : Number(row['污物量'])),
    accepted,
    reason,
  }
}

// 完工后给该班组的清淤台账挂一笔「待复核」的活，清淤那边一眼能看到要复的是什么。
function createDredgeFollowUp(params: {
  crew: string
  accepted: { row: EntryRow; amount: number }[]
  note: string
}): number {
  const rows = listRows(DREDGE_KEY)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const nextCode = rows.reduce((max, row) => {
    const matched = /DRED-(\d+)/.exec(String(row['清淤编号'] ?? ''))
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0) + 1
  const totalAmount = params.accepted.reduce((sum, item) => sum + item.amount, 0)
  const stations = [...new Set(params.accepted.map((item) => String(item.row['所属泵站'] ?? '')))]
  const types = [...new Set(params.accepted.map((item) => String(item.row['格栅类型'] ?? '')))]
  const followUp: EntryRow = {
    id: nextId,
    status: PENDING_REVIEW,
    pending: true,
    abnormal: false,
    _version: 1,
    清淤编号: `DRED-${String(nextCode).padStart(4, '0')}`,
    清淤管段: `格栅清淤复核（${stations.join('、')}）`,
    淤积厚度: '—',
    清淤方式: '格栅污物复核清运',
    清淤班组: params.crew,
    清淤日期: todayStr(),
    清淤量: `${totalAmount}kg`,
    清淤状态: PENDING_REVIEW,
    联动说明: `${params.note}；涉及格栅类型：${types.join('、')}`,
  }
  saveRows(DREDGE_KEY, [...rows, followUp])
  return nextId
}

type SubmitOutcome = {
  accepted: ScreenReceiptLine[]
  blocked: ScreenReceiptLine[]
  acceptedDetails: { row: EntryRow; amount: number }[]
}

// 一次提交的入账判定：全部在同一个数据快照里完成，先到的批次改版本号，后到的整批被版本挡住。
function settleSubmit(
  rows: EntryRow[],
  items: ScreenBatchItem[],
  crew: string,
  mode: '普通批次' | '复核超限',
  batchNo: string,
): SubmitOutcome {
  const accepted: ScreenReceiptLine[] = []
  const blocked: ScreenReceiptLine[] = []
  const acceptedDetails: { row: EntryRow; amount: number }[] = []
  // 先按版本号排个序，保证并发演练时「先到」的定义是稳定的：圈选时版本小（更早圈到）的先入账。
  const ordered = [...items].sort((a, b) => {
    const ra = rows.find((row) => Number(row.id) === a.id)
    const rb = rows.find((row) => Number(row.id) === b.id)
    return rowVersion(ra ?? ({} as EntryRow)) - rowVersion(rb ?? ({} as EntryRow))
  })

  for (const item of ordered) {
    const index = rows.findIndex((row) => Number(row.id) === item.id)
    if (index < 0) {
      blocked.push({
        id: item.id,
        清污编号: `#${item.id}`,
        所属泵站: '—',
        格栅类型: '—',
        污物量: item.污物量,
        accepted: false,
        reason: '清污编号已不存在，可能被其他班组操作后刷新掉了',
      })
      continue
    }
    const row = rows[index]
    const expectVersion = rowVersion(row)

    if (expectVersion !== 0) {
      // 乐观并发：版本号对不上，说明这个格已经被先到的批次入账/改动过。
      const owner = String(row['登记班组'] ?? '')
      const ownerBatch = String(row['批次号'] ?? '')
      const ownerText = ownerBatch
        ? `已被${owner}（批次${ownerBatch}）先行入账`
        : `已被${owner || '另一批次'}先行登记（当前「${String(row.status)}」）`
      blocked.push(
        makeLine(row, item, false, `该格${ownerText}，本批不重复入账（当前状态：${String(row.status)}）`),
      )
      continue
    }

    if (mode === '普通批次' && String(row.status) !== PENDING_CLEAN) {
      blocked.push(makeLine(row, item, false, `当前状态为「${String(row.status)}」，不是「${PENDING_CLEAN}」，普通批次不接收`))
      continue
    }
    if (mode === '复核超限' && String(row.status) !== PENDING_REVIEW) {
      blocked.push(makeLine(row, item, false, `当前状态为「${String(row.status)}」，不在超限复核队列里`))
      continue
    }

    if (!Number.isFinite(item.污物量) || item.污物量 <= 0) {
      blocked.push(makeLine(row, item, false, '污物量未填或不是正数，无法入账'))
      continue
    }
    if (!item.清污人.trim()) {
      blocked.push(makeLine(row, item, false, '清污人为空，无法入账'))
      continue
    }

    if (mode === '普通批次' && isOverLimit(String(row['格栅类型'] ?? ''), item.污物量)) {
      // 超限的格：不许进普通批次，单独拉出来挂到「待复核」。
      const updated: EntryRow = {
        ...row,
        status: PENDING_REVIEW,
        pending: true,
        abnormal: true,
        _version: expectVersion + 1,
        污物量: item.污物量,
        清污人: item.清污人.trim(),
        清污日期: todayStr(),
        清污状态: PENDING_REVIEW,
        登记班组: crew,
        批次号: '',
        超限原因: `${String(row['格栅类型'] ?? '')}限额${dirtLimit(String(row['格栅类型'] ?? ''))}kg，实填${item.污物量}kg`,
      }
      rows[index] = updated
      blocked.push(
        makeLine(updated, item, false,
          `污物量${item.污物量}kg 超过「${String(row['格栅类型'] ?? '')}」限额${dirtLimit(String(row['格栅类型'] ?? ''))}kg，已单独转入「待复核」，不进普通批次`),
      )
      continue
    }

    const updated: EntryRow = {
      ...row,
      status: DONE,
      pending: false,
      abnormal: false,
      _version: expectVersion + 1,
      污物量: item.污物量,
      清污人: item.清污人.trim(),
      清污日期: todayStr(),
      清污状态: DONE,
      登记班组: crew,
      批次号: batchNo,
    }
    rows[index] = updated
    const line = makeLine(updated, item, true, '已入账，状态由「待清污」转为「已完工」')
    line.入账班组 = crew
    line.batchNo = batchNo
    accepted.push(line)
    acceptedDetails.push({ row: updated, amount: item.污物量 })
  }

  return { accepted, blocked, acceptedDetails }
}

export function submitScreenBatch(params: {
  items: ScreenBatchItem[]
  crew: string
  mode: '普通批次' | '复核超限'
}): ScreenBatchResult {
  const crew = params.crew.trim()
  if (!crew) {
    return {
      ok: false,
      message: '班组未填写，无法提交',
      mode: params.mode,
      crew: params.crew,
      accepted: [],
      blocked: [],
      duplicates: [],
    }
  }

  // 重复框到的编号只算一次：在这里去重并点名，不能静默丢掉。
  const seen = new Set<number>()
  const unique: ScreenBatchItem[] = []
  const duplicates: { id: number; 清污编号: string }[] = []
  const rowsById = new Map(listRows(SCREEN_KEY).map((row) => [Number(row.id), row]))
  for (const item of params.items) {
    if (seen.has(item.id)) {
      duplicates.push({
        id: item.id,
        清污编号: String(rowsById.get(item.id)?.['清污编号'] ?? `#${item.id}`),
      })
      continue
    }
    seen.add(item.id)
    unique.push(item)
  }
  if (!unique.length) {
    return {
      ok: false,
      message: '没有可提交的清污编号',
      mode: params.mode,
      crew,
      accepted: [],
      blocked: [],
      duplicates,
    }
  }

  const rows = [...listRows(SCREEN_KEY)]
  const batchNo = newBatchNo()
  const outcome = settleSubmit(rows, unique, crew, params.mode, batchNo)
  saveRows(SCREEN_KEY, rows)

  let dredgeFollowUpId: number | undefined
  if (outcome.acceptedDetails.length) {
    dredgeFollowUpId = createDredgeFollowUp({
      crew,
      accepted: outcome.acceptedDetails,
      note:
        params.mode === '复核超限'
          ? `格栅清污超限复核通过批次${batchNo}`
          : `格栅清污批量完工批次${batchNo}`,
    })
  }

  const ok = outcome.accepted.length > 0
  const message =
    `提交完成：${outcome.accepted.length} 条入账` +
    (outcome.blocked.length ? `，${outcome.blocked.length} 条被挡（逐条见回执）` : '')
  return {
    ok,
    message,
    mode: params.mode,
    crew,
    batchNo,
    accepted: outcome.accepted,
    blocked: outcome.blocked,
    duplicates,
    dredgeFollowUpId,
  }
}

// 两个班组同时提交同一批清污：在一个原子过程里先后落账，只入账先到的那一批；
// 后到班组的每一格都在回执里写明被谁的批次抢先。
export function simulateConcurrentSubmit(params: {
  items: ScreenBatchItem[]
  crewA: string
  crewB: string
}): { first: ScreenBatchResult; second: ScreenBatchResult } {
  const first = submitScreenBatch({ items: params.items, crew: params.crewA, mode: '普通批次' })
  const second = submitScreenBatch({ items: params.items, crew: params.crewB, mode: '普通批次' })
  return { first, second }
}

// 单条「确认完工」：清污中/需复清的格栅在页面上直接收尾，不产生新的清淤联动（批量入账时已挂过）。
export function completeScreenRow(id: number): { ok: boolean; message: string } {
  const rows = [...listRows(SCREEN_KEY)]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的清污记录` }
  }
  const row = rows[index]
  const status = String(row.status)
  if (status === DONE) {
    return { ok: false, message: '该格栅已经是「已完工」，不用重复操作' }
  }
  if (status === PENDING_REVIEW) {
    return { ok: false, message: '该格栅污物量超限待复核，不能直接完工，请走复核' }
  }
  if (status !== '清污中' && status !== RE_CLEAN) {
    return { ok: false, message: `当前状态为「${status}」，不能确认完工` }
  }
  rows[index] = {
    ...row,
    status: DONE,
    pending: false,
    abnormal: false,
    _version: rowVersion(row) + 1,
    清污状态: DONE,
  }
  saveRows(SCREEN_KEY, rows)
  return { ok: true, message: '清污记录已确认完工' }
}

// 超限复核队列里逐条处置：通过的补登记入账并联动清淤待复活；退回的转「需复清」。
export function resolveReview(params: {
  passIds: number[]
  rejectIds: number[]
  cleanerById: Record<number, string>
}): ScreenReviewResult {
  const rows = [...listRows(SCREEN_KEY)]
  const accepted: ScreenReceiptLine[] = []
  const blocked: ScreenReceiptLine[] = []
  const acceptedDetails: { row: EntryRow; amount: number }[] = []
  const batchNo = newBatchNo()

  for (const id of params.passIds) {
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      blocked.push({
        id,
        清污编号: `#${id}`,
        所属泵站: '—',
        格栅类型: '—',
        污物量: '',
        accepted: false,
        reason: '清污编号已不存在',
      })
      continue
    }
    const row = rows[index]
    if (String(row.status) !== PENDING_REVIEW) {
      blocked.push(makeLine(row, undefined, false, `当前状态为「${String(row.status)}」，已不在复核队列`))
      continue
    }
    const amount = Number(row['污物量'])
    const cleaner = (params.cleanerById[id] ?? String(row['清污人'] ?? '')).trim()
    if (!Number.isFinite(amount) || amount <= 0) {
      blocked.push(makeLine(row, undefined, false, '登记的污物量无效，无法通过复核'))
      continue
    }
    if (!cleaner) {
      blocked.push(makeLine(row, undefined, false, '清污人为空，无法通过复核'))
      continue
    }
    const updated: EntryRow = {
      ...row,
      status: DONE,
      pending: false,
      abnormal: false,
      _version: rowVersion(row) + 1,
      清污人: cleaner,
      清污日期: todayStr(),
      清污状态: DONE,
      批次号: batchNo,
    }
    rows[index] = updated
    const line = makeLine(updated, { id, 污物量: amount, 清污人: cleaner }, true, '复核通过，已补登记入账并转为「已完工」')
    line.batchNo = batchNo
    accepted.push(line)
    acceptedDetails.push({ row: updated, amount })
  }

  for (const id of params.rejectIds) {
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      blocked.push({
        id,
        清污编号: `#${id}`,
        所属泵站: '—',
        格栅类型: '—',
        污物量: '',
        accepted: false,
        reason: '清污编号已不存在',
      })
      continue
    }
    const row = rows[index]
    if (String(row.status) !== PENDING_REVIEW) {
      blocked.push(makeLine(row, undefined, false, `当前状态为「${String(row.status)}」，已不在复核队列`))
      continue
    }
    const updated: EntryRow = {
      ...row,
      status: RE_CLEAN,
      pending: true,
      abnormal: true,
      _version: rowVersion(row) + 1,
      清污状态: RE_CLEAN,
      批次号: '',
    }
    rows[index] = updated
    blocked.push(makeLine(updated, undefined, false, '复核退回：污物量异常未认可，已转「需复清」重新清污'))
  }

  saveRows(SCREEN_KEY, rows)

  let dredgeFollowUpId: number | undefined
  if (acceptedDetails.length) {
    dredgeFollowUpId = createDredgeFollowUp({
      crew: '复核班组',
      accepted: acceptedDetails,
      note: `格栅清污超限复核通过批次${batchNo}`,
    })
  }

  return {
    ok: accepted.length > 0,
    message:
      `复核完成：${accepted.length} 条通过` +
      (params.rejectIds.length ? `，${params.rejectIds.length} 条退回` : ''),
    accepted,
    blocked,
    dredgeFollowUpId,
  }
}
