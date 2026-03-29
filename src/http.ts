export class HttpClient {
  private apiBase: string = '';
  private token: string | null = null;

  constructor(apiBase: string = '') {
    this.apiBase = apiBase;
  }

  public setApiBase(apiBase: string) {
    this.apiBase = apiBase;
  }

  public getApiBase(): string {
    return this.apiBase;
  }

  public setToken(token: string | null) {
    this.token = token;
  }

  public getToken(): string | null {
    return this.token;
  }

  private getHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...customHeaders };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  public async get<T = any>(path: string): Promise<T> {
    const res = await fetch(this.apiBase + path, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text}`);
    return text ? JSON.parse(text) : (null as any);
  }

  public async post<T = any>(path: string, body: any): Promise<T> {
    const res = await fetch(this.apiBase + path, {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text}`);
    return text ? JSON.parse(text) : (null as any);
  }

  public async put<T = any>(path: string, body?: any): Promise<T> {
    const headers = this.getHeaders();
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(this.apiBase + path, {
      method: 'PUT',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text}`);
    return text ? JSON.parse(text) : (null as any);
  }

  public async delete<T = any>(path: string): Promise<T> {
    const res = await fetch(this.apiBase + path, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text}`);
    return text ? JSON.parse(text) : (null as any);
  }

  /**
   * For direct fetch calls (like Media Presigned URL PUT / GET)
   */
  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }
}
