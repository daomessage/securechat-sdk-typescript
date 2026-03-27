/**
 * security/index.ts — SecurityModule（P3-004 修复）
 *
 * 实现文档 §2.2.1 SecurityModule 接口设计：
 *   - getSecurityCode(contactId)        → 60位安全码（MITM 防御）
 *   - verifyInputCode(contactId, code)  → 输入验证（主路径）
 *   - markAsVerified(contactId)         → 手动标记已验证（辅助路径）
 *   - getTrustState(contactId)          → 信任状态
 *   - resetTrustState(contactId)        → 重置信任
 *
 * 所有状态存储于 IndexedDB（服务器完全不知情）
 * 防劫持守护：每条消息触发前调用 guardMessage() 检测公钥突变
 */

import { computeSecurityCode, toHex } from '../keys/index'

// ─── 类型定义 ──────────────────────────────────────────────────

export interface SecurityCode {
  contactId: string
  /** 60 位十六进制字符串，每 4 字符一组，如 "AB12 · F39C · ..." */
  displayCode: string
  /** 原始 hex（用于 verifyInputCode 内部比对）*/
  fingerprintHex: string
}

export type TrustState =
  | { status: 'unverified' }
  | {
      status: 'verified'
      verifiedAt: number        // Unix timestamp (ms)
      fingerprintSnapshot: string
    }

export interface SecurityViolationEvent {
  type: 'security_violation'
  contactId: string
  previousFingerprint: string
  currentFingerprint: string
  detectedAt: number
  message: null
}

// ─── IndexedDB 存储键 ──────────────────────────────────────────

const DB_NAME = 'securechat_security'
const STORE   = 'trust'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'contactId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function dbGet(contactId: string): Promise<any> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(contactId)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function dbPut(record: object): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(record)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

async function dbDelete(contactId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(contactId)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// ─── SecurityModule ────────────────────────────────────────────

export class SecurityModule {
  /**
   * 获取与指定联系人的安全码（60 位 hex 字符串）
   * 每次加好友后全自动生成，UI 打开"加密详情"页时调用
   */
  async getSecurityCode(
    contactId: string,
    myEcdhPublicKey: Uint8Array,
    theirEcdhPublicKey: Uint8Array
  ): Promise<SecurityCode> {
    const fingerprintHex = computeSecurityCode(myEcdhPublicKey, theirEcdhPublicKey)
    // 每 4 字符加空格（UI 展示格式）
    const displayCode = fingerprintHex.replace(/(.{4})/g, '$1 ').trim()
    return { contactId, displayCode, fingerprintHex }
  }

  /**
   * 输入验证（主路径）：
   * 用户粘贴对方通过微信/TG 发来的 60 位安全码，SDK 自动与本地计算值比对
   * 返回 true → 一致（无 MITM）→ 自动写入 verified
   * 返回 false → 不一致（公钥被篡改）
   */
  async verifyInputCode(
    contactId: string,
    inputCode: string,
    myEcdhPublicKey: Uint8Array,
    theirEcdhPublicKey: Uint8Array
  ): Promise<boolean> {
    const normalizedInput = inputCode.replace(/\s/g, '')
    const localFingerprint = computeSecurityCode(myEcdhPublicKey, theirEcdhPublicKey)
    if (normalizedInput !== localFingerprint) {
      return false
    }
    // 一致 → 自动写入 verified（文档 §2.2 流程图二）
    await dbPut({
      contactId,
      status: 'verified',
      verifiedAt: Date.now(),
      fingerprintSnapshot: localFingerprint,
    })
    return true
  }

  /**
   * 手动标记为"已验证"（辅助路径）：
   * 用户通过截图肉眼比对后，手动点击按钮调用此方法
   * 服务器完全不知情（存储于 IndexedDB）
   */
  async markAsVerified(
    contactId: string,
    myEcdhPublicKey: Uint8Array,
    theirEcdhPublicKey: Uint8Array
  ): Promise<void> {
    const fingerprintSnapshot = computeSecurityCode(myEcdhPublicKey, theirEcdhPublicKey)
    await dbPut({
      contactId,
      status: 'verified',
      verifiedAt: Date.now(),
      fingerprintSnapshot,
    })
  }

  /**
   * 获取指定联系人当前的信任状态
   */
  async getTrustState(contactId: string): Promise<TrustState> {
    const rec = await dbGet(contactId)
    if (!rec || rec.status !== 'verified') {
      return { status: 'unverified' }
    }
    return {
      status: 'verified',
      verifiedAt: rec.verifiedAt,
      fingerprintSnapshot: rec.fingerprintSnapshot,
    }
  }

  /**
   * 重置验证状态：将 trust_state 还原为 'unverified'
   * 场景：用户主动换设备/助记词后需重新核查
   */
  async resetTrustState(contactId: string): Promise<void> {
    await dbDelete(contactId)
  }

  /**
   * 防劫持守护（文档 §2.2 流程图三）：
   * 每条消息到达时自动调用，若检测到公钥突变，返回 SecurityViolationEvent
   *
   * @returns null  → 验证通过，可正常解密
   * @returns SecurityViolationEvent → 公钥突变，拒绝解密并上报 UI
   */
  async guardMessage(
    contactId: string,
    currentMyEcdh: Uint8Array,
    currentTheirEcdh: Uint8Array
  ): Promise<SecurityViolationEvent | null> {
    const trustState = await this.getTrustState(contactId)
    if (trustState.status !== 'verified') {
      // 从未验证过，正常解密（UI 顶栏显示 ⚠️ 未验证）
      return null
    }
    const currentFingerprint = computeSecurityCode(currentMyEcdh, currentTheirEcdh)
    if (currentFingerprint === trustState.fingerprintSnapshot) {
      return null // 一致，安全
    }
    // ❌ 公钥突变 → 立即挂断解密通道
    return {
      type: 'security_violation',
      contactId,
      previousFingerprint: trustState.fingerprintSnapshot,
      currentFingerprint,
      detectedAt: Date.now(),
      message: null,
    }
  }
}

export const securityModule = new SecurityModule()
