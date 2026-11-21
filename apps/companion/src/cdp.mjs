import {AppError} from './errors.mjs';

export class CdpConnection {
  constructor(url, {WebSocketImpl = WebSocket, timeout = 12000} = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
      throw new AppError('Browser debugging must stay on this laptop.');
    }
    this.socket = new WebSocketImpl(url); this.pending = new Map(); this.sequence = 0; this.timeout = timeout;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new AppError('Browser connection timed out.')); }, timeout);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new AppError('Cannot connect to the YouTube tab.')); }, {once: true});
      this.socket.addEventListener('close', () => { clearTimeout(timer); reject(new AppError('The YouTube tab was closed.')); }, {once: true});
    });
    // A socket can fail before the first request is made.
    this.ready.catch(() => {});
    this.socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(String(event.data)); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new AppError('The browser rejected this action. Try again.'));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener('close', () => this.failPending());
    this.socket.addEventListener('error', () => this.failPending());
  }
  failPending() {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new AppError('The browser connection was lost.')); }
    this.pending.clear();
  }
  get connected() { return this.socket.readyState === 1; }
  async send(method, params = {}, sessionId) {
    await this.ready;
    if (!this.connected) throw new AppError('Open the YouTube window from the laptop dashboard.');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AppError('YouTube took too long to respond.')); }, this.timeout);
      this.pending.set(id, {resolve, reject, timer});
      try { this.socket.send(JSON.stringify({id, method, params, sessionId})); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new AppError('Cannot send a command to the browser.')); }
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, userGesture: true});
    if (result.exceptionDetails) throw new AppError('YouTube is not ready. Check the laptop for a sign-in or consent screen.');
    return result.result.value;
  }
  close() { this.failPending(); try { this.socket.close(); } catch {} }
}
