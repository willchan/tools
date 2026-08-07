# One-time TestFlight signing setup

Everything here after enrollment is a few clicks in a browser — no Mac
needed. Claude generated the private key + CSR for step 3 already (sent
separately, not committed to the repo — a signing private key must never
go into git history).

## 1. Enroll in the Apple Developer Program

developer.apple.com/programs/enroll → Individual → $99/yr, credit card +
identity verification. Approval is usually near-instant, sometimes up to a
day. Once approved, note your **Team ID** from developer.apple.com/account
(Membership Details) — the `APPLE_TEAM_ID` secret below.

## 2. Create an App Store Connect API key

App Store Connect → Users and Access → Integrations → App Store Connect
API → Generate API Key. Role: "App Manager" is enough for uploading builds;
this same key is also used by CI to resolve provisioning automatically (see
step 4), which *usually* works fine at "App Manager" too — if the workflow's
Archive step ever fails with an access/permissions error, bump the key's
role to "Admin" and regenerate it. **Download the `.p8` immediately** —
Apple only lets you download it once. Note the Key ID and Issuer ID shown
on that page.

## 3. Register the App ID(s) and get a Distribution certificate

1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+**
   → App IDs → App → Bundle ID: **explicit**, `com.willchan.workouttracker`
   (already fixed in `capacitor.config.ts` — must match exactly). No extra
   capabilities need to be toggled here for the app as it stands today.
   Repeat for each additional target that gets added later — e.g. the Live
   Activity widget extension's `com.willchan.workouttracker.LiveActivityWidget`
   — just the App ID, nothing else needed per target.
2. Certificates → **+** → Apple Distribution → upload `distribution.csr`
   (the file Claude sent you) → download the resulting `.cer`.
3. Turn it into the `.p12` the CI job needs. Send the downloaded `.cer`
   back in this chat and Claude can do the conversion (it still has the
   matching private key on disk this session), or run it yourself:
   ```
   openssl x509 -inform DER -in distribution.cer -out distribution.pem
   openssl pkcs12 -export -inkey distribution.key -in distribution.pem \
     -out distribution.p12 -passout pass:<choose a password>
   ```
   Keep that password — it's the `APPLE_DIST_CERT_PASSWORD` secret below.

## 4. Provisioning profiles: nothing to do here

No manual profile-creation step. The app has (or will have) multiple
targets — `App`, and eventually the widget extension — each with its own
bundle ID and needing its own profile. A single profile pinned via repo
secret only covers one bundle ID at a time, and `xcodebuild`'s command-line
signing overrides apply to every target in a build, so they can't express
"this profile for App, that one for the widget." Instead, `ios-testflight.yml`
passes `-allowProvisioningUpdates` plus the App Store Connect API key from
step 2, so Xcode resolves (and creates, if needed) the right profile per
target automatically at build time — as long as the App ID from step 3
exists for each target.

## 5. Add repo secrets

GitHub → this repo → Settings → Secrets and variables → Actions → New
repository secret. Base64-encode the binary files first
(`base64 -i file -o file.b64` on macOS, `base64 -w0 file > file.b64` on
Linux) and paste the resulting text as the secret value:

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Team ID from step 1 |
| `APPLE_DIST_CERT_P12_BASE64` | base64 of `distribution.p12` |
| `APPLE_DIST_CERT_PASSWORD` | the password chosen in step 3 |
| `ASC_API_KEY_ID` | Key ID from step 2 |
| `ASC_API_ISSUER_ID` | Issuer ID from step 2 |
| `ASC_API_KEY_P8_BASE64` | base64 of the `.p8` from step 2 |
| `CI_KEYCHAIN_PASSWORD` | any random string — only locks the throwaway CI keychain for the duration of one job |

If you created an `APPLE_PROVISIONING_PROFILE_BASE64` secret from an
earlier version of this doc, it's no longer used — fine to leave it or
delete it.

## 6. Run it

Actions tab → "iOS TestFlight" workflow → Run workflow. ~10-15 min later
the build shows up in App Store Connect → TestFlight, and (since you're
the account holder, you're automatically an internal tester — no Beta App
Review needed) in the TestFlight app on your phone.
