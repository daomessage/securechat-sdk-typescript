/**
 * src/security/reactive-security.ts — 0.3.0 Security 响应式封装
 *
 * 对 SecurityModule 的轻封装:
 *   - observeTrustState(contactId): 返回 Observable<TrustState>
 *   - 写操作(markAsVerified / resetTrustState) 自动触发对应 observer emit
 *
 * 公钥参数类型与 SecurityModule 对齐:Uint8Array
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type { SecurityModule, TrustState, SecurityCode } from './index'

export class ReactiveSecurityModule {
  private _states = new Map<string, BehaviorSubject<TrustState>>()

  constructor(private readonly inner: SecurityModule) {}

  // ─── 对外 API ────────────────────────────────────────────────────

  /**
   * 订阅某个联系人的信任状态流
   */
  observeTrustState(contactId: string): Observable<TrustState> {
    let subject = this._states.get(contactId)
    if (!subject) {
      subject = new BehaviorSubject<TrustState>({ status: 'unverified' })
      this._states.set(contactId, subject)
      void this._loadTrustState(contactId)
    }
    return asObservable(subject)
  }

  /** 读一次当前信任状态 */
  async getTrustState(contactId: string): Promise<TrustState> {
    return this.inner.getTrustState(contactId)
  }

  /** 生成安全码(60 位 hex) */
  async getSafetyNumber(
    contactId: string,
    myEcdhPublicKey: Uint8Array,
    theirEcdhPublicKey: Uint8Array
  ): Promise<SecurityCode> {
    return this.inner.getSecurityCode(
      contactId,
      myEcdhPublicKey,
      theirEcdhPublicKey
    )
  }

  /** 比较用户输入的安全码 · 匹配时自动 markAsVerified */
  async verifyInputCode(
    contactId: string,
    inputCode: string,
    myEcdhPublicKey: Uint8Array,
    theirEcdhPublicKey: Uint8Array
  ): Promise<boolean> {
    const ok = await this.inner.verifyInputCode(
      contactId,
      inputCode,
      myEcdhPublicKey,
      theirEcdhPublicKey
    )
    if (ok) {
      await this._emitCurrent(contactId)
    }
    return ok
  }

  /** 手动标记为已验证 */
  async markAsVerified(
    contactId: string,
    myEcdhPublicKey: Uint8Array,
    theirEcdhPublicKey: Uint8Array
  ): Promise<void> {
    await this.inner.markAsVerified(
      contactId,
      myEcdhPublicKey,
      theirEcdhPublicKey
    )
    await this._emitCurrent(contactId)
  }

  /** 重置为 unverified */
  async resetTrustState(contactId: string): Promise<void> {
    await this.inner.resetTrustState(contactId)
    await this._emitCurrent(contactId)
  }

  // ─── 内部 ───────────────────────────────────────────────────────

  private async _loadTrustState(contactId: string): Promise<void> {
    try {
      const state = await this.inner.getTrustState(contactId)
      const subject = this._states.get(contactId)
      if (subject) subject.next(state)
    } catch {
      // 忽略 · 保持默认 unverified
    }
  }

  private async _emitCurrent(contactId: string): Promise<void> {
    const state = await this.inner.getTrustState(contactId)
    const subject = this._states.get(contactId)
    if (subject) {
      subject.next(state)
    } else {
      const newSubject = new BehaviorSubject<TrustState>(state)
      this._states.set(contactId, newSubject)
    }
  }
}
