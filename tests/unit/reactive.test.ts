import { describe, it, expect, vi } from 'vitest'
import {
  BehaviorSubject,
  asObservable,
  combineLatest,
  type Observable,
} from '../../src/reactive'

describe('reactive · BehaviorSubject', () => {
  it('立即向新订阅者发射当前值', () => {
    const sub = new BehaviorSubject(42)
    const spy = vi.fn()
    sub.subscribe(spy)
    expect(spy).toHaveBeenCalledWith(42)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('next 后所有订阅者收到新值', () => {
    const sub = new BehaviorSubject(0)
    const a = vi.fn()
    const b = vi.fn()
    sub.subscribe(a)
    sub.subscribe(b)
    sub.next(1)
    sub.next(2)
    // 初始值 + 两次 next
    expect(a).toHaveBeenCalledTimes(3)
    expect(b).toHaveBeenCalledTimes(3)
    expect(sub.value).toBe(2)
  })

  it('unsubscribe 后不再收到值,且幂等', () => {
    const sub = new BehaviorSubject(0)
    const spy = vi.fn()
    const s = sub.subscribe(spy)
    s.unsubscribe()
    s.unsubscribe() // 二次调用应无副作用
    sub.next(1)
    expect(spy).toHaveBeenCalledTimes(1) // 只有初始值那次
    expect(s.closed).toBe(true)
  })

  it('complete 后不再向已有订阅者发射', () => {
    const sub = new BehaviorSubject(0)
    const spy = vi.fn()
    sub.subscribe(spy)
    sub.complete()
    sub.next(1)
    expect(spy).toHaveBeenCalledTimes(1) // 只有初始值那次
  })

  it('订阅者抛异常不影响其他订阅者', () => {
    const sub = new BehaviorSubject(0)
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn()
    sub.subscribe(bad)
    sub.subscribe(good)
    sub.next(1)
    expect(good).toHaveBeenCalledWith(0)
    expect(good).toHaveBeenCalledWith(1)
  })

  it('支持 Observer 对象形式', () => {
    const sub = new BehaviorSubject(0)
    const spy = vi.fn()
    sub.subscribe({ next: spy })
    sub.next(5)
    expect(spy).toHaveBeenCalledWith(0)
    expect(spy).toHaveBeenCalledWith(5)
  })
})

describe('reactive · operators', () => {
  it('map 派生新流', () => {
    const sub = new BehaviorSubject(2)
    const doubled = sub.map((v) => v * 2)
    expect(doubled.value).toBe(4)
    const spy = vi.fn()
    doubled.subscribe(spy)
    sub.next(5)
    expect(doubled.value).toBe(10)
    expect(spy).toHaveBeenCalledWith(4)
    expect(spy).toHaveBeenCalledWith(10)
  })

  it('filter 只对满足谓词的值发射', () => {
    const sub = new BehaviorSubject(0)
    const evens = sub.filter((v) => v % 2 === 0)
    const spy = vi.fn()
    evens.subscribe(spy)
    spy.mockClear()
    sub.next(1)
    sub.next(2)
    sub.next(3)
    sub.next(4)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(1, 2)
    expect(spy).toHaveBeenNthCalledWith(2, 4)
  })

  it('distinctUntilChanged 去重', () => {
    const sub = new BehaviorSubject(0)
    const distinct = sub.distinctUntilChanged()
    const spy = vi.fn()
    distinct.subscribe(spy)
    spy.mockClear()
    sub.next(0) // 和上次一样
    sub.next(1)
    sub.next(1)
    sub.next(2)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenNthCalledWith(1, 1)
    expect(spy).toHaveBeenNthCalledWith(2, 2)
  })
})

describe('reactive · asObservable', () => {
  it('暴露 Observable 接口,隐藏 next/complete', () => {
    const sub = new BehaviorSubject(0)
    const obs: Observable<number> = asObservable(sub)
    expect(obs.value).toBe(0)
    // @ts-expect-error 运行时没有 next 方法
    expect(obs.next).toBeUndefined()
    const spy = vi.fn()
    obs.subscribe(spy)
    sub.next(1)
    expect(spy).toHaveBeenCalledWith(1)
  })
})

describe('reactive · combineLatest', () => {
  it('组合两个流,任一变化时重算', () => {
    const a = new BehaviorSubject(1)
    const b = new BehaviorSubject(10)
    const sum = combineLatest([a, b], (x, y) => x + y)
    expect(sum.value).toBe(11)
    const spy = vi.fn()
    sum.subscribe(spy)
    spy.mockClear()
    a.next(2)
    expect(sum.value).toBe(12)
    expect(spy).toHaveBeenCalledWith(12)
    b.next(20)
    expect(sum.value).toBe(22)
    expect(spy).toHaveBeenCalledWith(22)
  })

  it('组合三个流', () => {
    const a = new BehaviorSubject(1)
    const b = new BehaviorSubject(2)
    const c = new BehaviorSubject(3)
    const product = combineLatest([a, b, c], (x, y, z) => x * y * z)
    expect(product.value).toBe(6)
    a.next(10)
    expect(product.value).toBe(60)
  })
})
