/** Process-local admission guard for the original FC component's create-or-update behavior. */
export const FC_CREATION_GUARD_SOURCE = String.raw`
let fcCreateGuardSatisfied = !request.functionCreationGuard;
if (request.functionCreationGuard) {
  const guard = request.functionCreationGuard;
  const endpoint = new URL(/^https?:\/\//.test(guard.endpoint) ? guard.endpoint : 'https://' + guard.endpoint);
  if (!guard.functionName || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('Invalid FC creation guard');
  let created = false, submitted = false;
  const reject = () => {const error = new Error('FC create-only admission refused an update or uncertain repeated create. Preserve the resource record for recovery.'); error.code = 'ABX_FC_CREATE_CONFLICT'; throw error;};
  const admit = (method, route, authority) => {
    if (created || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
    let pathname = String(route || '/').split('?')[0];
    if (/^https?:\/\//.test(String(route))) {const target = new URL(String(route)); pathname = target.pathname; authority = target.host;}
    // The SDK can use an explicit endpoint. Never let an FC-versioned request evade
    // admission merely because its host differs from the selected endpoint.
    if (!pathname.startsWith('/2023-03-30/')) return false;
    if (authority !== endpoint.host || method !== 'POST' || pathname !== '/2023-03-30/functions' || submitted) return reject();
    submitted = true; return true;
  };
  const observe = (stream, status) => {
    if (status < 200 || status >= 300) return;
    const chunks = []; let bytes = 0;
    // Do not add a data listener: the SDK may attach its body reader asynchronously.
    // Observing events preserves paused/flowing state and never consumes response bytes.
    const original = stream.emit;
    stream.emit = function(event, ...args) {
      if (event === 'data') {const chunk = args[0]; bytes += Buffer.byteLength(chunk); if (bytes <= 1024 * 1024) chunks.push(Buffer.from(chunk));}
      if (event === 'end') {
        stream.emit = original;
        if (bytes <= 1024 * 1024) try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (value.functionName === guard.functionName && typeof value.functionId === 'string' && value.functionId) {created = true; fcCreateGuardSatisfied = true;} } catch {}
      }
      return original.call(this, event, ...args);
    };
  };
  for (const protocol of ['http:', 'https:']) {
    const mod = require(protocol === 'http:' ? 'node:http' : 'node:https'), original = mod.request;
    mod.request = function(...args) {
      const first = args[0], url = typeof first === 'string' || first instanceof URL ? new URL(first) : undefined;
      const options = url ? (args[1] && typeof args[1] === 'object' ? args[1] : {}) : (first || {});
      const method = String(options.method || 'GET').toUpperCase();
      const target = new URL(protocol + '//' + (options.hostname || options.host || (url && url.host) || 'localhost'));
      if (options.port) target.port = String(options.port);
      const authority = target.host;
      const isCreate = admit(method, options.path || (url && url.pathname + url.search), authority);
      const result = original.apply(this, args);
      if (isCreate) result.prependOnceListener('response', response => observe(response, response.statusCode));
      return result;
    };
  }
  const h2 = require('node:http2'), connect = h2.connect;
  h2.connect = function(authority, ...args) {
    const session = connect.call(this, authority, ...args), original = session.request;
    session.request = function(headers, ...rest) {
      const target = new URL(String(authority));
      const isCreate = admit(String(headers[':method'] || 'GET').toUpperCase(), headers[':path'], headers[':authority'] || target.host);
      const stream = original.call(this, headers, ...rest);
      if (isCreate) stream.prependOnceListener('response', response => observe(stream, Number(response[':status'])));
      return stream;
    };
    return session;
  };
}
`;
