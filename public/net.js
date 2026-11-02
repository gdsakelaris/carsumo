// WebSocket client with reconnect, a ping/latency estimate and a message callback.
export class Net {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.latency = null;
    this.id = null;
    this._pingTimer = null;
    this._closedByUs = false;
  }
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this._closedByUs = false;
    ws.addEventListener('open', () => {
      this.onStatus('open');
      this._pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    });
    ws.addEventListener('message', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'pong') { this.latency = Math.round(performance.now() - msg.c); return; }
      if (msg.t === 'welcome') this.id = msg.id;
      this.onMessage(msg);
    });
    ws.addEventListener('close', () => {
      clearInterval(this._pingTimer);
      this.onStatus('closed');
      if (!this._closedByUs) setTimeout(() => this.connect(), 1500);
    });
    ws.addEventListener('error', () => { /* close follows */ });
  }
  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
  close() { this._closedByUs = true; if (this.ws) this.ws.close(); }
}
