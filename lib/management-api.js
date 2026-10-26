import { validateAlignmentMode } from "./types.js";
/** The base path all management routes are mounted under. */
export const ROUTE_BASE = '/_dsh/requirements-alignment';
/** Distinct CSRF header so a malicious third-party page cannot forge mutations. */
export const MUTATION_HEADER = 'x-dsh-requirements-alignment';
const MAX_BODY_BYTES = 16 * 1024;
function sendJson(res, status, body) {
    res.statusCode = status;
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(body));
}
function isLoopbackRemote(req) {
    const address = req.socket.remoteAddress ?? '';
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function isLoopbackHostname(hostname) {
    const lower = hostname.toLowerCase();
    const normalized = lower.startsWith('[') && lower.endsWith(']')
        ? lower.slice(1, -1)
        : lower;
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}
function hostAllowed(host) {
    if (host === undefined || host === '')
        return false;
    if (isLoopbackHostname(host))
        return true;
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
    if (bracketed !== null)
        return isLoopbackHostname(bracketed[1]);
    const hostnameWithOptionalPort = /^([^:]+)(?::\d+)?$/.exec(host);
    return hostnameWithOptionalPort !== null && isLoopbackHostname(hostnameWithOptionalPort[1]);
}
function originAllowed(origin) {
    if (origin === undefined || origin === '')
        return false;
    try {
        return isLoopbackHostname(new URL(origin).hostname);
    }
    catch {
        return false;
    }
}
function isMutation(method) {
    return method === 'POST' || method === 'PUT' || method === 'DELETE';
}
async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY_BYTES) {
            throw new Error('request body too large');
        }
        chunks.push(buffer);
    }
    if (chunks.length === 0)
        return {};
    const text = Buffer.concat(chunks).toString('utf8');
    try {
        const parsed = JSON.parse(text);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    }
    catch {
        throw new Error('invalid JSON body');
    }
}
/** Resolve one session id from the query string, or undefined. */
function sessionIdOf(url) {
    const value = url.searchParams.get('sessionId');
    if (value === undefined || value === null || value === '')
        return undefined;
    return value;
}
/**
 * Create the management API for one controller instance. `register` mounts
 * the routes on the web server and returns the disposer removing them.
 */
export function createManagementApi(controller) {
    const handle = async (req, res) => {
        // Loopback enforcement: the API is same-origin with the DSH web UI and
        // must never be reachable from a non-loopback source.
        if (!isLoopbackRemote(req)) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
        }
        let url;
        try {
            url = new URL(req.url ?? '/', 'http://127.0.0.1');
        }
        catch {
            sendJson(res, 400, { ok: false, error: 'bad request' });
            return;
        }
        const method = req.method ?? 'GET';
        const path = url.pathname;
        // ── mutation guard ────────────────────────────────────────────────────
        if (isMutation(method)) {
            if (!hostAllowed(req.headers.host)) {
                sendJson(res, 403, { ok: false, error: 'bad-origin' });
                return;
            }
            if (!originAllowed(req.headers.origin)) {
                sendJson(res, 403, { ok: false, error: 'bad-origin' });
                return;
            }
            if (req.headers[MUTATION_HEADER] !== '1') {
                sendJson(res, 403, { ok: false, error: 'forbidden' });
                return;
            }
        }
        // ── read endpoints ────────────────────────────────────────────────────
        if (path === ROUTE_BASE + '/status' && method === 'GET') {
            const sessionId = sessionIdOf(url);
            if (sessionId === undefined) {
                sendJson(res, 400, { ok: false, error: 'sessionId is required' });
                return;
            }
            const agent = controller.liveAgent(sessionId);
            if (agent === undefined) {
                sendJson(res, 404, { ok: false, error: 'session not live' });
                return;
            }
            const payload = controller.alignmentStatusPayload(agent);
            sendJson(res, 200, payload);
            return;
        }
        // ── session-scoped mutations ──────────────────────────────────────────
        if (path === ROUTE_BASE + '/mode' && method === 'PUT') {
            const sessionId = sessionIdOf(url);
            if (sessionId === undefined) {
                sendJson(res, 400, { ok: false, error: 'sessionId is required' });
                return;
            }
            const agent = controller.liveAgent(sessionId);
            if (agent === undefined) {
                sendJson(res, 404, { ok: false, error: 'session not live' });
                return;
            }
            let body;
            try {
                body = await readBody(req);
            }
            catch (error) {
                sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'bad body' });
                return;
            }
            let mode;
            try {
                mode = validateAlignmentMode(body.mode);
            }
            catch (error) {
                sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'invalid mode' });
                return;
            }
            try {
                await controller.setSessionMode(agent.session, mode);
                sendJson(res, 200, controller.alignmentStatusPayload(agent));
            }
            catch (error) {
                sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'failed to set session mode' });
            }
            return;
        }
        if (path === ROUTE_BASE + '/mode' && method === 'DELETE') {
            const sessionId = sessionIdOf(url);
            if (sessionId === undefined) {
                sendJson(res, 400, { ok: false, error: 'sessionId is required' });
                return;
            }
            const agent = controller.liveAgent(sessionId);
            if (agent === undefined) {
                sendJson(res, 404, { ok: false, error: 'session not live' });
                return;
            }
            try {
                await controller.clearSessionOverride(agent.session);
                sendJson(res, 200, controller.alignmentStatusPayload(agent));
            }
            catch (error) {
                sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'failed to reset session mode' });
            }
            return;
        }
        // ── shared (runtime) mutations ────────────────────────────────────────
        if (path === ROUTE_BASE + '/shared-mode' && method === 'PUT') {
            let body;
            try {
                body = await readBody(req);
            }
            catch (error) {
                sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'bad body' });
                return;
            }
            let mode;
            try {
                mode = validateAlignmentMode(body.mode);
            }
            catch (error) {
                sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : 'invalid mode' });
                return;
            }
            try {
                await controller.setMode(mode);
                sendJson(res, 200, { ok: true, snapshot: controller.modeStore.getSnapshot() });
            }
            catch (error) {
                sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'failed to set shared mode' });
            }
            return;
        }
        if (path === ROUTE_BASE + '/shared-mode' && method === 'DELETE') {
            try {
                await controller.resetMode();
                sendJson(res, 200, { ok: true, snapshot: controller.modeStore.getSnapshot() });
            }
            catch (error) {
                sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'failed to reset shared mode' });
            }
            return;
        }
        sendJson(res, 404, { ok: false, error: 'not found' });
    };
    return {
        register(webServer) {
            return webServer.register({ kind: 'prefix', path: ROUTE_BASE, handler: handle });
        }
    };
}
//# sourceMappingURL=management-api.js.map