/**
 * Who may use the server, and over what: the startup policy, the token, and the
 * browser session cookie.
 *
 * NODE BUILTINS ONLY. `build:server` transpiles this directory file by file
 * without bundling, so an import of anything else would survive into
 * dist/server/ and resolve to nothing — the failure "the server's imports
 * survive the build" in test/server.test.ts exists to catch.
 *
 * THE POLICY IS REFUSE, NEVER WARN. A server that starts with a warning about
 * being open is a server that is open: nobody reads a banner. So every
 * configuration that would put the Codex spend endpoint on a network without a
 * token and a certificate, or would quietly ignore a credential someone set, is
 * a refusal at startup that names each problem and what fixes it. There is no
 * override flag, and `createDeckServer` repeats the one check that matters most
 * so no future caller can skip this file.
 *
 * WHAT IS KEPT IN MEMORY is `sha256(token)` to compare against and an HKDF of
 * the token to sign sessions with. The token itself, a cookie value and an
 * `Authorization` header are never logged, and no message here prints a file's
 * contents or a fingerprint of the token: an unsalted hash prefix in a log is an
 * offline oracle for a weak one.
 *
 * A SESSION BELONGS TO ONE LISTENER, not to the host. The port is in the cookie's
 * name and `host:port` is inside the MAC, because cookies have no port and two
 * DeckSmiths reading one token file would otherwise be interchangeable to a
 * browser. That is a collision fix, NOT confidentiality: the browser still hands
 * this cookie to every listener on the host, and the README says what that lets a
 * local account do.
 */
import {
  createHash,
  createHmac,
  createPrivateKey,
  hkdfSync,
  type KeyObject,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createSecureContext } from "node:tls";

/**
 * A loopback bind, spelled exactly as `DECKSMITH_HOST` must spell it. Anything
 * else — `127.0.0.2`, `::ffff:127.0.0.1`, `0.0.0.0`, an empty string — is
 * treated as exposed. A list that fails closed on a spelling it does not know is
 * the point; resolving names here would make the answer depend on DNS.
 */
export const LOOPBACK_BINDS = ["127.0.0.1", "::1", "localhost"];

/** How long a browser session lasts. A constant, not a setting. */
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

/**
 * The floor `createDeckServer` gives OpenSSL, and the floor `readTls` validates
 * against. ONE CONSTANT because the two must not drift: validating a pair under
 * a laxer policy than the server will use is a refusal that never fires and a
 * stack trace at listen instead.
 */
export const TLS_MIN_VERSION = "TLSv1.2" as const;

/** Slack for a clock that moved backwards between minting and checking. */
const SKEW_MS = 60_000;

/** Certificates expiring sooner than this get one line at startup. */
const EXPIRY_WARN_MS = 14 * 24 * 60 * 60 * 1000;

/** What a request is compared against. Derived from the token, never the token. */
export interface AuthKeys {
  tokenHash: Buffer;
  sessionKey: Buffer;
}

export interface TlsMaterial {
  /** The PEM chain, leaf first, exactly as read. */
  cert: Buffer;
  key: Buffer;
  /** The leaf. Its SANs are the Host allowlist on an exposed bind. */
  x509: X509Certificate;
}

export interface Security {
  host: string;
  loopback: boolean;
  sandboxDecks: boolean;
  auth?: AuthKeys & { file: string };
  tls?: TlsMaterial & { certPath: string; keyPath: string };
  /** Said once at startup; never a reason to refuse. */
  warnings: string[];
}

export interface SecurityDeps {
  readFile: (path: string) => Buffer;
  stat: (path: string) => { mode: number; isFile(): boolean };
  now: () => number;
  platform: NodeJS.Platform;
}

/** Every problem at once, so fixing a configuration is one restart and not five. */
export class SecurityRefusal extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "SecurityRefusal";
  }
}

const TOKEN_RECIPE = "openssl rand -base64 32 > <file>; chmod 600 <file>";

/**
 * Read the environment into a server configuration, or refuse.
 *
 * Pure apart from `deps`, which tests replace. `main.ts` calls it before it
 * creates the work directory or sweeps it, so a refused start leaves nothing on
 * disk.
 */
