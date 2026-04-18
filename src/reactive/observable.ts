/**
 * Observable<T> — 0.3.0 响应式数据层原语
 *
 * 设计目标:
 *   - bundle size ≤ 3KB gzipped(不引入 rxjs)
 *   - 语义与 Kotlin StateFlow / Swift AsyncStream 对齐
 *   - 零依赖
 *
 * 语义约定:
 *   - 只实现 "hot" 流(BehaviorSubject 语义):新订阅者立即收到当前值
 *   - emit 顺序严格,背压策略 = 最新覆盖(IM 场景合适)
 *   - unsubscribe 幂等,多次调用无副作用
 *
 * 不做什么:
 *   - 不做 rxjs 全集(Subject 以外的各种高级操作符)
 *   - 不做 cold observable(所有流一经创建即 hot)
 *   - 不做错误信道(错误走 client.events.error 总线)
 */

export interface Subscription {
  unsubscribe(): void
  readonly closed: boolean
}

export interface Observer<T> {
  next?: (value: T) => void
  error?: (err: Error) => void
  complete?: () => void
}

export type Subscribable<T> = Observer<T> | ((value: T) => void)

export interface Observable<T> {
  subscribe(observer: Subscribable<T>): Subscription
  /** BehaviorSubject 语义:当前值(订阅时立即收到) */
  readonly value: T
  /** 操作符:映射 */
  map<U>(fn: (value: T) => U): Observable<U>
  /** 操作符:过滤(谓词为 false 的值不发射) */
  filter(predicate: (value: T) => boolean): Observable<T>
  /** 操作符:值变化才发射(浅比较) */
  distinctUntilChanged(compare?: (a: T, b: T) => boolean): Observable<T>
}

// ─── 实现 ──────────────────────────────────────────────────────────

type Listener<T> = (value: T) => void

/**
 * BehaviorSubject<T> — 带当前值的 Observable
 * SDK 内部使用,对外一律以 Observable<T> 类型暴露(readonly)
 */
export class BehaviorSubject<T> implements Observable<T> {
  private _value: T
  private _listeners = new Set<Listener<T>>()
  private _completed = false

  constructor(initial: T) {
    this._value = initial
  }

  get value(): T {
    return this._value
  }

  /** 内部 API:推送新值 */
  next(value: T): void {
    if (this._completed) return
    this._value = value
    // 快照一份,防止订阅者在回调里修改 _listeners 导致 iterator 异常
    for (const listener of Array.from(this._listeners)) {
      try {
        listener(value)
      } catch (err) {
        // 静默吞掉订阅者抛出的异常,避免一个坏订阅者污染整个广播
        // eslint-disable-next-line no-console
        console.error('[Observable] subscriber threw:', err)
      }
    }
  }

  /** 内部 API:终结流(之后不再发射,但已有订阅者仍持有最后一个值) */
  complete(): void {
    this._completed = true
    this._listeners.clear()
  }

  subscribe(observer: Subscribable<T>): Subscription {
    const listener: Listener<T> =
      typeof observer === 'function' ? observer : observer.next ?? (() => {})

    // 新订阅者立即收到当前值(BehaviorSubject 语义)
    try {
      listener(this._value)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Observable] initial emit threw:', err)
    }

    if (this._completed) {
      return { unsubscribe: () => {}, get closed() { return true } }
    }

    this._listeners.add(listener)

    let closed = false
    return {
      unsubscribe: () => {
        if (closed) return
        closed = true
        this._listeners.delete(listener)
      },
      get closed() {
        return closed
      },
    }
  }

  map<U>(fn: (value: T) => U): Observable<U> {
    return derive(this, fn)
  }

  filter(predicate: (value: T) => boolean): Observable<T> {
    const sub = new BehaviorSubject<T>(this._value)
    // 初始值不满足谓词时,sub 的 value 仍是上游初值(妥协);UI 订阅时自己处理
    this.subscribe((v) => {
      if (predicate(v)) sub.next(v)
    })
    return sub
  }

  distinctUntilChanged(compare?: (a: T, b: T) => boolean): Observable<T> {
    const eq = compare ?? ((a, b) => a === b)
    const sub = new BehaviorSubject<T>(this._value)
    let last = this._value
    this.subscribe((v) => {
      if (!eq(last, v)) {
        last = v
        sub.next(v)
      }
    })
    return sub
  }
}

/** 派生:map 的轻量实现(不额外保留多份订阅关系) */
function derive<T, U>(source: Observable<T>, fn: (v: T) => U): Observable<U> {
  const sub = new BehaviorSubject<U>(fn(source.value))
  source.subscribe((v) => sub.next(fn(v)))
  return sub
}

/**
 * 工厂:创建 read-only Observable 视图
 * SDK 内部保留 BehaviorSubject 句柄,仅向外暴露 asObservable 结果
 */
export function asObservable<T>(subject: BehaviorSubject<T>): Observable<T> {
  return {
    get value() {
      return subject.value
    },
    subscribe: (observer) => subject.subscribe(observer),
    map: (fn) => subject.map(fn),
    filter: (pred) => subject.filter(pred),
    distinctUntilChanged: (cmp) => subject.distinctUntilChanged(cmp),
  }
}

/**
 * 工厂:组合多个 Observable,任一发射时重新计算
 * combineLatest([a, b, c], (va, vb, vc) => ...)
 */
export function combineLatest<A, B, R>(
  sources: [Observable<A>, Observable<B>],
  combiner: (a: A, b: B) => R
): Observable<R>
export function combineLatest<A, B, C, R>(
  sources: [Observable<A>, Observable<B>, Observable<C>],
  combiner: (a: A, b: B, c: C) => R
): Observable<R>
export function combineLatest(
  sources: Observable<unknown>[],
  combiner: (...values: unknown[]) => unknown
): Observable<unknown> {
  const initial = combiner(...sources.map((s) => s.value))
  const out = new BehaviorSubject<unknown>(initial)
  for (const s of sources) {
    s.subscribe(() => {
      out.next(combiner(...sources.map((src) => src.value)))
    })
  }
  return out
}
