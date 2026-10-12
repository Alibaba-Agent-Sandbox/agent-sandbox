/**
 * TLS trust configuration shared by the httpx shim, the WebSocket client and the raw HTTPS call sites.
 *
 * httpx 0.28 (`create_ssl_context`, `verify=True`, `trust_env=True`) builds its context from `SSL_CERT_FILE` (only that
 * bundle is trusted), else `SSL_CERT_DIR` (only that hashed directory), else the certifi bundle.  `NODE_EXTRA_CA_CERTS`
 * is honoured by Node only while no explicit `ca` is passed, which matches the Python behaviour for the first two cases.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as tls from "node:tls";

import { OSError, toOSError } from "../utils/_pyos.js";

/** Python `ssl.SSLError` (an `OSError`). */
export class SSLError extends OSError {
  constructor(message: string) {
    super(message, { errno: 136, strerror: message });
    this.name = "SSLError";
  }
}

const PEM_RE = /-----BEGIN (?:TRUSTED |X509 )?CERTIFICATE-----[\s\S]*?-----END (?:TRUSTED |X509 )?CERTIFICATE-----/g;

function pemCertificates(text: string): string[] {
  const out: string[] = [];
  for (const block of text.match(PEM_RE) ?? []) {
    try {
      new crypto.X509Certificate(block);
      out.push(block);
    } catch {
      /* unreadable block: skipped like OpenSSL's loader does for non-certificate entries */
    }
  }
  return out;
}

export interface TlsTrust {
  ca?: string[];
}

/** Options to spread into `tls.connect` / `https.Agent` / `https.request` for the given httpx `verify` / `trust_env`. */
export function tlsTrustOptions(verify: boolean, trustEnv: boolean): TlsTrust {
  if (!verify || !trustEnv) return {};
  const file = process.env["SSL_CERT_FILE"];
  if (file) {
    let text: string;
    try {
      text = fs.readFileSync(file, "latin1");
    } catch (e) {
      throw toOSError(e);
    }
    const certs = pemCertificates(text);
    if (certs.length === 0) throw new SSLError("[X509: NO_CERTIFICATE_OR_CRL_FOUND] no certificate or crl found (_ssl.c:4181)");
    return { ca: certs };
  }
  const dir = process.env["SSL_CERT_DIR"];
  if (dir) {
    const certs: string[] = [];
    try {
      for (const name of fs.readdirSync(dir)) {
        try {
          certs.push(...pemCertificates(fs.readFileSync(path.join(dir, name), "latin1")));
        } catch {
          /* unreadable entries are ignored (OpenSSL looks hashes up lazily) */
        }
      }
    } catch {
      /* a missing or unreadable directory is only an error once a certificate is needed */
    }
    return { ca: certs };
  }
  return {};
}

/**
 * Trust for `ssl.create_default_context()` (what `websockets` uses for `wss://` and https proxies): the platform roots
 * plus whatever OpenSSL's default-path loader finds through `SSL_CERT_FILE` / `SSL_CERT_DIR`.  Unlike httpx's `verify=True`
 * context, a missing or unparsable `SSL_CERT_FILE` / `SSL_CERT_DIR` is silently ignored by OpenSSL.
 */
export function defaultContextTrustOptions(): { ca: string[] } {
  const ca: string[] = [...tls.rootCertificates];
  const file = process.env["SSL_CERT_FILE"];
  if (file) {
    try {
      ca.push(...pemCertificates(fs.readFileSync(file, "latin1")));
    } catch {
      /* ignored by OpenSSL */
    }
  }
  const dir = process.env["SSL_CERT_DIR"];
  if (dir) {
    try {
      for (const name of fs.readdirSync(dir)) {
        try {
          ca.push(...pemCertificates(fs.readFileSync(path.join(dir, name), "latin1")));
        } catch {
          /* ignored */
        }
      }
    } catch {
      /* ignored */
    }
  }
  return { ca };
}