export function resolveSecurity(
  env: NodeJS.ProcessEnv,
  deps: SecurityDeps = {
    readFile: (path) => readFileSync(path),
    stat: (path) => statSync(path),
    now: Date.now,
    platform: process.platform,
  },
): Security {
  const problems: string[] = [];
  const warnings: string[] = [];
  const host = env.DECKSMITH_HOST ?? "127.0.0.1";
  const loopback = LOOPBACK_BINDS.includes(host);
  const sandboxDecks = flag(env.DECKSMITH_DECK_SANDBOX, true);

  // Present at all, even empty. Ignoring it would fail OPEN on loopback — the
  // person who set it believes there is a token — and it would be inherited by
  // every child this process spawns, Codex included (src/plan/codex.ts passes
  // `process.env` through).
  if (env.DECKSMITH_TOKEN !== undefined) {
    problems.push(
      "DECKSMITH_TOKEN is set, and this server does not read a token from the environment: " +
        "it would reach shell history and every process the server starts. Unset it, put the " +
        `token in a file (${TOKEN_RECIPE}) and name that file with DECKSMITH_TOKEN_FILE.`,
    );
  }

  const tokenFile = env.DECKSMITH_TOKEN_FILE;
  let auth: Security["auth"];
  if (tokenFile !== undefined) {
    const token = readToken(tokenFile, deps, problems);
    if (token !== undefined) auth = { file: tokenFile, ...authKeys(token) };
  }

  const certPath = env.DECKSMITH_TLS_CERT;
  const keyPath = env.DECKSMITH_TLS_KEY;
  let tls: Security["tls"];
  if (certPath === undefined && keyPath !== undefined) {
    problems.push(
      "DECKSMITH_TLS_CERT is unset while DECKSMITH_TLS_KEY is set. Set both, or neither.",
    );
  } else if (keyPath === undefined && certPath !== undefined) {
    problems.push(
      "DECKSMITH_TLS_KEY is unset while DECKSMITH_TLS_CERT is set. Set both, or neither.",
    );
  } else if (certPath !== undefined && keyPath !== undefined) {
    const material = readTls(certPath, keyPath, deps, problems, warnings);
    if (material) tls = { ...material, certPath, keyPath };
  }

  if (!loopback) {
    const missing = [
      ...(tokenFile === undefined ? ["DECKSMITH_TOKEN_FILE"] : []),
      ...(certPath === undefined ? ["DECKSMITH_TLS_CERT"] : []),
      ...(keyPath === undefined ? ["DECKSMITH_TLS_KEY"] : []),
    ];
    if (missing.length > 0) {
      problems.push(
        `DECKSMITH_HOST=${JSON.stringify(host)} is not a loopback address (${LOOPBACK_BINDS.join(", ")}), ` +
          `and a server reachable from a network needs a token and a certificate. Missing: ${missing.join(", ")}.` +
          (tokenFile === undefined ? ` Make a token with: ${TOKEN_RECIPE}.` : "") +
          (certPath === undefined || keyPath === undefined
            ? " The certificate is a PEM chain whose subjectAltName lists the names browsers will use; the key is its unencrypted PEM key."
            : "") +
          " To reach a server on another machine without any of this, leave it on loopback and tunnel: " +
          "ssh -L 8475:127.0.0.1:8475 <host>",
      );
    }
  }

  // Without `connect-src 'none'` a deck opened top-level runs as this origin
  // with nothing stopping its fetch, and the browser would attach the session
  // cookie to it.
  if (!sandboxDecks && (tokenFile !== undefined || !loopback)) {
    problems.push(
      "DECKSMITH_DECK_SANDBOX is off, which lets a deck's script call this server's API as whoever " +
        "is logged in. It may be turned off only on a loopback bind with no DECKSMITH_TOKEN_FILE.",
    );
  }

  if (problems.length > 0) throw new SecurityRefusal(problems);
  return {
    host,
    loopback,
    sandboxDecks,
    ...(auth ? { auth } : {}),
    ...(tls ? { tls } : {}),
    warnings,
  };
}

/**
 * A name from the certificate that a browser can actually open.
 *
 * A DNS name first, because that is what someone types, and a wildcard is
 * skipped: `*.wild.test` is not a host. Otherwise the first IP SAN, bracketed if
 * it is v6. `undefined` when the certificate names only wildcards — then the
 * banner lists the SANs instead of inventing a URL.
 */
function reachableName(san: string | undefined): string | undefined {
  const parts = (san ?? "").split(",").map((part) => part.trim());
  const dns = parts.find((part) => part.startsWith("DNS:") && !part.startsWith("DNS:*"));
  if (dns) return dns.slice("DNS:".length);
  const ip = parts.find((part) => part.startsWith("IP Address:"));
  if (!ip) return undefined;
  const addr = ip.slice("IP Address:".length);
  return addr.includes(":") ? `[${addr}]` : addr;
}

