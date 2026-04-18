/**
 * src/security/module.ts — 0.4.0 SecurityModule(响应式)
 *
 * 底层 security/index.ts 里的 SecurityModule(命令式)保留不动,
 * 本文件把它包装成响应式 ContactTrust 流。
 *
 * 重命名:对外类名用 SecurityService 避免与底层 SecurityModule 同名冲突。
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type {
  SecurityModule as LowSecurityModule,
  TrustState,
  SecurityCode,
} from './index'

export class SecurityService {
  private _states = new Map<string, BehaviorSubject<TrustState>>()

  constructor(private readonly inner: LowSecurityModule) {}

  // ─── 观察式 ─────────────────────────────────────────

  observeTrust(contactId: string): Observable<TrustState> {
    let subject = this._states.get(contactId)
    if (!subject) {
      subject = new BehaviorSubject<TrustState>({ status: 'unverified' })
      this._states.set(contactId, subject)
      void this._loadTrust(contactId)
    }
    return asObservable(subject)
  }

  // ─── 命令式 ─────────────────────────────────────────

  async getTrust(contactId: string): Promise<TrustState> {
    return this.inner.getTrustState(contactId)
  }

  async getSafetyCode(
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

  async verifyCode(
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
    if (ok) await this._emitCurrent(contactId)
    return ok
  }

  async markVerified(
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

  async reset(contactId: string): Promise<void> {
    await this.inner.resetTrustState(contactId)
    await this._emitCurrent(contactId)
  }

  // ─── 内部 ──────────────────────────────────────────

  private async _loadTrust(contactId: string): Promise<void> {
    try {
      const state = await this.inner.getTrustState(contactId)
      const subject = this._states.get(contactId)
      if (subject) subject.next(state)
    } catch {
      /* keep default unverified */
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
