"use strict";

const m_commServerManagerClient = require("./js_comm_server_manager_client");
const vlog = require("./js_vertair_logger");
var m_agent_chat_server;
const c_ChatAccountRooms = require("./chat_server/js_andruav_chat_account_rooms");
const { v4: uuidv4 } = require("uuid");
const c_CONSTANTS = require("../js_constants");
const v_version = require("../package.json").version;

const CONST_WAIT_PARTY_TO_CONNECT_TIMEOUT = 10000;
const CONST_DEFAULT_INFO_HEARTBEAT_INTERVAL = 30000;

const m_waitingAccounts = {};
let m_watchdogInterval = null;

function isLoginExist(p_key) { return m_waitingAccounts[p_key] != null; }
function getLogin(p_key) { return m_waitingAccounts[p_key] || null; }
function deleteLogin(p_key) {
    if (p_key == null || m_waitingAccounts[p_key] == null) return;
    delete m_waitingAccounts[p_key];
}
function fn_removeSenderID(p_senderID) {
    fn_cancelLoginRequestBySenderID(p_senderID);
    fn_closeActiveConnectionBySenderID(p_senderID);
}
function fn_cancelLoginRequestBySenderID(p_requestID) {
    if (p_requestID == null) return;
    const c_keys = Object.keys(m_waitingAccounts);
    for (var i = 0; i < c_keys.length; ++i) {
        const c_LoginRequest = m_waitingAccounts[c_keys[i]];
        if (c_LoginRequest[c_CONSTANTS.CONST_CS_REQUEST_ID.toString()] == p_requestID) {
            delete m_waitingAccounts[c_keys[i]];
            m_commServerManagerClient.fn_onMessageOpened();
            return;
        }
    }
}
function fn_closeActiveConnectionBySenderID(p_senderID) {}

function fn_addWaitingAccount(p_tempLoginKey, p_LoginRequest) {
    m_waitingAccounts[p_tempLoginKey] = p_LoginRequest;
    setTimeout(function () { deleteLogin(p_tempLoginKey); }, CONST_WAIT_PARTY_TO_CONNECT_TIMEOUT);
}

function fn_decryptAuthMessage(p_msg) {
    try { return JSON.parse(p_msg); }
    catch (ex) { vlog.error("Failed to parse auth message: " + ex); }
    return null;
}

function fn_generateLoginRequestReply(p_cmd) {
    const c_reply = { "c": c_CONSTANTS.CONST_CS_CMD_LOGIN_REQUEST, "d": {} };
    c_reply.d[c_CONSTANTS.CONST_CS_REQUEST_ID.toString()]         = p_cmd.d[c_CONSTANTS.CONST_CS_REQUEST_ID.toString()];
    c_reply.d[c_CONSTANTS.CONST_CS_ERROR.toString()]              = c_CONSTANTS.CONST_ERROR_NON;
    c_reply.d[c_CONSTANTS.CONST_CS_SERVER_PUBLIC_HOST.toString()] = global.m_serverconfig.m_configuration.public_host;
    c_reply.d[c_CONSTANTS.CONST_CS_SERVER_PORT.toString()]        = global.m_serverconfig.m_configuration.server_port;
    c_reply.d[c_CONSTANTS.CONST_CS_LOGIN_TEMP_KEY.toString()]     = p_cmd.d[c_CONSTANTS.CONST_CS_LOGIN_TEMP_KEY.toString()];
    return c_reply;
}

function fn_AuthServerConnectionHandler() {
    if (m_watchdogInterval) { clearInterval(m_watchdogInterval); m_watchdogInterval = null; }
    vlog.info("[S2S] Connected to AuthServer — sending registration");
    fn_updateServerWatchdog();
    const c_interval = global.m_serverconfig.m_configuration.s2s_info_heartbeat_interval || CONST_DEFAULT_INFO_HEARTBEAT_INTERVAL;
    m_watchdogInterval = setInterval(fn_updateServerWatchdog, c_interval);
}

