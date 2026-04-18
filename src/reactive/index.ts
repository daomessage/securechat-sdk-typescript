/**
 * src/reactive — 0.3.0 响应式基建
 *
 * 公共入口:只导出 Observable / Subscription 类型,
 * BehaviorSubject 留给 SDK 内部模块使用(不对外暴露 next/complete)。
 */

export type {
  Observable,
  Observer,
  Subscribable,
  Subscription,
} from './observable'

// BehaviorSubject 只在 SDK 内部使用
export { BehaviorSubject, asObservable, combineLatest } from './observable'
