<template>
  <section class="page" data-module="screen">
    <header class="page-head">
      <div>
        <h2>格栅清污管理 · 批量登记</h2>
        <p class="page-desc">
          汛期多泵站同时清格栅：先按所属泵站、格栅类型圈定清污编号，一次性填报污物量与清污人；
          污物量超 {{ limit }}m³ 的格单独转复核，不与普通批次混交。
        </p>
      </div>
      <div class="page-actions">
        <label class="team-pick">
          当前班组
          <select v-model="team">
            <option v-for="item in teams" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <button class="btn ghost" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 第一步：圈号 + 批量填报 -->
    <div class="batch-panel">
      <h3 class="panel-title">① 圈定清污编号并批量填报</h3>
      <form class="filter-bar" @submit.prevent="reloadCandidates">
        <label class="filter-item">
          <span>所属泵站</span>
          <select v-model="station">
            <option value="">全部泵站</option>
            <option v-for="name in optionStations" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>格栅类型</span>
          <select v-model="screenType">
            <option value="">全部类型</option>
            <option v-for="name in optionTypes" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <button class="btn primary" type="submit">圈号</button>
      </form>

      <div v-if="drafts.length" class="bulk-fill">
        <label>
          批量清污人
          <input v-model="bulkCleaner" placeholder="如：张志强" />
        </label>
        <button class="btn" type="button" @click="applyBulkCleaner">一键带到所选格</button>
        <span class="fill-hint">污物量已按实测带出，可逐格修改；超过 {{ limit }}m³ 自动进超限区。</span>
      </div>

      <div v-if="normalDrafts.length" class="draft-block">
        <h4 class="block-title normal">普通批次（{{ normalDrafts.length }} 格，污物量不超限）</h4>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>清污编号</th>
              <th>所属泵站</th>
              <th>格栅类型</th>
              <th>污物量(m³)</th>
              <th>清污人</th>
              <th>移出本批</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="draft in normalDrafts" :key="draft.id">
              <td>{{ draft.清污编号 }}</td>
              <td>{{ draft.所属泵站 }}</td>
              <td>{{ draft.格栅类型 }}</td>
              <td><input v-model="draft.污物量" class="cell-input" /></td>
              <td><input v-model="draft.清污人" class="cell-input" /></td>
              <td><button class="link" type="button" @click="removeDraft(draft.id)">移出</button></td>
            </tr>
          </tbody>
        </table>
        <div class="block-foot">
          <button class="btn primary" type="button" @click="submitNormal">
            以「{{ team }}」提交普通批次（{{ normalDrafts.length }} 格）
          </button>
          <span class="fill-hint">提交后逐格由待清污转已完工，并在{{ team }}清淤侧生成待复核活。</span>
        </div>
      </div>

      <div v-if="overDrafts.length" class="draft-block">
        <h4 class="block-title over">超限区（{{ overDrafts.length }} 格，污物量 &gt; {{ limit }}m³，不许混进普通批次）</h4>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>清污编号</th>
              <th>所属泵站</th>
              <th>格栅类型</th>
              <th>污物量(m³)</th>
              <th>清污人</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="draft in overDrafts" :key="draft.id" class="row-over">
              <td>{{ draft.清污编号 }}</td>
              <td>{{ draft.所属泵站 }}</td>
              <td>{{ draft.格栅类型 }}</td>
              <td class="amount-over"><input v-model="draft.污物量" class="cell-input" /></td>
              <td><input v-model="draft.清污人" class="cell-input" /></td>
              <td><button class="link" type="button" @click="removeDraft(draft.id)">移出</button></td>
            </tr>
          </tbody>
        </table>
        <div class="block-foot">
          <button class="btn danger" type="button" @click="routeOver">
            单独转复核（{{ overDrafts.length }} 格）
          </button>
          <span class="fill-hint">超限格只能走复核：通过后才完工并联动清淤；不通过则退回待清污。</span>
        </div>
      </div>

      <p v-if="!drafts.length" class="empty-state inline">选择泵站与格栅类型后点「圈号」，只圈待清污的格。</p>
    </div>

    <!-- 批量回执 -->
    <div v-if="receipts.length || reviewReceipts.length" class="batch-panel receipt-panel">
      <h3 class="panel-title">② 批量回执（逐条到格，被挡的一条不少）</h3>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>批次号</th>
            <th>清污编号</th>
            <th>所属泵站 / 格栅类型</th>
            <th>结论</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in allReceipts" :key="`${item.batchNo}-${item.r.id}-${index}`" :class="receiptRowClass(item.r.kind)">
            <td>{{ item.batchNo }}</td>
            <td>{{ item.r.清污编号 }}</td>
            <td>{{ item.r.所属泵站 }} / {{ item.r.格栅类型 }}</td>
            <td><span class="receipt-tag" :class="`tag-${item.r.kind}`">{{ receiptLabel(item.r.kind) }}</span></td>
            <td>{{ item.r.message }}</td>
          </tr>
        </tbody>
      </table>
      <p class="receipt-summary">
        最近一批：入账 <strong>{{ lastSummary.posted }}</strong> 格，被挡 <strong>{{ lastSummary.blocked }}</strong> 格，
        转复核 <strong>{{ lastSummary.review }}</strong> 格（重复框到、超限、并发抢先的全部在上面逐条列出）。
      </p>
    </div>

    <!-- 超限复核队列 -->
    <div class="batch-panel">
      <h3 class="panel-title">③ 污物量超限复核队列（{{ reviewQueue.length }}）</h3>
      <table v-if="reviewQueue.length" class="data-table compact">
        <thead>
          <tr>
            <th>清污编号</th>
            <th>所属泵站</th>
            <th>格栅类型</th>
            <th>污物量(m³)</th>
            <th>清污人</th>
            <th>提交班组 / 复核单</th>
            <th>进入时间</th>
            <th>复核</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewQueue" :key="item.id" class="row-over">
            <td>{{ item.清污编号 }}</td>
            <td>{{ item.所属泵站 }}</td>
            <td>{{ item.格栅类型 }}</td>
            <td class="amount-over">{{ item.污物量 }}</td>
            <td>{{ item.清污人 || '—' }}</td>
            <td>{{ item.班组 }} / {{ item.来源批次号 }}</td>
            <td>{{ item.进入复核时间 }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="resolve(item.id, true)">复核通过（完工）</button>
              <button class="link danger-link" type="button" @click="resolve(item.id, false)">退回重清</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state inline">暂无超限待复核格。</p>
    </div>

    <!-- 全量记录 -->
    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>按清污编号 / 泵站检索</span>
        <input v-model="keyword" placeholder="输入关键字" />
      </label>
      <button class="btn" type="submit">查询</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-over': String(row.status) === '待复核' }">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>
            <span class="status-chip" :class="`st-${String(row.status)}`">{{ row.status }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无格栅清污数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条格栅清污记录 · 污物量单格上限 {{ limit }}m³</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listEntries, resetModule } from '@/api/local-service'
import {
  listReviewQueue,
  loadBatchState,
  parseDirtAmount,
  pendingStationAndTypes,
  resetBatchState,
  resolveReview,
  routeOverLimitToReview,
  SCREEN_DIRT_LIMIT_M3,
  selectCandidates,
  submitCleanBatch,
} from '@/data/batch-service'
import type { BatchCandidate, BatchReceipt, CleanTeam, ScreenReviewItem } from '@/data/batch-types'
import type { EntryRow } from '@/data/types'

const teams: CleanTeam[] = ['甲班', '乙班', '丙班']
const team = ref<CleanTeam>('甲班')
const limit = SCREEN_DIRT_LIMIT_M3

const columns = ['清污编号', '所属泵站', '格栅类型', '污物量', '清污方式', '清污人', '清污日期', '清污状态']
const statuses = ['待清污', '清污中', '待复核', '已完工', '需复清']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const keyword = ref('')

// 圈号条件与候选
const station = ref('')
const screenType = ref('')
const optionStations = ref<string[]>([])
const optionTypes = ref<string[]>([])
const drafts = ref<(BatchCandidate & { 污物量: string; 清污人: string })[]>([])
const bulkCleaner = ref('')

// 复核队列
const reviewQueue = ref<ScreenReviewItem[]>([])

// 回执（保留多批历史，方便演示两班组并发抢同一批）
const receiptHistory = ref<{ batchNo: string; r: BatchReceipt }[]>([])
const reviewReceiptHistory = ref<{ batchNo: string; r: BatchReceipt }[]>([])
const lastSummary = ref({ posted: 0, blocked: 0, review: 0 })

const receipts = computed(() => receiptHistory.value)
const reviewReceipts = computed(() => reviewReceiptHistory.value)
const allReceipts = computed(() => [...receipts.value, ...reviewReceipts.value])

const isOver = (value: string) => {
  const amount = parseDirtAmount(value)
  return amount !== null && amount > limit
}
const normalDrafts = computed(() => drafts.value.filter((draft) => !isOver(draft.污物量)))
const overDrafts = computed(() => drafts.value.filter((draft) => isOver(draft.污物量)))

const stats = computed(() => [
  { label: '待清污格栅', value: rows.value.filter((r) => String(r.status) === '待清污').length },
  { label: '待复核（超限）', value: reviewQueue.value.length },
  { label: '已完工格栅', value: rows.value.filter((r) => String(r.status) === '已完工').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const receiptLabelMap: Record<BatchReceipt['kind'], string> = {
  posted: '已入账',
  duplicate: '重复挡下',
  'over-limit': '超限挡下',
  conflict: '并发挡下',
  reviewing: '复核中挡下',
  'not-pending': '状态挡下',
  missing: '缺号挡下',
  invalid: '信息不全挡下',
}
function receiptLabel(kind: BatchReceipt['kind']) {
  return receiptLabelMap[kind]
}
function receiptRowClass(kind: BatchReceipt['kind']) {
  if (kind === 'posted') return 'row-posted'
  if (kind === 'duplicate') return 'row-dup'
  return 'row-blocked'
}

function refreshOptions() {
  const options = pendingStationAndTypes()
  optionStations.value = options.stations
  optionTypes.value = options.types
}

function reloadCandidates() {
  errorMessage.value = ''
  drafts.value = selectCandidates(station.value, screenType.value).map((c) => ({
    ...c,
    清污人: c.清污人,
  }))
  refresh()
}

function applyBulkCleaner() {
  if (!bulkCleaner.value.trim()) {
    errorMessage.value = '先填写批量清污人姓名'
    return
  }
  for (const draft of drafts.value) {
    draft.清污人 = bulkCleaner.value.trim()
  }
}

function removeDraft(id: number) {
  drafts.value = drafts.value.filter((draft) => draft.id !== id)
}

function submitNormal() {
  errorMessage.value = ''
  const payload = drafts.value
    .filter((draft) => !isOver(draft.污物量))
    .map((draft) => ({ id: draft.id, 污物量: draft.污物量, 清污人: draft.清污人 }))
  if (!payload.length) {
    errorMessage.value = '普通批次里没有可提交的格'
    return
  }
  const result = submitCleanBatch(team.value, payload)
  for (const r of [...result.posted, ...result.blocked]) {
    receiptHistory.value.unshift({ batchNo: result.batchNo, r })
  }
  lastSummary.value = {
    posted: result.postedCount,
    blocked: result.blockedCount,
    review: 0,
  }
  // 已入账或已被挡死的格从草稿里清掉，还能再圈的（如缺信息被挡）保留。
  const handled = new Set<number>([
    ...result.posted.map((r) => r.id),
    ...result.blocked.filter((r) => r.kind !== 'invalid').map((r) => r.id),
  ])
  drafts.value = drafts.value.filter((draft) => !handled.has(draft.id))
  refresh()
}

function routeOver() {
  errorMessage.value = ''
  const payload = drafts.value
    .filter((draft) => isOver(draft.污物量))
    .map((draft) => ({ id: draft.id, 污物量: draft.污物量, 清污人: draft.清污人 }))
  if (!payload.length) {
    errorMessage.value = '超限区里没有可转复核的格'
    return
  }
  const result = routeOverLimitToReview(team.value, payload)
  for (const r of result.routed) {
    reviewReceiptHistory.value.unshift({ batchNo: result.batchNo, r })
  }
  for (const r of result.blocked) {
    receiptHistory.value.unshift({ batchNo: result.batchNo, r })
  }
  lastSummary.value = {
    posted: 0,
    blocked: result.blocked.length,
    review: result.routed.length,
  }
  const handled = new Set<number>([
    ...result.routed.map((r) => r.id),
    ...result.blocked.filter((r) => r.kind !== 'invalid').map((r) => r.id),
  ])
  drafts.value = drafts.value.filter((draft) => !handled.has(draft.id))
  refresh()
}

function resolve(id: number, pass: boolean) {
  const result = resolveReview(id, pass, team.value)
  errorMessage.value = result.ok ? '' : result.message
  if (result.ok) {
    receiptHistory.value.unshift({
      batchNo: 'REVIEW',
      r: {
        id,
        清污编号: result.screenRow ? String(result.screenRow['清污编号']) : `#${id}`,
        所属泵站: result.screenRow ? String(result.screenRow['所属泵站']) : '',
        格栅类型: result.screenRow ? String(result.screenRow['格栅类型']) : '',
        kind: pass ? 'posted' : 'reviewing',
        message: result.message,
      },
    })
  }
  refresh()
}

function resetDemo() {
  resetModule('screen')
  resetBatchState()
  receiptHistory.value = []
  reviewReceiptHistory.value = []
  drafts.value = []
  lastSummary.value = { posted: 0, blocked: 0, review: 0 }
  errorMessage.value = `演示数据已重置，格锁与复核队列已清空（批次序号回到初始，当前存储版本 ${loadBatchState().seq}）`
  refresh()
}

function reload() {
  const filters: Record<string, string> = keyword.value.trim() ? { 清污编号: keyword.value.trim() } : {}
  const payload = listEntries('screen', filters)
  rows.value = payload.items
  total.value = payload.total
}

function refresh() {
  reviewQueue.value = listReviewQueue()
  reload()
  refreshOptions()
}

onMounted(() => {
  refresh()
  reloadCandidates()
})
</script>

<style scoped>
.team-pick { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.team-pick select { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.batch-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
.panel-title { margin: 0 0 10px; font-size: 14px; }
.bulk-fill { display: flex; align-items: center; gap: 10px; margin: 10px 0; font-size: 13px; }
.bulk-fill input { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; width: 180px; }
.fill-hint { color: var(--muted); font-size: 12px; }
.draft-block { margin-top: 12px; }
.block-title { margin: 8px 0 6px; font-size: 13px; padding-left: 8px; border-left: 3px solid var(--brand); }
.block-title.over { border-left-color: #d92d20; color: #b42318; }
.data-table.compact th, .data-table.compact td { padding: 5px 8px; font-size: 12px; }
.cell-input { width: 100%; padding: 3px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }
.block-foot { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.empty-state.inline { padding: 12px; }
.row-over { background: #fef3f2; }
.amount-over { color: #b42318; font-weight: 600; }
.row-posted { background: #ecfdf3; }
.row-blocked { background: #fef3f2; }
.row-dup { background: #fffaeb; }
.receipt-panel { border-color: #b2ccff; }
.receipt-tag { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 12px; white-space: nowrap; }
.tag-posted { background: #d1fadf; color: #027a48; }
.tag-duplicate { background: #fef0c7; color: #b54708; }
.tag-over-limit, .tag-invalid, .tag-missing, .tag-not-pending, .tag-reviewing { background: #fee4e2; color: #b42318; }
.tag-conflict { background: #f9d976; color: #7a2e0e; }
.receipt-summary { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
.status-chip { border-radius: 999px; padding: 1px 10px; font-size: 12px; }
.st-待清污 { background: #eef2f7; color: #475467; }
.st-清污中 { background: #e0eaff; color: #1849a9; }
.st-待复核 { background: #fee4e2; color: #b42318; }
.st-已完工 { background: #d1fadf; color: #027a48; }
.st-需复清 { background: #fef0c7; color: #b54708; }
.btn.danger { background: #d92d20; border-color: #d92d20; color: #fff; }
.danger-link { color: #b42318; }
</style>