/**
 * The lines `main.ts` prints about how the server is reached. Never the token.
 *
 * THE URL MUST BE ONE THIS SERVER ANSWERS TO. On an exposed bind the `Host`
 * allowlist is the certificate's SANs and nothing else, and the bind address is
 * almost never one of them — `https://0.0.0.0:8475`, which this banner used to
 * print, is a URL the server refuses with 403. So the exposed banner prints a
 * name from the certificate and says separately what it is bound to.
 */
export function securityBanner(security: Security, port: number): string[] {
  const host = security.host.includes(":") ? `[${security.host}]` : security.host;
  const scheme = security.tls ? "https" : "http";
  const reachable = security.loopback
    ? undefined
    : reachableName(security.tls?.x509.subjectAltName);
  const lines = [
    reachable !== undefined || security.loopback || !security.tls
      ? `${scheme}://${reachable ?? host}:${port}`
      : `${scheme}://${host}:${port} — but this server answers only to ${security.tls.x509.subjectAltName}`,
  ];
  if (security.tls) {
    lines.push(
      `tls: ${security.tls.certPath}, bound to ${host}, names ${security.tls.x509.subjectAltName}, valid to ${security.tls.x509.validTo}`,
    );
  }
  if (security.auth) {
    lines.push(`auth: token from ${security.auth.file}`);
  } else {
    lines.push(
      `no auth. Bound to ${security.host}, so anyone with an account on this machine can spend your Codex quota — set DECKSMITH_TOKEN_FILE to require a token.`,
    );
  }
  return lines;
}

/* ------------------------------------------------------------- startup reads */

function readToken(path: string, deps: SecurityDeps, problems: string[]): string | undefined {
  const where = `DECKSMITH_TOKEN_FILE (${path})`;
  let info: { mode: number; isFile(): boolean };
  let raw: string;
  try {
    info = deps.stat(path);
    if (!info.isFile()) {
      problems.push(`${where} is not a regular file.`);
      return undefined;
    }
    raw = deps.readFile(path).toString("utf8");
  } catch (err) {
    problems.push(`cannot read ${where}: ${codeOf(err)}`);
    return undefined;
  }
  const before = problems.length;
  if (deps.platform !== "win32" && (info.mode & 0o077) !== 0) {
    problems.push(`${where} is readable by other users; chmod 600 it.`);
  }
  // One trailing newline is what `openssl rand ... > file` and every editor
  // write. Anything more is not a token this server can know was meant.
  const token = raw.replace(/\r?\n$/, "");
  if (token.length === 0) {
    problems.push(`${where} is empty. Make a token with: ${TOKEN_RECIPE}.`);
  } else if (/\s/.test(token)) {
    problems.push(`${where} contains whitespace inside the token. It must be a single line.`);
  } else if (token.length < 32) {
    problems.push(
      `${where} holds ${token.length} characters; a token needs at least 32. Make one with: ${TOKEN_RECIPE}.`,
    );
  } else if (token.length > 1024) {
    problems.push(`${where} holds ${token.length} characters; a token may have at most 1024.`);
  }
  return problems.length === before ? token : undefined;
}

/**
 * The certificate and key, checked in the order a person fixing them would want
 * to hear about it. Every message names the variable and the path; none prints
 * what the file holds.
 */
