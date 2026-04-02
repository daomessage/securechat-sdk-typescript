import { WSTransport } from './index'

export type NetworkState = 'connected' | 'connecting' | 'disconnected'
type NetworkListener = (state: NetworkState) => void

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const HEARTBEAT_INTERVAL_MS = 25000

export class RobustWSTransport implements WSTransport {
  private ws: WebSocket | null = null
  public isConnected = false

  private messageHandlers: ((data: string) => void)[] = []
  private openHandlers: (() => void)[] = []
  private closeHandlers: (() => void)[] = []
  private networkListeners: NetworkListener[] = []
  private goawayListeners: ((reason: string) => void)[] = []

  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private intentionalClose = false
  public lastUrl = ''

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (!this.isConnected && this.lastUrl) {
          this.reconnectAttempts = 0
          this._doConnect()
        }
      })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.isConnected && this.lastUrl) {
          this.reconnectAttempts = 0
          this._doConnect()
        }
      })
    }
  }

  onNetworkStateChange(fn: NetworkListener) {
    this.networkListeners.push(fn)
    return () => {
      const idx = this.networkListeners.indexOf(fn)
      if (idx >= 0) this.networkListeners.splice(idx, 1)
    }
  }

  /** 监听 GOAWAY 帧（被其他设备踢下线） */
  onGoaway(fn: (reason: string) => void) {
    this.goawayListeners.push(fn)
    return () => {
      const idx = this.goawayListeners.indexOf(fn)
      if (idx >= 0) this.goawayListeners.splice(idx, 1)
    }
  }

  private emitNetworkState(state: NetworkState) {
    this.networkListeners.forEach(fn => fn(state))
  }

  connect(url: string) {
    this.lastUrl = url
    this.intentionalClose = false
    this._doConnect()
  }

  private _doConnect() {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      try { this.ws.close() } catch { /* ignore */ }
    }

    this.emitNetworkState('connecting')

    this.ws = new WebSocket(this.lastUrl)

    this.ws.onopen = () => {
      this.isConnected = true
      this.reconnectAttempts = 0
      this.emitNetworkState('connected')
      this.openHandlers.forEach(h => h())
      this._startHeartbeat()
    }

    this.ws.onmessage = (e) => {
      // 拦截 goaway 帧：停止重连 + 通知上层
      try {
        const parsed = JSON.parse(e.data)
        if (parsed.type === 'goaway') {
          const reason = parsed.payload?.reason || parsed.reason || 'unknown'
          console.warn('[SDK] GOAWAY received:', reason)
          this.intentionalClose = true  // 阻止自动重连
          this.goawayListeners.forEach(fn => fn(reason))
          this.disconnect()
          return
        }
      } catch { /* 非 JSON 或无 type 字段，继续正常处理 */ }
      this.messageHandlers.forEach(h => h(e.data))
    }

    this.ws.onclose = (event) => {
      this.isConnected = false
      this._stopHeartbeat()
      this.closeHandlers.forEach(h => h())

      if (this.intentionalClose) {
        this.emitNetworkState('disconnected')
        return
      }

      this.emitNetworkState('disconnected')
      this._scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onerror is always followed by onclose where reconnect logic sits
    }
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    )
    const jitter = delay * (0.7 + Math.random() * 0.3)

    this.emitNetworkState('connecting')

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAttempts++
      this._doConnect()
    }, jitter)
  }

  private _startHeartbeat() {
    this._stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    }
    // Note: Outbox logic will be handled by the MessageModule / Client, 
    // since it involves encrypting, fetching seq, and updating IndexedDB.
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandlers.push(handler)
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler)
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler)
  }

  disconnect() {
    this.intentionalClose = true
    this._stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isConnected = false
    this.emitNetworkState('disconnected')
  }
}
