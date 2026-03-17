
"use strict";

/**
 * VertAir logging utility for DroneEngage comm server.
 *
 * Rules:
 *  - First 5 minutes after start: log everything (VERBOSE mode)
 *  - After 5 minutes: heartbeat summary every 30 minutes (EST)
 *  - Credentials/keys: show last 8 chars only
 *  - All log lines prefixed with UTC timestamp + level
 */

const m_startTime = Date.now();
const CONST_VERBOSE_WINDOW_MS = 5 * 60 * 1000;   // 5 minutes
const CONST_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let m_heartbeatInterval = null;
let m_sessionStats = {
    logins: 0,
    rejections: 0,
    disconnects: 0,
    connectedUnits: 0,
    rssLastMB: 0,
};

function isVerbose() {
    return (Date.now() - m_startTime) < CONST_VERBOSE_WINDOW_MS;
}

function ts() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }) + ' EST';
}

function redact(str) {
    if (!str || str.length < 8) return '****';
    return `...${str.slice(-8)}`;
}

function log(level, msg) {
    console.log(`[${ts()}] [${level}] ${msg}`);
}

function info(msg)    { log('INFO ', msg); }
function warn(msg)    { log('WARN ', msg); }
function error(msg)   { log('ERROR', msg); }
function verbose(msg) { if (isVerbose()) log('VERB ', msg); }
function debug(msg)   { if (isVerbose()) log('DEBUG', msg); }

function startHeartbeat(getStatsFn) {
    if (m_heartbeatInterval) clearInterval(m_heartbeatInterval);
    m_heartbeatInterval = setInterval(() => {
        const stats = getStatsFn();
        info('━━━ HEARTBEAT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        info(`  Connected units : ${stats.connectedUnits}`);
        info(`  Logins (session): ${stats.logins}`);
        info(`  Rejections      : ${stats.rejections}`);
        info(`  Disconnects     : ${stats.disconnects}`);
        info(`  RSS memory      : ${stats.rssLastMB} MB`);
        info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }, CONST_HEARTBEAT_INTERVAL_MS);
}

module.exports = { info, warn, error, verbose, debug, redact, startHeartbeat, isVerbose, m_sessionStats };