function readTls(
  certPath: string,
  keyPath: string,
  deps: SecurityDeps,
  problems: string[],
  warnings: string[],
): TlsMaterial | undefined {
  const certWhere = `DECKSMITH_TLS_CERT (${certPath})`;
  const keyWhere = `DECKSMITH_TLS_KEY (${keyPath})`;
  let cert: Buffer | undefined;
  let key: Buffer | undefined;
  let keyMode = 0;
  try {
    cert = deps.readFile(certPath);
  } catch (err) {
    problems.push(`cannot read ${certWhere}: ${codeOf(err)}`);
  }
  try {
    keyMode = deps.stat(keyPath).mode;
    key = deps.readFile(keyPath);
  } catch (err) {
    problems.push(`cannot read ${keyWhere}: ${codeOf(err)}`);
  }
  if (!cert || !key) return undefined;

  const before = problems.length;
  if (deps.platform !== "win32" && (keyMode & 0o077) !== 0) {
    problems.push(`${keyWhere} is readable by other users; chmod 600 it.`);
  }

  // BY THE HEADER, BEFORE `X509Certificate`, BECAUSE THE TWO DISAGREE.
  // `new X509Certificate(der)` parses DER happily and so does `checkPrivateKey`,
  // so a DER file used to pass every check here and then throw
  // ERR_OSSL_PEM_NO_START_LINE out of `createServer` — after main.ts had made the
  // work directory. Measured on Node 24.14.0 / OpenSSL 3.5.5. What the server
  // hands OpenSSL is a PEM chain, so that is what this accepts.
  //
  // The banner is spelled here and NOT in the message: `R10` proves no message
  // this file writes contains `-----BEGIN`, which is how a leaked file body would
  // look, and a message that quotes the banner would defeat that test for a
  // sentence that reads no better.
  if (!cert.toString("latin1").includes("-----BEGIN CERTIFICATE-----")) {
    problems.push(
      `${certWhere} is not a PEM chain: a PEM certificate opens with a BEGIN CERTIFICATE line and this file has none. ` +
        "If it is DER, convert it with: openssl x509 -inform der -in <file> -out <file>.pem.",
    );
    return undefined;
  }
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(cert);
  } catch {
    problems.push(`${certWhere} is not a PEM certificate.`);
    return undefined;
  }
  // BY THE HEADER, NOT BY THE ERROR. An encrypted key with no passphrase throws
  // ERR_OSSL_CRYPTO_INTERRUPTED_OR_CANCELLED from OpenSSL (measured on Node 24),
  // which says nothing a person could act on.
  const pem = key.toString("latin1");
  if (pem.includes("ENCRYPTED PRIVATE KEY") || /Proc-Type:\s*4,ENCRYPTED/.test(pem)) {
    problems.push(
      `${keyWhere} is encrypted, and the server has no way to ask for its passphrase. ` +
        "Decrypt it with: openssl pkey -in <encrypted> -out <plain>; chmod 600 <plain>.",
    );
    return undefined;
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(key);
  } catch {
    problems.push(`${keyWhere} is not a PEM private key.`);
    return undefined;
  }
  if (!x509.checkPrivateKey(privateKey)) {
    problems.push(`${keyWhere} does not belong to the certificate in ${certWhere}.`);
    return undefined;
  }
  if (x509.subjectAltName === undefined) {
    problems.push(
      `${certWhere} has no subjectAltName, and browsers ignore the common name. Reissue it with the names it will be reached by as SANs.`,
    );
    return undefined;
  }
  const now = deps.now();
  const from = Date.parse(x509.validFrom);
  const to = Date.parse(x509.validTo);
  if (now < from) {
    problems.push(
      `${certWhere} is not yet valid: it is valid from ${x509.validFrom} to ${x509.validTo}. If it was just issued, check this machine's clock.`,
    );
  } else if (now >= to) {
    problems.push(
      `${certWhere} has expired: it was valid from ${x509.validFrom} to ${x509.validTo}. If that is wrong, check this machine's clock.`,
    );
  } else if (to - now < EXPIRY_WARN_MS) {
    warnings.push(
      `${certWhere} expires ${x509.validTo}, in ${Math.ceil((to - now) / 86_400_000)} day(s). Replace it and restart.`,
    );
  }

  // LAST, AND AGAINST THE THING THAT WILL ACTUALLY LOAD THEM. Everything above
  // is Node's own parsing, and OpenSSL has rules Node's parsers do not apply: an
  // RSA-512 key is a `KeyObject` that `checkPrivateKey` agrees with and that
  // OpenSSL then refuses as ERR_SSL_EE_KEY_TOO_SMALL at its security level.
  // Measured on Node 24.14.0 / OpenSSL 3.5.5. The same options `createDeckServer`
  // passes, so a pair that survives this cannot fail there — and the failure
  // arrives here, before main.ts creates the work directory, rather than as an
  // OpenSSL stack trace out of `listen`.
  if (problems.length === before) {
    try {
      createSecureContext({ cert, key, minVersion: TLS_MIN_VERSION });
    } catch (err) {
      problems.push(
        `OpenSSL will not load ${certWhere} with ${keyWhere}: ${codeOf(err)}${reasonOf(err)}. ` +
          "Check that the certificate is the leaf-first PEM chain for that key, and that the key is strong enough for this OpenSSL's security level (an RSA key needs 2048 bits or more).",
      );
    }
  }
  return problems.length === before ? { cert, key, x509 } : undefined;
}

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" ? code : "unreadable";
}

/**
 * OpenSSL's own short phrase for the failure — "ee key too small", "no start
 * line" — which says more than the code alone. A reason is a fixed string from
 * OpenSSL's table, never a path and never anything the files contain.
 */
function reasonOf(err: unknown): string {
  const reason = (err as { reason?: unknown })?.reason;
  return typeof reason === "string" && reason !== "" ? ` (${reason})` : "";
}

