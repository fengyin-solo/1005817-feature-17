/**
 * 格栅清污批量登记规则验证（无浏览器，内存数据层）。
 * 运行：npx tsx scripts/batch-rules.test.ts
 */
import assert from 'node:assert/strict'

import { resetModule } from '../src/api/local-service'
import {
  listDredgeReviewTasks,
  listReviewQueue,
  resetBatchState,
  resolveReview,
  routeOverLimitToReview,
  selectCandidates,
  submitCleanBatch,
} from '../src/data/batch-service'
import { listRows } from '../src/data/local-store'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function reset() {
  resetModule('screen')
  resetBatchState()
}

function screenStatus(id: number) {
  return String(listRows('screen').find((r) => Number(r.id) === id)?.status)
}
function screenField(id: number, field: string) {
  return listRows('screen').find((r) => Number(r.id) === id)?.[field]
}

console.log('① 圈号：按泵站 + 格栅类型，只圈待清污')
reset()
const chengdongCoarse = selectCandidates('城东雨水泵站', '粗格栅').map((c) => c.id)
check('城东雨水泵站粗格栅只圈到 1、2（细格栅3、非城东的格不进圈）', () => {
  assert.deepEqual(chengdongCoarse, [1, 2])
})
check('已完工/清污中的格不参与圈号', () => {
  const all = selectCandidates('', '')
  assert.ok(!all.some((c) => [9, 10].includes(c.id)))
})

console.log('② 普通批次提交：待清污→已完工，清淤侧按班组挂待复核活')
reset()
{
  const result = submitCleanBatch('甲班', [
    { id: 1, 污物量: '1.5', 清污人: '张志强' },
    { id: 2, 污物量: '2.0', 清污人: '张志强' },
  ])
  check('2 格全部入账', () => assert.equal(result.postedCount, 2))
  check('状态转已完工', () => {
    assert.equal(screenStatus(1), '已完工')
    assert.equal(screenStatus(2), '已完工')
    assert.equal(screenField(1, '清污人'), '张志强')
  })
  const tasks = listDredgeReviewTasks('甲班')
  check('甲班清淤侧出现 2 笔待复核活', () => assert.equal(tasks.length, 2))
  check('乙班清淤侧看不到甲班的活', () => assert.equal(listDredgeReviewTasks('乙班').length, 0))
  check('每笔活都标了来源清污编号与批次号', () => {
    assert.ok(tasks.every((t) => t.来源清污编号 && t.来源批次号 && t.状态 === '待复核'))
  })
}

console.log('③ 重复框到只算一次，重复条逐条回执不丢弃')
reset()
{
  const result = submitCleanBatch('甲班', [
    { id: 1, 污物量: '1.5', 清污人: '张志强' },
    { id: 1, 污物量: '1.5', 清污人: '张志强' },
    { id: 2, 污物量: '2.0', 清污人: '刘芳' },
  ])
  check('实际入账 2 格（重复的1只算一次）', () => assert.equal(result.postedCount, 2))
  const dup = result.blocked.filter((r) => r.kind === 'duplicate')
  check('重复条出现在被挡回执里，写明只按第一次入账', () => {
    assert.equal(dup.length, 1)
    assert.equal(dup[0].id, 1)
    assert.match(dup[0].message, /重复框选/)
  })
  check('甲班清淤活仍然只有 2 笔，没有重复挂账', () => {
    assert.equal(listDredgeReviewTasks('甲班').length, 2)
  })
}

console.log('④ 超限格不许混在普通批次，单独转复核')
reset()
{
  // id=4 实测 7.4 > 5，故意放进普通批次
  const result = submitCleanBatch('甲班', [
    { id: 4, 污物量: '7.4', 清污人: '张志强' },
    { id: 5, 污物量: '3.1', 清污人: '张志强' },
  ])
  check('5 入账、4 被挡（over-limit）', () => {
    assert.equal(result.postedCount, 1)
    const over = result.blocked.find((r) => r.id === 4)
    assert.ok(over)
    assert.equal(over.kind, 'over-limit')
    assert.match(over.message, /超过单格上限/)
  })
  check('4 仍待清污、5 已完工', () => {
    assert.equal(screenStatus(4), '待清污')
    assert.equal(screenStatus(5), '已完工')
  })
  const routed = routeOverLimitToReview('甲班', [{ id: 4, 污物量: '7.4', 清污人: '张志强' }])
  check('单独转复核成功，4 进入复核队列且状态为待复核', () => {
    assert.equal(routed.routed.length, 1)
    assert.equal(listReviewQueue().length, 1)
    assert.equal(screenStatus(4), '待复核')
  })
  check('复核中的格再走普通批次 → reviewing 挡下', () => {
    const again = submitCleanBatch('乙班', [{ id: 4, 污物量: '7.4', 清污人: '王磊' }])
    assert.equal(again.postedCount, 0)
    assert.equal(again.blocked[0].kind, 'reviewing')
  })
  const passedReview = resolveReview(4, true, '甲班')
  check('复核通过 → 已完工 + 给甲班清淤挂活', () => {
    assert.equal(passedReview.ok, true)
    assert.equal(screenStatus(4), '已完工')
    assert.equal(listReviewQueue().length, 0)
    const jia = listDredgeReviewTasks('甲班')
    assert.equal(jia.length, 2) // 5 入账 1 笔 + 4 复核通过 1 笔
  })
}

