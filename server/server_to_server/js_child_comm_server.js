const WebSocket = require('ws');
const c_ChatServer = require("../chat_server/js_andruav_chat_server");
const vlog = require('../js_vertair_logger');

class ChildCommServer {
  constructor(parentHost, parentPort) {
    if (ChildCommServer.instance) {
      return ChildCommServer.instance;
    }

    this.m_callbackOnMessage = null;
    this.m_parentHost = parentHost;
    this.m_parentPort = parentPort;
    this.parentWs = null;
    this.units = new Set();
    ChildCommServer.instance = this;
    this.connectToParent(); // Connect immediately
  }

  static getInstance(parentHost, parentPort) {
    if (!ChildCommServer.instance) {
      ChildCommServer.instance = new ChildCommServer(parentHost, parentPort);
    }
    return ChildCommServer.instance;
  }

  connectToParent() {

    // Optional: Add headers for authentication or other purposes
    const headers = {
      // 'Authorization': 'Bearer your-token',
      // 'Custom-Header': 'value',
    };

    const options = {
      headers: headers,
      rejectUnauthorized: false, // Be very cautious with this in production!
    };

    const parentUrl = `ws://${this.m_parentHost}:${this.m_parentPort}`; // Construct the URL
    this.parentWs = new WebSocket(parentUrl, options);

    this.parentWs.on('open', () => {
      vlog.info('[ChildSrv] Connected to parent server at ' + parentUrl);
    });

    this.parentWs.on('message', (message) => {
      this.onReceive(message);
    });

    this.parentWs.on('close', (code, reason) => {
      vlog.info('[ChildSrv] Disconnected from parent server: ' + code + ' - ' + reason);
      this.parentWs = null;
      // Reconnect logic can be added here.
      setTimeout(() => this.connectToParent(), 10000);
    });

    this.parentWs.on('error', (error) => {
      vlog.error('[ChildSrv] WebSocket error: ' + error);
    });
  }

  onReceive(message) {
    try {
      vlog.verbose('[ChildSrv] RX: ' + message);
      let v_isBinary = false;
      if (typeof (message) !== 'string') {
        v_isBinary = true;
      }
      c_ChatServer.fn_parseExternalMessage(message, v_isBinary);
    } catch (error) {
      vlog.error('[ChildSrv] Message parse error: ' + error);
    }
  }

  sendMessage(senderId, recipientId, content, trace = []) {
    if (this.parentWs) {
      this.parentWs.send(JSON.stringify({ type: 'message', senderId, recipientId, content, trace }));
    } else {
      vlog.warn('[ChildSrv] Cannot send — parent server not connected');
    }
  }


  forwardMessage(message, p_isBinary) {
    if (this.parentWs && this.parentWs.readyState === WebSocket.OPEN) {
      this.parentWs.send(message, { binary: p_isBinary });
    } else {
      vlog.warn('[ChildSrv] Cannot forward — parent WebSocket not connected');
    }
  }

  isSocketConnected() {
    return this.parentWs && this.parentWs.readyState === WebSocket.OPEN;
  }
}

module.exports = ChildCommServer;
