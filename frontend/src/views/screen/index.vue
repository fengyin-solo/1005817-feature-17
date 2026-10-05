<template>
  <section class="page" data-module="screen">
    <header class="page-head">
      <div>
        <h2>格栅清污管理</h2>
        <p class="page-desc">汛期多站同清：先按所属泵站、格栅类型圈好清污编号，再一次性登记污物量与清污人；超限的格单独走复核，不混进普通批次。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openBatch">批量清污登记</button>
        <button class="btn" type="button" @click="exportRows">导出格栅清污清单</button>
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

    <section v-if="reviewRows.length" class="review-queue">
      <h3>超限待复核队列（{{ reviewRows.length }}）</h3>
      <p class="queue-tip">这些格污物量超限，已被挡在普通批次之外，必须逐条复核；被挡的记录不会静默丢失。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>清污编号</th>
            <th>所属泵站</th>
            <th>格栅类型</th>
            <th>污物量(kg)</th>
            <th>限额(kg)</th>
            <th>超限原因</th>
            <th>登记班组</th>
            <th>清污人</th>
            <th>复核操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewRows" :key="`review-${String(row.id)}`" class="row-overlimit">
            <td>{{ row['清污编号'] }}</td>
            <td>{{ row['所属泵站'] }}</td>
            <td>{{ row['格栅类型'] }}</td>
            <td>{{ row['污物量'] }}</td>
            <td>{{ dirtLimit(String(row['格栅类型'])) }}</td>
            <td>{{ row['超限原因'] }}</td>
            <td>{{ row['登记班组'] }}</td>
            <td>{{ row['清污人'] }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="reviewPass(row)">复核通过</button>
              <button class="link danger" type="button" @click="reviewReject(row)">复核退回</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>登记班组</th>
          <th>批次号</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-overlimit': row.status === '待复核' }">
          <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
          <td>{{ row['登记班组'] || '—' }}</td>
          <td>{{ row['批次号'] || '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.status === '待复核'" class="badge danger">超限待复核</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              :class="{ danger: action === '要求复清' || action === '复核退回' }"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无格栅清污数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条格栅清污记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 批量登记：圈编号 → 批量填污物量/清污人 → 提交/并发演练 -->
    <div v-if="batchOpen" class="modal-mask" @click.self="closeBatch">
      <div class="modal wide">
        <header class="modal-head">
          <h3>格栅清污批量登记</h3>
          <button class="btn ghost" type="button" @click="closeBatch">关闭</button>
        </header>

        <div class="step-block">
          <h4>① 按所属泵站、格栅类型圈清污编号</h4>
          <div class="filter-bar">
            <label class="filter-item">
              <span>所属泵站</span>
              <select v-model="circleStation">
                <option value="">全部泵站</option>
                <option v-for="station in stations" :key="station" :value="station">{{ station }}</option>
              </select>
            </label>
            <label class="filter-item">
              <span>格栅类型</span>
              <select v-model="circleType">
                <option value>全部类型</option>
                <option v-for="type in typesInStation" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <button class="btn" type="button" @click="circleAll">圈入当前筛选下全部</button>
            <button class="btn ghost" type="button" @click="clearCircle">清空已圈</button>
            <span class="circle-count">已圈 {{ selectedRows.length }} 格</span>
          </div>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>圈选</th>
                <th>清污编号</th>
                <th>所属泵站</th>
                <th>格栅类型</th>
                <th>污物量限额(kg)</th>
                <th>清污方式</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in candidateRows" :key="String(row.id)">
                <td><input type="checkbox" :checked="isSelected(Number(row.id))" @change="toggleRow(Number(row.id))" /></td>
                <td>{{ row['清污编号'] }}</td>
                <td>{{ row['所属泵站'] }}</td>
                <td>{{ row['格栅类型'] }}</td>
                <td>{{ dirtLimit(String(row['格栅类型'])) }}</td>
                <td>{{ row['清污方式'] }}</td>
              </tr>
              <tr v-if="!candidateRows.length">
                <td colspan="6" class="empty-state">该泵站/类型下没有「待清污」的格栅</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="selectedRows.length" class="step-block">
          <h4>② 一次性填污物量与清污人</h4>
          <div class="filter-bar">
            <label class="filter-item">
              <span>本班清污班组</span>
              <input v-model="crew" placeholder="如：甲班" style="width: 120px" />
            </label>
            <label class="filter-item">
              <span>统一清污人</span>
              <input v-model="bulkCleaner" placeholder="如：甲班-李伟" style="width: 160px" />
            </label>
            <label class="filter-item">
              <span>统一污物量(kg)</span>
              <input v-model.number="bulkAmount" type="number" min="0" style="width: 130px" />
            </label>
            <button class="btn" type="button" @click="applyBulk">批量填入</button>
          </div>
          <table class="data-table compact">
            <thead>
              <tr>
                <th>清污编号</th>
                <th>所属泵站</th>
                <th>格栅类型</th>
                <th>污物量(kg)</th>
                <th>清污人</th>
                <th>超限判定</th>
                <th>移出</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in selectedRows" :key="`sel-${String(row.id)}`" :class="{ 'row-overlimit': rowIsOver(row) }">
                <td>{{ row['清污编号'] }}</td>
                <td>{{ row['所属泵站'] }}</td>
                <td>{{ row['格栅类型'] }}</td>
                <td><input v-model.number="amountById[row.id]" type="number" min="0" class="cell-input" /></td>
                <td><input v-model="cleanerById[row.id]" class="cell-input wide" /></td>
                <td>
                  <span v-if="rowIsOver(row)" class="badge danger">
                    超限（限额{{ dirtLimit(String(row['格栅类型'])) }}kg），将单独转复核
                  </span>
                  <span v-else-if="amountFilled(row)" class="badge ok">正常</span>
                  <span v-else class="muted">待填</span>
                </td>
                <td><button class="link danger" type="button" @click="toggleRow(Number(row.id))">移出</button></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="selectedRows.length" class="step-block">
          <h4>③ 提交</h4>
          <p class="queue-tip">
            普通批次只收不超限的格；超限的格会被逐条挡下并自动转入「待复核」，不在本批入账。
          </p>
          <div class="submit-row">
            <button class="btn primary" type="button" @click="submitNormal">提交普通批次</button>
            <span class="submit-divider">两个班组同时提交同一批时：</span>
            <label class="filter-item inline">
              <span>另一班组</span>
              <input v-model="otherCrew" placeholder="如：乙班" style="width: 110px" />
            </label>
            <button class="btn" type="button" @click="submitConcurrent">并发演练（同批两班抢交）</button>
          </div>
          <p v-if="batchError" class="error-text">{{ batchError }}</p>
        </div>
      </div>
    </div>

    <!-- 回执：逐条列明入账/被挡 -->
    <div v-if="receipt" class="modal-mask" @click.self="receipt = null">
      <div class="modal wide">
        <header class="modal-head">
          <h3>批量提交回执</h3>
          <button class="btn ghost" type="button" @click="closeReceipt">知道了</button>
        </header>
        <p>{{ receipt.message }}</p>

        <div v-if="receipt.concurrent" class="concurrent-note">
          <p>并发演练：同一批清污由「{{ receipt.crew }}」与「{{ receipt.otherCrew }}」同时提交——只入账先到的「{{ receipt.crew }}」，后到班组每格都被挡，回执写明先占批次。</p>
        </div>

        <div v-if="receipt.data.duplicates.length" class="dup-note">
          重复框到 {{ receipt.data.duplicates.length }} 个编号，只算一次：
          <span v-for="dup in receipt.data.duplicates" :key="dup.id" class="badge">{{ dup.清污编号 }}</span>
        </div>

        <h4 class="receipt-title ok">入账 {{ receipt.data.accepted.length }} 条（状态：待清污 → 已完工）</h4>
        <table class="data-table compact">
          <thead>
            <tr><th>清污编号</th><th>所属泵站</th><th>格栅类型</th><th>污物量(kg)</th><th>入账班组</th><th>批次号</th><th>结果</th></tr>
          </thead>
          <tbody>
            <tr v-for="line in receipt.data.accepted" :key="`ok-${line.id}`">
              <td>{{ line.清污编号 }}</td>
              <td>{{ line.所属泵站 }}</td>
              <td>{{ line.格栅类型 }}</td>
              <td>{{ line.污物量 }}</td>
              <td>{{ line.入账班组 }}</td>
              <td>{{ line.batchNo }}</td>
              <td><span class="badge ok">进了</span> {{ line.reason }}</td>
            </tr>
            <tr v-if="!receipt.data.accepted.length"><td colspan="7" class="empty-state">本批没有入账的记录</td></tr>
          </tbody>
        </table>

        <h4 class="receipt-title danger">被挡 {{ receipt.data.blocked.length }} 条（一条都不丢）</h4>
        <table class="data-table compact">
          <thead>
            <tr><th>清污编号</th><th>所属泵站</th><th>格栅类型</th><th>污物量(kg)</th><th>挡住原因（含被哪格/哪批先占）</th></tr>
          </thead>
          <tbody>
            <tr v-for="line in receipt.data.blocked" :key="`block-${line.id}`" class="row-blocked">
              <td>{{ line.清污编号 }}</td>
              <td>{{ line.所属泵站 }}</td>
              <td>{{ line.格栅类型 }}</td>
              <td>{{ line.污物量 === '' ? '—' : line.污物量 }}</td>
              <td><span class="badge danger">被挡</span> {{ line.reason }}</td>
            </tr>
            <tr v-if="!receipt.data.blocked.length"><td colspan="5" class="empty-state">没有被挡的记录</td></tr>
          </tbody>
        </table>

        <p v-if="receipt.data.dredgeFollowUpId" class="followup-note">
          已在「管网清淤」给本班（{{ receipt.data.crew }}）生成一笔待复核清淤活，编号 #{{ receipt.data.dredgeFollowUpId }}。
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  completeScreenRow,
  dirtLimit,
  pendingReviewRows,
  resolveReview,
  screenCandidates,
  simulateConcurrentSubmit,
  submitScreenBatch,
} from '@/api/screen-batch'
import type { EntryRow, ScreenBatchResult } from '@/data/types'

const meta = moduleMeta('screen')
const columns = ["清污编号", "所属泵站", "格栅类型", "污物量", "清污方式", "清污人", "清污日期"]
const statuses = ["待清污", "清污中", "已完工", "待复核", "需复清"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["清污编号", "所属泵站", "格栅类型"]

const stats = computed(() => [
  { label: "待清污格栅", value: rows.value.filter((row) => String(row.status) === '待清污').length },
  { label: "待复核（超限）", value: rows.value.filter((row) => String(row.status) === '待复核').length },
  { label: "本月完工数", value: rows.value.filter((row) => String(row.status) === '已完工').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const reviewRows = computed(() => pendingReviewRows())

function actionsFor(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待清污':
      return ['要求复清']
    case '清污中':
      return ['确认完工', '要求复清']
    case '待复核':
      return ['复核通过', '复核退回']
    case '需复清':
      return ['确认完工']
    default:
      return []
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  let result: { ok: boolean; message: string }
  if (action === '确认完工') {
    result = completeScreenRow(Number(row.id))
  } else if (action === '复核通过') {
    result = resolveReview({ passIds: [Number(row.id)], rejectIds: [], cleanerById: {} })
  } else if (action === '复核退回') {
    result = resolveReview({ passIds: [], rejectIds: [Number(row.id)], cleanerById: {} })
  } else {
    result = applyAction(meta.key, Number(row.id), action)
  }
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reviewPass(row: EntryRow) {
  const result = resolveReview({ passIds: [Number(row.id)], rejectIds: [], cleanerById: {} })
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function reviewReject(row: EntryRow) {
  const result = resolveReview({ passIds: [], rejectIds: [Number(row.id)], cleanerById: {} })
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '格栅清污列表读取失败'
  }
}

// —— 批量登记弹窗 ——

const batchOpen = ref(false)
const circleStation = ref('')
const circleType = ref('')
const selectedIds = ref<number[]>([])
const crew = ref('')
const otherCrew = ref('')
const bulkAmount = ref<number | null>(null)
const bulkCleaner = ref('')
const amountById = ref<Record<number, number>>({})
const cleanerById = ref<Record<number, string>>({})
const batchError = ref('')

const candidates = ref(screenCandidates())
const stations = computed(() => candidates.value.stations)
const typesInStation = computed(() =>
  [...new Set(
    candidates.value.groups
      .filter((group) => !circleStation.value || group.station === circleStation.value)
      .map((group) => group.type),
  )],
)
const candidateRows = computed(() =>
  candidates.value.groups
    .filter((group) => (!circleStation.value || group.station === circleStation.value)
      && (!circleType.value || group.type === circleType.value))
    .flatMap((group) => group.rows),
)
const allRowsById = computed(() => {
  const map = new Map<number, EntryRow>()
  for (const group of candidates.value.groups) {
    for (const row of group.rows) {
      map.set(Number(row.id), row)
    }
  }
  return map
})
const selectedRows = computed(() =>
  selectedIds.value.map((id) => allRowsById.value.get(id)).filter((row): row is EntryRow => Boolean(row)),
)

function openBatch() {
  candidates.value = screenCandidates()
  batchOpen.value = true
  batchError.value = ''
}
function closeBatch() {
  batchOpen.value = false
}
function isSelected(id: number): boolean {
  return selectedIds.value.includes(id)
}
function toggleRow(id: number) {
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id)
    const amounts = { ...amountById.value }
    const cleaners = { ...cleanerById.value }
    delete amounts[id]
    delete cleaners[id]
    amountById.value = amounts
    cleanerById.value = cleaners
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}
function circleAll() {
  const ids = candidateRows.value.map((row) => Number(row.id))
  selectedIds.value = [...new Set([...selectedIds.value, ...ids])]
}
function clearCircle() {
  selectedIds.value = []
  amountById.value = {}
  cleanerById.value = {}
}
function applyBulk() {
  if (bulkAmount.value !== null && Number.isFinite(bulkAmount.value)) {
    const next = { ...amountById.value }
    for (const id of selectedIds.value) {
      next[id] = Number(bulkAmount.value)
    }
    amountById.value = next
  }
  if (bulkCleaner.value.trim()) {
    const next = { ...cleanerById.value }
    for (const id of selectedIds.value) {
      next[id] = bulkCleaner.value.trim()
    }
    cleanerById.value = next
  }
}
function amountFilled(row: EntryRow): boolean {
  return Number.isFinite(amountById.value[Number(row.id)])
}
function rowIsOver(row: EntryRow): boolean {
  const amount = amountById.value[Number(row.id)]
  return Number.isFinite(amount) && amount > 0 && dirtLimit(String(row['格栅类型'])) < amount
}

type ReceiptState = {
  data: ScreenBatchResult
  message: string
  crew: string
  otherCrew?: string
  concurrent: boolean
}
const receipt = ref<ReceiptState | null>(null)

function collectItems() {
  return selectedIds.value.map((id) => ({
    id,
    污物量: Number(amountById.value[id]),
    清污人: cleanerById.value[id] ?? '',
  }))
}

function validateBeforeSubmit(): boolean {
  if (!crew.value.trim()) {
    batchError.value = '请填写本班清污班组'
    return false
  }
  const missingAmount = selectedRows.value.filter((row) => !Number.isFinite(amountById.value[Number(row.id)]) || amountById.value[Number(row.id)] <= 0)
  if (missingAmount.length) {
    batchError.value = `还有 ${missingAmount.length} 格没填污物量：${missingAmount.map((row) => row['清污编号']).join('、')}`
    return false
  }
  const missingCleaner = selectedRows.value.filter((row) => !(cleanerById.value[Number(row.id)] ?? '').trim())
  if (missingCleaner.length) {
    batchError.value = `还有 ${missingCleaner.length} 格没填清污人：${missingCleaner.map((row) => row['清污编号']).join('、')}`
    return false
  }
  batchError.value = ''
  return true
}

function submitNormal() {
  if (!validateBeforeSubmit()) {
    return
  }
  const data = submitScreenBatch({ items: collectItems(), crew: crew.value.trim(), mode: '普通批次' })
  receipt.value = { data, message: data.message, crew: crew.value.trim(), concurrent: false }
  afterSubmitted()
}

function submitConcurrent() {
  if (!validateBeforeSubmit()) {
    return
  }
  if (!otherCrew.value.trim() || otherCrew.value.trim() === crew.value.trim()) {
    batchError.value = '并发演练需要另一个不同的班组名'
    return
  }
  const items = collectItems()
  const { first, second } = simulateConcurrentSubmit({ items, crewA: crew.value.trim(), crewB: otherCrew.value.trim() })
  // 主回执展示先到班组的完整结果；被挡的后到批次并入 blocked 区，标明是后到班组被挡。
  const merged: ScreenBatchResult = {
    ...first,
    message: `只入账先到的「${first.crew}」：${first.accepted.length} 条进；后到的「${second.crew}」${second.blocked.length} 条全被挡。`,
    blocked: [
      ...first.blocked,
      ...second.blocked.map((line) => ({ ...line, reason: `后到班组「${second.crew}」：${line.reason}` })),
    ],
  }
  receipt.value = { data: merged, message: merged.message, crew: first.crew, otherCrew: second.crew, concurrent: true }
  afterSubmitted()
}

function afterSubmitted() {
  selectedIds.value = []
  amountById.value = {}
  cleanerById.value = {}
  bulkAmount.value = null
  bulkCleaner.value = ''
  candidates.value = screenCandidates()
  reload()
}

function closeReceipt() {
  receipt.value = null
}

onMounted(reload)
</script>
