import { HttpClient } from '../http'

export interface ChannelInfo {
  id: string
  alias_id?: string
  name: string
  description: string
  role?: string
  is_subscribed?: boolean
}

export interface ChannelPost {
  id: string
  type: string
  content: string
  created_at: string
  author_alias_id: string
}

export class ChannelsModule {
  constructor(private http: HttpClient) {}

  /**
   * Search for public channels
   */
  public async search(query: string): Promise<ChannelInfo[]> {
    if (!query.trim()) return []
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/channels/search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${this.http.getToken()}` },
    })
    if (!res.ok) throw new Error('Search failed')
    return ((await res.json()) || []) as ChannelInfo[]
  }

  /**
   * Get channels subscribed by current user
   */
  public async getMine(): Promise<ChannelInfo[]> {
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/channels/mine`, {
      headers: { Authorization: `Bearer ${this.http.getToken()}` },
    })
    if (!res.ok) throw new Error('Get mine failed')
    return ((await res.json()) || []) as ChannelInfo[]
  }

  /**
   * Get channel details
   */
  public async getDetail(channelId: string): Promise<ChannelInfo> {
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/channels/${channelId}`, {
      headers: { Authorization: `Bearer ${this.http.getToken()}` },
    })
    if (!res.ok) throw new Error('Get detail failed')
    return await res.json() as ChannelInfo
  }

  /**
   * Create a new channel
   */
  public async create(name: string, description: string, isPublic: boolean = true): Promise<{ channel_id: string }> {
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.http.getToken()}`,
      },
      body: JSON.stringify({ name, description, is_public: isPublic }),
    })
    if (!res.ok) throw new Error('Create failed')
    return await res.json()
  }

  /**
   * Subscribe to a channel
   */
  public async subscribe(channelId: string): Promise<void> {
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/channels/${channelId}/subscribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.http.getToken()}` },
    })
    if (!res.ok) throw new Error('Subscribe failed')
  }

  /**
   * Unsubscribe from a channel
   */
  public async unsubscribe(channelId: string): Promise<void> {
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/channels/${channelId}/subscribe`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.http.getToken()}` },
    })
    if (!res.ok) throw new Error('Unsubscribe failed')
  }

  /**
   * Post a message to a channel
   */
  public async postMessage(channelId: string, content: string, type: string = 'text'): Promise<{ post_id: string }> {
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/channels/${channelId}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.http.getToken()}`,
      },
      body: JSON.stringify({ type, content }),
    })
    if (!res.ok) throw new Error('Post failed')
    return await res.json()
  }

  /**
   * Get channel post history
   */
  public async getPosts(channelId: string): Promise<ChannelPost[]> {
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/channels/${channelId}/posts`, {
      headers: { Authorization: `Bearer ${this.http.getToken()}` },
    })
    if (!res.ok) throw new Error('Get posts failed')
    const items = await res.json()
    return Array.isArray(items) ? items : []
  }

  /**
   * Check if current user can post in the channel
   */
  public canPost(channelInfo: ChannelInfo | null): boolean {
    return channelInfo?.role === 'owner'
  }
}
