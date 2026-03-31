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
    const res = await this.http.get<ChannelInfo[]>(`/api/v1/channels/search?q=${encodeURIComponent(query)}`)
    return Array.isArray(res) ? res : []
  }

  /**
   * Get channels subscribed by current user
   */
  public async getMine(): Promise<ChannelInfo[]> {
    const res = await this.http.get<ChannelInfo[]>('/api/v1/channels/mine')
    return Array.isArray(res) ? res : []
  }

  /**
   * Get channel details
   */
  public async getDetail(channelId: string): Promise<ChannelInfo> {
    return this.http.get<ChannelInfo>(`/api/v1/channels/${channelId}`)
  }

  /**
   * Create a new channel
   */
  public async create(name: string, description: string, isPublic: boolean = true): Promise<{ channel_id: string }> {
    return this.http.post<{ channel_id: string }>('/api/v1/channels', {
      name, description, is_public: isPublic,
    })
  }

  /**
   * Subscribe to a channel
   */
  public async subscribe(channelId: string): Promise<void> {
    await this.http.post(`/api/v1/channels/${channelId}/subscribe`, {})
  }

  /**
   * Unsubscribe from a channel
   */
  public async unsubscribe(channelId: string): Promise<void> {
    await this.http.delete(`/api/v1/channels/${channelId}/subscribe`)
  }

  /**
   * Post a message to a channel
   */
  public async postMessage(channelId: string, content: string, type: string = 'text'): Promise<{ post_id: string }> {
    return this.http.post<{ post_id: string }>(`/api/v1/channels/${channelId}/posts`, {
      type, content,
    })
  }

  /**
   * Get channel post history
   */
  public async getPosts(channelId: string): Promise<ChannelPost[]> {
    const items = await this.http.get<ChannelPost[]>(`/api/v1/channels/${channelId}/posts`)
    return Array.isArray(items) ? items : []
  }

  /**
   * Check if current user can post in the channel
   */
  public canPost(channelInfo: ChannelInfo | null): boolean {
    return channelInfo?.role === 'owner'
  }
}