/** An environment switch. Shared with main.ts so the two cannot parse one variable two ways. */
export function flag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return ["1", "true", "on", "yes"].includes(raw.toLowerCase());
}

/* --------------------------------------------------------------- credentials */

export function authKeys(token: string): AuthKeys {
  return {
    tokenHash: createHash("sha256").update(token).digest(),
    sessionKey: Buffer.from(hkdfSync("sha256", token, "decksmith", "session-v1", 32)),
  };
}

/**
 * Compare a presented token. Hashed first so both sides are 32 bytes: a length
 * mismatch is a plain `false`, never the RangeError `timingSafeEqual` throws.
 */
export function tokenMatches(keys: AuthKeys, presented: string): boolean {
  return timingSafeEqual(createHash("sha256").update(presented).digest(), keys.tokenHash);
}

/**
 * The token in an `Authorization` header, or null when the header is anything
 * but `Bearer <token>` — Basic, an empty Bearer, a second parameter. The scheme
 * is case-insensitive (RFC 9110 §11.1).
 */
export function bearerOf(header: string): string | null {
  return /^Bearer +(\S+)$/i.exec(header)?.[1] ?? null;
}

/**
 * The cookie's name, WITH THE PORT IN IT.
 *
 * `__Host-` over TLS: the browser then refuses the cookie unless it is `Secure`,
 * `Path=/` and has no `Domain`, so nothing on a sibling host can plant or read
 * it. Plain loopback cannot use the prefix, which requires `Secure`.
 *
 * THE PORT IS IN THE NAME BECAUSE COOKIES HAVE NO PORT. RFC 6265 §1 says so
 * outright: `127.0.0.1:8475` and `127.0.0.1:9000` share one jar. Without the
 * suffix a second DeckSmith on this host overwrites the first one's cookie and
 * the viewer is silently logged out of it — and, since both derive the same key
 * from the same token file, each would have accepted the other's session as its
 * own. Neither happens now.
 *
 * IT IS NOT CONFIDENTIALITY. The browser still SENDS this cookie to every
 * listener on the host, whatever the name; scoping only stops them colliding and
 * stops one server honouring another's session. See `sessionBinding`.
 */
export function cookieName(tls: boolean, port: number): string {
  return `${tls ? "__Host-" : ""}decksmith-${port}`;
}

/**
 * What a session is valid FOR: this bind and this port, inside the MAC.
 *
 * The cookie name keeps two instances' cookies apart in the browser. This keeps
 * them apart in the server: a session minted by the instance on :8475 fails the
 * MAC on :9000 even though both derived `sessionKey` from the same token file,
 * so a second instance cannot be logged into with the first one's cookie.
 */
export function sessionBinding(host: string, port: number): string {
  return `${host}:${port}`;
}

function sessionMac(keys: AuthKeys, bind: string, exp: string): string {
  return createHmac("sha256", keys.sessionKey).update(`v2\n${bind}\n${exp}`).digest("base64url");
}

/**
 * A session is `<exp>.<mac>`, stateless: a restart keeps every browser logged
 * in, which is what "Run it again" after a restart needs. Revocation is
 * rotating the token file, because the key is derived from it — POST /logout
 * clears the browser's copy and nothing else, so a value captured before it
 * stays good until `exp`.
 */
export function mintSession(keys: AuthKeys, nowMs: number, bind: string): string {
  const exp = String(Math.floor(nowMs / 1000) + SESSION_SECONDS);
  return `${exp}.${sessionMac(keys, bind, exp)}`;
}

export function sessionValid(keys: AuthKeys, value: string, nowMs: number, bind: string): boolean {
  if (!/^\d{10}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [exp = "", mac = ""] = value.split(".");
  if (!timingSafeEqual(Buffer.from(sessionMac(keys, bind, exp)), Buffer.from(mac))) return false;
  const expMs = Number(exp) * 1000;
  // The upper bound refuses a value minted under a future clock, or by a build
  // with a longer lifetime, rather than honouring it for years.
  return nowMs < expMs && expMs <= nowMs + SESSION_SECONDS * 1000 + SKEW_MS;
}

/** Every value of cookie `name`. Several may arrive; the caller accepts any valid one. */
export function cookieValues(header: string | undefined, name: string): string[] {
  if (!header) return [];
  const out: string[] = [];
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === name) out.push(pair.slice(at + 1).trim());
  }
  return out;
}

export function sessionCookie(name: string, value: string, tls: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${tls ? "; Secure" : ""}`;
}

export function clearedCookie(name: string, tls: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${tls ? "; Secure" : ""}`;
}
