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

## 4. Provisioning profiles: create the App Store ones by hand once

Originally this doc claimed nothing manual was needed here —
`-allowProvisioningUpdates` was expected to resolve (and create, if
needed) the right profile per target automatically at build time. That's
true once a device has ever been registered on the team, but **on a
brand-new team with zero registered devices, it isn't**: automatic
signing's resolver hits a development-profile-creation step as part of
gathering provisioning inputs even for an App Store archive, and that step
hard-fails with "Your team has no devices from which to generate a
provisioning profile" — confirmed by two failed CI runs on this exact
error, unrelated to CODE_SIGN_IDENTITY/CODE_SIGN_STYLE (tried both with
and without an explicit override). App Store distribution profiles
themselves don't need any device — it's specifically automatic *creation*
that trips over the zero-device team.

Fix: create the App Store distribution profile for each target's bundle ID
manually (one time), so `-allowProvisioningUpdates` only has to *discover*
an existing profile instead of creating one:

developer.apple.com → Certificates, IDs & Profiles → Profiles → **+** →
**App Store** (under Distribution) → select the App ID → select the
Apple Distribution certificate from step 3 → name it (anything) → Generate.
Repeat once per bundle ID that exists as of whenever this is read —
`com.willchan.workouttracker` and, once the widget extension target
exists, `com.willchan.workouttracker.LiveActivityWidget`. Nothing needs to
be downloaded or added as a secret; `-allowProvisioningUpdates` picks them
up by bundle ID automatically once they exist.

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
