import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：格栅清污批量登记改造后播种了新的字段与状态，换 key 让老数据自动重新播种。
const STORAGE_KEY = 'drainage-pump:entries:v2'
const COUNTER_KEY = 'drainage-pump:counters:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 业务自增号：跨模块的清淤联动记录等需要在现有最大号之后续号。
export function nextSeq(key: string, seed: number = 1): number {
  const counters = readCounters()
  const current = counters[key] ?? seed
  counters[key] = current + 1
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(COUNTER_KEY, JSON.stringify(counters))
  }
  return current
}

function readCounters(): Record<string, number> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(COUNTER_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {}
  }
}

// 跨标签页并发：另一个标签（另一个班组）提交后，这里让内存缓存失效，
// 后续读取拿到最新数据；乐观版本号则决定「只入账先到的那一批」。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}