function fn_handleLoginResponses(p_cmd) {
    p_cmd.d[c_CONSTANTS.CONST_CS_LOGIN_TEMP_KEY.toString()] = uuidv4().replaceAll("-", "");
    fn_addWaitingAccount(p_cmd.d[c_CONSTANTS.CONST_CS_LOGIN_TEMP_KEY.toString()], p_cmd.d);
    const actor = p_cmd.d.at === "d" ? "Drone" : "GCS";
    const key = vlog.redact(p_cmd.d[c_CONSTANTS.CONST_CS_LOGIN_TEMP_KEY.toString()]);
    vlog.info("[LOGIN] Temp key " + key + " issued for " + actor + " | acct=..." + (p_cmd.d.a||"?").slice(-6) + " grp=" + (p_cmd.d.b||"?"));
    vlog.m_sessionStats.logins++;
    m_commServerManagerClient.fn_sendMessage(JSON.stringify(fn_generateLoginRequestReply(p_cmd)));
}

function fn_AuthServerMessagesHandler(p_msg) {
    try {
        const p_cmd = fn_decryptAuthMessage(p_msg);
        if ((p_cmd == null) || (!p_cmd.hasOwnProperty("c"))) return;
        switch (p_cmd.c) {
            case c_CONSTANTS.CONST_CS_CMD_LOGIN_REQUEST:
                if ((!p_cmd.hasOwnProperty("d")) || p_cmd.d.hasOwnProperty("d")) break;
                fn_handleLoginResponses(p_cmd);
                break;
            case c_CONSTANTS.CONST_CS_CMD_LOGOUT_REQUEST:
                break;
        }
    } catch (ex) { vlog.error("Auth message handler error: " + ex); }
}

function fn_updateServerWatchdog() {
    try {
        const accounts = c_ChatAccountRooms.fn_getUnitKeys();
        vlog.m_sessionStats.connectedUnits = accounts.length;
        const v_obj = {
            "isOnline": true, "version": v_version,
            "serverId": global.m_serverconfig.m_configuration.server_id,
            "public_host": global.m_serverconfig.m_configuration.public_host,
            "serverPort": global.m_serverconfig.m_configuration.server_port,
            "accounts": accounts
        };
        vlog.verbose("[S2S] Heartbeat → AuthServer | units=" + accounts.length + " host=" + v_obj.public_host + ":" + v_obj.serverPort);
        m_commServerManagerClient.fn_sendMessage(JSON.stringify({ "c": c_CONSTANTS.CONST_CS_CMD_INFO, "d": v_obj }));
    } catch (ex) { vlog.error("S2S watchdog error: " + ex); }
}

function fn_startServer() {
    vlog.info("Communication Server starting — verbose logging active for 5 minutes");
    if (global.m_serverconfig.m_configuration.allow_fake_SSL === true) {
        vlog.warn("TLS_REJECT_UNAUTHORIZED=0 active — only safe when auth is local");
        process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
    } else if (global.m_serverconfig.m_configuration.ca_cert_path === true) {
        process.env["NODE_EXTRA_CA_CERTS"] = global.m_serverconfig.m_configuration.ca_cert_path;
    }
    if (global.m_serverconfig.m_configuration.ignore_auth_server !== true) {
        m_commServerManagerClient.fn_onMessageReceived = fn_AuthServerMessagesHandler;
        m_commServerManagerClient.fn_onMessageOpened = fn_AuthServerConnectionHandler;
        m_commServerManagerClient.fn_startServer();
    }
    vlog.startHeartbeat(() => vlog.m_sessionStats);
    m_agent_chat_server = global.m_chat_server_singelton_get_instance();
    m_agent_chat_server.fn_startServer();
}

module.exports = { fn_startServer, isLoginExist, getLogin, deleteLogin };
