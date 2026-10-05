<template>
  <section class="page" data-module="dredge">
    <header class="page-head">
      <div>
        <h2>管网清淤管理</h2>
        <p class="page-desc">维护清淤记录；格栅清污批量完工后，按班组在下方生成「待复核」的清淤活，复核闭环后销项。</p>
      </div>
      <div class="page-actions">
        <label class="team-pick">
          当前班组
          <select v-model="team">
            <option v-for="item in teams" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <button class="btn" type="button" @click="exportRows">导出管网清淤清单</button>
      </div>
    </header>

    <!-- 格栅清污完工联动过来的待复核活 -->
    <div class="review-panel">
      <h3 class="panel-title">{{ team }} · 格栅清污联动待复核活（{{ pendingTasks.length }}）</h3>
      <table v-if="pendingTasks.length" class="data-table compact">
        <thead>
          <tr>
            <th>清淤编号</th>
            <th>来源清污编号</th>
            <th>所属泵站</th>
            <th>格栅类型</th>
            <th>污物量(m³)</th>
            <th>清污人</th>
            <th>完工时间</th>
            <th>来源批次</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in pendingTasks" :key="task.id">
            <td>{{ task.清淤编号 }}</td>
            <td>{{ task.来源清污编号 }}</td>
            <td>{{ task.所属泵站 }}</td>
            <td>{{ task.格栅类型 }}</td>
            <td>{{ task.污物量 }}</td>
            <td>{{ task.清污人 || '—' }}</td>
            <td>{{ task.完工时间 }}</td>
            <td>{{ task.来源批次号 }}</td>
            <td><span class="status-chip st-pending">待复核</span></td>
            <td><button class="link" type="button" @click="completeTask(task.id)">复核销项</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state inline">该班组暂无待复核的清淤活；格栅批量完工或超限复核通过后会自动挂到这里。</p>
      <p v-if="doneTasks.length" class="done-line">本班已复核销项 {{ doneTasks.length }} 笔。</p>
    </div>

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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无管网清淤数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管网清淤记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { completeDredgeReview, listDredgeReviewTasks } from '@/data/batch-service'
import type { CleanTeam, DredgeReviewTask } from '@/data/batch-types'
import type { EntryRow } from '@/data/types'

const teams: CleanTeam[] = ['甲班', '乙班', '丙班']
const team = ref<CleanTeam>('甲班')

const meta = moduleMeta('dredge')
const columns = ['清淤编号', '清淤管段', '淤积厚度', '清淤方式', '清淤班组', '清淤日期', '清淤量', '清淤状态']
const actions = ['提交清淤', '确认完工', '要求返工']
const statuses = ['待清淤', '清淤中', '已完工', '需返工']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const tasks = ref<DredgeReviewTask[]>([])
const pendingTasks = computed(() =>
  tasks.value.filter((task) => task.清淤班组 === team.value && task.状态 === '待复核'),
)
const doneTasks = computed(() =>
  tasks.value.filter((task) => task.清淤班组 === team.value && task.状态 === '已复核'),
)

const stats = computed(() => [
  { label: '待清淤管段', value: rows.value.filter((r) => String(r.status) === '待清淤').length },
  { label: '联动待复核活', value: pendingTasks.value.length },
  { label: '清淤中管段', value: rows.value.filter((r) => String(r.status) === '清淤中').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function completeTask(id: string) {
  errorMessage.value = ''
  const result = completeDredgeReview(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reloadTasks()
}

function reloadTasks() {
  tasks.value = listDredgeReviewTasks()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管网清淤列表读取失败'
  }
}

onMounted(() => {
  reloadTasks()
  reload()
})

// 切换班组时重新读取，确保从格栅页完工联动过来的活能立刻出现。
watch(team, reloadTasks)
</script>

<style scoped>
.team-pick { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.team-pick select { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.review-panel { background: #fff; border: 1px solid #b2ccff; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; }
.panel-title { margin: 0 0 10px; font-size: 14px; }
.data-table.compact th, .data-table.compact td { padding: 5px 8px; font-size: 12px; }
.empty-state.inline { padding: 12px; }
.status-chip { border-radius: 999px; padding: 1px 10px; font-size: 12px; }
.st-pending { background: #fef0c7; color: #b54708; }
.done-line { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
</style>