console.log('⑤ 复核退回 → 回到待清污并释放锁')
reset()
{
  routeOverLimitToReview('甲班', [{ id: 8, 污物量: '9.3', 清污人: '张志强' }])
  const back = resolveReview(8, false, '甲班')
  check('退回成功，状态回待清污，复核队列清空', () => {
    assert.equal(back.ok, true)
    assert.equal(screenStatus(8), '待清污')
    assert.equal(listReviewQueue().length, 0)
  })
  check('释放锁后甲班可用更正后的污物量重新登记', () => {
    const result = submitCleanBatch('甲班', [{ id: 8, 污物量: '4.0', 清污人: '张志强' }])
    assert.equal(result.postedCount, 1)
    assert.equal(screenStatus(8), '已完工')
  })
}

console.log('⑥ 两个班组同时提交同一批清污，只入账先到的那一批')
reset()
{
  const batch = [1, 2, 3].map((id) => ({ id, 污物量: '1.0', 清污人: '甲班组员' }))
  // 甲班先到、乙班后到（同一时刻提交的同步裁决）
  const first = submitCleanBatch('甲班', batch)
  const second = submitCleanBatch('乙班', batch.map((b) => ({ ...b, 清污人: '乙班组员' })))
  check('先到批次 3 格全入账', () => assert.equal(first.postedCount, 3))
  check('后到批次 0 格入账', () => assert.equal(second.postedCount, 0))
  check('后到批次每格都是 conflict 回执，写明先到班组与批次号', () => {
    assert.equal(second.blocked.length, 3)
    assert.ok(second.blocked.every((r) => r.kind === 'conflict'))
    assert.ok(second.blocked.every((r) => r.ownerTeam === '甲班' && r.ownerBatchNo === first.batchNo))
    assert.match(second.blocked[0].message, /抢先入账/)
  })
  check('记录上只留甲班的清污人，乙班没覆盖', () => {
    assert.equal(screenField(1, '清污人'), '甲班组员')
  })
  check('清淤侧只挂甲班 3 笔，乙班 0 笔', () => {
    assert.equal(listDredgeReviewTasks('甲班').length, 3)
    assert.equal(listDredgeReviewTasks('乙班').length, 0)
  })
}

console.log('⑦ 部分重叠：后到批次只入账先到批次没圈到的格')
reset()
{
  submitCleanBatch('甲班', [
    { id: 1, 污物量: '1.0', 清污人: '甲' },
    { id: 2, 污物量: '1.0', 清污人: '甲' },
  ])
  const second = submitCleanBatch('乙班', [
    { id: 2, 污物量: '1.0', 清污人: '乙' },
    { id: 3, 污物量: '0.8', 清污人: '乙' },
  ])
  check('2 被挡、3 入账（逐格裁决，不整批丢弃）', () => {
    assert.equal(second.postedCount, 1)
    assert.equal(second.posted[0].id, 3)
    assert.equal(second.blocked[0].kind, 'conflict')
  })
}

console.log('⑧ 信息不全 / 编号不存在 / 状态不符的格逐条挡下')
reset()
{
  const result = submitCleanBatch('甲班', [
    { id: 1, 污物量: '', 清污人: '张志强' }, // 无污物量
    { id: 2, 污物量: '2.0', 清污人: '' }, // 无清污人
    { id: 999, 污物量: '1.0', 清污人: '张志强' }, // 缺号
    { id: 9, 污物量: '1.0', 清污人: '张志强' }, // 清污中
    { id: 10, 污物量: '1.0', 清污人: '张志强' }, // 已完工
  ])
  check('没有一格被静默入账', () => assert.equal(result.postedCount, 0))
  check('5 条全部有回执且原因分明', () => {
    assert.equal(result.blockedCount, 5)
    const kinds = result.blocked.map((r) => r.kind).sort()
    assert.deepEqual(kinds, ['invalid', 'invalid', 'missing', 'not-pending', 'not-pending'])
  })
  check('被挡格状态未被改动', () => {
    assert.equal(screenStatus(1), '待清污')
    assert.equal(screenStatus(9), '清污中')
    assert.equal(screenStatus(10), '已完工')
  })
}

console.log(`\n全部 ${passed} 项检查通过`)
