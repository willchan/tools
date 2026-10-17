// Adds a freshly uploaded build to TestFlight beta groups, so nobody has to
// tick it into each group by hand in App Store Connect.
//
// App Store Connect's per-group "automatic distribution" only applies to
// Xcode Cloud builds; for builds uploaded any other way (our altool upload)
// the group reads "Manual for Xcode Builds", so assignment goes through the
// API instead. Run by ios-testflight.yml after the upload step:
//
//   bun ios/scripts/assign-testflight-groups.ts <bundle-id> <build-number>
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (the .p8), TESTFLIGHT_GROUPS
// (comma-separated group names). The API key needs the App Manager role or
// higher, which the upload already requires.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const API = "https://api.appstoreconnect.apple.com/v1";
const POLL_INTERVAL_MS = 30_000;
const POLL_TIMEOUT_MS = 30 * 60_000;

const [bundleId, buildNumber] = process.argv.slice(2);
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, TESTFLIGHT_GROUPS } = process.env;
if (!bundleId || !buildNumber || !ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH || !TESTFLIGHT_GROUPS) {
  console.error("usage: assign-testflight-groups.ts <bundle-id> <build-number> (see header for env)");
  process.exit(2);
}
const groupNames = TESTFLIGHT_GROUPS.split(",").map((s) => s.trim()).filter(Boolean);
const privateKey = createPrivateKey(readFileSync(ASC_KEY_PATH));

// ES256 JWT, as App Store Connect requires. Tokens may live at most 20
// minutes, so a fresh one is minted per request rather than once up front.
function token(): string {
  const b64 = (v: object | Buffer) =>
    (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })}.${b64({
    iss: ASC_ISSUER_ID,
    iat: now,
    exp: now + 15 * 60,
    aud: "appstoreconnect-v1",
  })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${b64(signature)}`;
}

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
}

async function api(path: string, init: RequestInit = {}): Promise<{ data: Resource[] } | null> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const q = encodeURIComponent;

const [app] = (await api(`/apps?filter[bundleId]=${q(bundleId)}`))!.data;
if (!app) throw new Error(`No App Store Connect app with bundle ID ${bundleId}`);

// Resolve groups before waiting on processing, so a typo fails in seconds.
const groups = (await api(`/betaGroups?filter[app]=${app.id}&limit=200`))!.data;
const targets = groupNames.map((name) => {
  const group = groups.find((g) => g.attributes.name === name);
  if (!group) {
    const known = groups.map((g) => g.attributes.name).join(", ");
    throw new Error(`No beta group named "${name}" (have: ${known})`);
  }
  return group;
});

// The build shows up a few minutes after altool returns, then sits in
// PROCESSING; groups only accept it once it's VALID.
const deadline = Date.now() + POLL_TIMEOUT_MS;
let build: Resource | undefined;
for (;;) {
  [build] = (await api(`/builds?filter[app]=${app.id}&filter[version]=${q(buildNumber)}&limit=1`))!.data;
  const state = build?.attributes.processingState ?? "NOT_FOUND";
  console.log(`Build ${buildNumber}: ${state}`);
  if (state === "VALID") break;
  if (state === "FAILED" || state === "INVALID") throw new Error(`Build ${buildNumber} is ${state}`);
  if (Date.now() > deadline) throw new Error(`Build ${buildNumber} still ${state} after 30 min`);
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

for (const group of targets) {
  await api(`/betaGroups/${group.id}/relationships/builds`, {
    method: "POST",
    body: JSON.stringify({ data: [{ type: "builds", id: build!.id }] }),
  });
  console.log(`Added build ${buildNumber} to "${group.attributes.name}"`);
}
