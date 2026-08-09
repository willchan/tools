# Pushing a New Build to TestFlight

This is the regular workflow for deploying a new build to TestFlight. Setup is already complete — just follow these steps each time you want to release.

## Quick Summary

1. **Test locally:** `bunx playwright test && bun run typecheck`
2. **Commit & push:** `git commit && git push origin main`
3. **Trigger build:** GitHub Actions → iOS TestFlight → Run workflow
4. **Monitor:** Build runs ~18 minutes
5. **Validate:** TestFlight app on your device within 2-5 minutes

---

## Detailed Steps

### Step 1: Verify Code is Ready

**Run tests locally** (must all pass before triggering build):

```bash
cd /Users/willchan/github/tools/workout-tracker

# TypeScript validation
bun run typecheck

# All E2E tests (this is what gates the build)
bunx playwright test
```

**If tests fail:** Fix the code, run tests again until green, then proceed.

### Step 2: Commit & Push

```bash
git add .
git commit -m "feat: describe your changes

- Include what changed
- Why it changed
- Any manual testing notes"

git push origin main
```

You can push anytime — the workflow only runs when you manually trigger it (Step 4).

### Step 3: Optional — Update Version

Only do this if you're releasing a new version (not for every build).

**Edit `ios/App/App.xcodeproj/project.pbxproj`:**

Find these two lines in the `App` target:
```
MARKETING_VERSION = 1.0.0;
CURRENT_PROJECT_VERSION = 5;
```

Update to your new version:
```
MARKETING_VERSION = 1.0.1;      # Semver: major.minor.patch
CURRENT_PROJECT_VERSION = 6;    # Just increment this number
```

Then commit:
```bash
git add ios/App/App.xcodeproj/project.pbxproj
git commit -m "chore: bump to v1.0.1 (build 6)"
git push origin main
```

### Step 4: Trigger the TestFlight Build

1. Open GitHub Actions: https://github.com/willchan/tools/actions
2. Find and click the **"iOS TestFlight"** workflow
3. Click the **"Run workflow"** button
4. Select **`main`** branch
5. Click **"Run workflow"**

The workflow will start immediately. You can watch it run in real-time.

**What it does:**
- Builds the Capacitor iOS project
- Imports signing certificates
- Creates an Xcode archive
- Exports an `.ipa` file
- Uploads to App Store Connect / TestFlight

**Expected duration:** ~15–18 minutes

### Step 5: Monitor the Build

Watch the workflow on GitHub:
- Green checkmark ✅ = upload succeeded
- Red X ❌ = build failed (see logs)

If it fails, check the logs for:
- **Code signing errors** → Verify secrets are up-to-date
- **Build failures** → Tests likely should have caught this; review code
- **Upload errors** → Temporary Apple issue; retry later

### Step 6: Validate in TestFlight

**On your iPhone:**

1. Open the **TestFlight** app
2. Navigate to **"Apps"** tab
3. Look for **"Workout Tracker"** in the list
4. Tap to view the build status (should say "Available to Install" or "Ready to Update")
5. Tap **Install** or **Update**
6. Once installed, open the app and smoke test:
   - ✅ App launches without crash
   - ✅ Home screen loads with "Start Next Workout" button
   - ✅ Start a quick workout and verify rest timer works
   - ✅ Notification fires at end of rest
   - ✅ Lock screen shows Live Activity (iOS 16.2+)

**Timeline:** Build appears in TestFlight within 2–5 minutes of successful upload.

---

## Troubleshooting

| Issue | Symptom | Fix |
|-------|---------|-----|
| **Tests fail locally** | Red X in test output | Fix code and re-run tests; don't push until green |
| **Workflow doesn't start** | No workflow run appears | Verify you're on the `main` branch; refresh GitHub Actions page |
| **Code signing fails** | "Certificate not found" in logs | Signing certificates are stored in GitHub Secrets. Nothing to do — contact repo maintainer if it persists. |
| **Build appears stuck** | Workflow hasn't updated in 15+ min | GitHub runners sometimes stall. Cancel and retry. |
| **Build not in TestFlight** | App Store Connect shows upload failed | Check workflow logs for errors; likely temporary Apple issue. Retry in 10 minutes. |
| **Old version shows** | TestFlight shows v1.0.0 instead of v1.0.1 | Apple caches version metadata. Refresh TestFlight app or wait 5 min and restart. |

---

## Version Numbering

- **`MARKETING_VERSION`** (e.g., `1.0.1`): User-facing version number. Increment for each public release.
  - `X` = Major (breaking changes)
  - `Y` = Minor (new features)
  - `Z` = Patch (bug fixes)

- **`CURRENT_PROJECT_VERSION`** (e.g., `6`): Internal build number. Increments every upload.
  - Must be higher than the previous build or TestFlight rejects it.
  - Not visible to users.

---

## Reference

- **Workflow file:** `.github/workflows/ios-testflight.yml`
- **Setup docs:** [`TESTFLIGHT_SETUP.md`](TESTFLIGHT_SETUP.md) (one-time setup, already complete)
- **iOS native setup:** [`MANUAL_SETUP.md`](MANUAL_SETUP.md) (Live Activity widget — already set up; editing it needs no Xcode, see that doc)
- **GitHub Actions logs:** https://github.com/willchan/tools/actions
