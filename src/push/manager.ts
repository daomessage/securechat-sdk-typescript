import { HttpClient } from '../http'

export class PushModule {
  private http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  /**
   * 浏览器申请推送凭证并向服务端注册
   * 此方法需要依赖浏览器的 ServiceWorker API，仅在 Web 端有效
   */
  public async enablePushNotifications(swRegistration: ServiceWorkerRegistration, vapidPublicKey?: string): Promise<void> {
    if (!swRegistration || !swRegistration.pushManager) {
      throw new Error('Push manager unavailable')
    }

    try {
      // 1. 获取 VAPID 公钥
      let key = vapidPublicKey;
      if (!key) {
        const vapidResp = await this.http.get<{vapid_public_key: string}>('/api/v1/push/vapid-key')
        if (!vapidResp || !vapidResp.vapid_public_key) {
          throw new Error('Server did not return VAPID key')
        }
        key = vapidResp.vapid_public_key
      }

      // 2. 注册 PushSubscription
      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(key)
      })

      const pushSub = subscription.toJSON()

      // 3. 向服务端注册 endpoint 和 keys
      await this.http.post('/api/v1/push/subscribe', {
        endpoint: pushSub.endpoint,
        keys: {
          p256dh: pushSub.keys?.p256dh,
          auth: pushSub.keys?.auth
        }
      })
      console.log('[SDK PushModule] Push subscription activated.')
    } catch (e: any) {
      console.warn('[SDK PushModule] Failed to enable push notifications', e)
      throw e
    }
  }

  private urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/')

    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }
}
