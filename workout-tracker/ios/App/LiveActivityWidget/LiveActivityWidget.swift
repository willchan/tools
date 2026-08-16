// The Live Activity's widget UI. This lives directly in the widget
// extension's target folder — LiveActivityWidget/ is a Xcode "file system
// synchronized group" (see project.pbxproj), so any .swift file dropped in
// here is picked up by the target automatically, no Xcode project-file
// editing required. That means this file can be edited and shipped purely
// through git + the "iOS TestFlight" GitHub Actions workflow
// (ios-testflight.yml) — no local Xcode needed for day-to-day iteration.
// (Referenced by LiveActivityWidgetBundle.swift's @main WidgetBundle.)
//
// Content-state keys here match src/native/liveActivity.ts's
// `toContentState()`: exerciseName (a human-readable exercise catalog name,
// e.g. "Hanging Leg Raise" — resolved from the exerciseId slug on the TS
// side by src/logic/exerciseName.ts, so this file only ever deals with
// display-ready text), setProgress ("x/y"), and restEndTime/restStartTime
// (each a stringified epoch-ms timestamp, empty string when not resting).
//
// Every presentation (lock screen, expanded island, compact/minimal island)
// makes rest-vs-active an explicit state, not just "is there a timer or
// not": orange tint while resting vs. the accent color while active, plus
// (see brandedIcon below) a ring around the app icon itself while resting
// that depletes clockwise over the rest period — full right as rest starts,
// gone right as the next set is due — so a glance at the pill alone tells
// you which state you're in *and* roughly how much rest is left, even
// before you've registered whether digits are present. That last part
// matters most in `minimal`: it's the one presentation with no digits at
// all, just this one glyph, so the ring there isn't a redundant echo of
// nearby text the way it would be next to `compactTrailing`'s countdown —
// it's the only signal.
//
// LiveActivityIcon (Assets.xcassets, in this same target folder) is the app
// icon. It's shown everywhere this widget renders an icon — lock screen
// banner, expanded island, and compact/minimal island — in *both* the
// active and resting states, so the pill always reads as *this* app's
// activity rather than a generic system glyph a glance could mistake for
// any other running timer (Clock app, another app's Live Activity, ...).
// brandedIcon() draws the ring around it while resting rather than swapping
// the icon out for a bare SF Symbol (or overlaying a small badge glyph —
// illegible at this scale, and clipped by the system's automatic circular
// mask on the `minimal` presentation), so app identity and rest-vs-active
// state/progress are all visible at once even in the compact/minimal
// island's single small glyph slot.

import ActivityKit
import WidgetKit
import SwiftUI

struct WorkoutLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        // GenericAttributes is provided by the capacitor-live-activity plugin
        // — see GenericAttributes.swift in this same folder (copied in from
        // the plugin's Shared package; see ios/MANUAL_SETUP.md).
        ActivityConfiguration(for: GenericAttributes.self) { context in
            let restEndTime = restEndDate(context.state.values["restEndTime"])

            HStack(alignment: .top, spacing: 12) {
                Image("LiveActivityIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                VStack(alignment: .leading, spacing: 4) {
                    Text(context.attributes.staticValues["dayName"] ?? "Workout")
                        .font(.headline)
                    Text(context.state.values["exerciseName"] ?? "")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    HStack {
                        if let restEndTime {
                            Label {
                                Text(timerInterval: Date.now...restEndTime, countsDown: true)
                                    .monospacedDigit()
                            } icon: {
                                Image(systemName: "timer")
                            }
                            .foregroundStyle(.orange)
                        } else {
                            Label("Set \(context.state.values["setProgress"] ?? "")", systemImage: "dumbbell.fill")
                        }
                        Spacer()
                        if restEndTime != nil {
                            Text("Set \(context.state.values["setProgress"] ?? "")")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .font(.caption)
                }
            }
            .padding()
        } dynamicIsland: { context in
            let restEndTime = restEndDate(context.state.values["restEndTime"])
            let restRange = restProgressRange(
                start: restStartDate(context.state.values["restStartTime"]),
                end: restEndTime
            )

            // dynamicIsland's closure type is a plain (Context) -> DynamicIsland,
            // not @ViewBuilder — so once a `let` precedes it, Swift's
            // single-expression implicit-return no longer applies and this
            // needs an explicit `return` (unlike the `content:` closure above,
            // which is @ViewBuilder and allows the same shape without one).
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.values["exerciseName"] ?? "")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("Set \(context.state.values["setProgress"] ?? "")")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let restEndTime {
                        Label {
                            Text(timerInterval: Date.now...restEndTime, countsDown: true)
                                .monospacedDigit()
                        } icon: {
                            Image(systemName: "timer")
                        }
                        .foregroundStyle(.orange)
                    } else {
                        Label("Working set", systemImage: "dumbbell.fill")
                    }
                }
            } compactLeading: {
                brandedIcon(size: 20, cornerRadius: 5, restRange: restRange)
            } compactTrailing: {
                if let restEndTime {
                    Text(timerInterval: Date.now...restEndTime, countsDown: true)
                        .monospacedDigit()
                        .foregroundStyle(.orange)
                        .frame(width: 42)
                } else {
                    Text(context.state.values["setProgress"] ?? "")
                }
            } minimal: {
                brandedIcon(size: 18, cornerRadius: nil, restRange: restRange)
            }
            .keylineTint(restEndTime != nil ? Color.orange : Color.accentColor)
        }
    }

    // The app icon for the compact/minimal Dynamic Island, ringed while
    // resting with a `ProgressView(timerInterval:)` that the system
    // animates continuously on its own — no repeated content-state pushes
    // needed — depleting from a full ring at rest's start to none at rest's
    // end, the same "hand SwiftUI a fixed date range once" trick
    // `Text(timerInterval:)` above already uses for the digits. `size`
    // drives the icon's frame, so callers just pick one number per slot.
    // `cornerRadius` selects the icon's own clip shape: a rounded square
    // (compact leading slot, matching the app's normal icon shape) when
    // non-nil, a circle (minimal slot) when nil — the ring itself is always
    // circular regardless, since `.circular` is the only
    // ProgressViewStyle that supports the animated `timerInterval` form.
    // `restRange` being nil (not resting, or a range that failed
    // restProgressRange()'s validation below) draws no ring at all, same as
    // the old `isResting == false` case.
    private func brandedIcon(size: CGFloat, cornerRadius: CGFloat?, restRange: ClosedRange<Date>?) -> some View {
        // The ring needs room outside the icon's own edge to read as a ring
        // rather than an overlapping stroke, so the icon shrinks slightly
        // whenever one is actually going to be drawn.
        let ringInset = size * 0.16
        let iconSize = restRange != nil ? size - ringInset * 2 : size
        let icon = Image("LiveActivityIcon")
            .resizable()
            .scaledToFit()
            .frame(width: iconSize, height: iconSize)

        // Only the clip shape actually differs per call site (rounded
        // square vs. circle) — the ring itself is always circular (see the
        // doc comment above), so it's applied once below rather than
        // duplicated per branch.
        return Group {
            if let cornerRadius {
                icon.clipShape(RoundedRectangle(cornerRadius: max(cornerRadius - ringInset, 2), style: .continuous))
            } else {
                icon.clipShape(Circle())
            }
        }
        .frame(width: size, height: size)
        .background {
            if let restRange {
                // `ProgressView(timerInterval:).progressViewStyle(.circular)`
                // is a system control with its own intrinsic size — unlike
                // the old `Shape.strokeBorder`, it won't stretch to fill
                // `.background`'s proposed size on its own, so it needs an
                // explicit frame or it can render smaller than the icon
                // it's meant to ring.
                ProgressView(timerInterval: restRange, countsDown: true)
                    .progressViewStyle(.circular)
                    .tint(.orange)
                    .frame(width: size, height: size)
            }
        }
    }

    private func restEndDate(_ raw: String?) -> Date? {
        guard let raw, let ms = Double(raw), ms > 0 else { return nil }
        let date = Date(timeIntervalSince1970: ms / 1000)
        // Must not return an end time that's already passed: every call site
        // feeds this straight into `Text(timerInterval: Date.now...date, ...)`,
        // and SwiftUI's `...` operator traps ("Range requires lowerBound <=
        // upperBound") once `date <= Date.now`. The countdown can legitimately
        // reach zero in real time before the next content-state push clears
        // restEndTime, and any re-render in that window (lock/unlock, Island
        // expand/collapse, ...) would otherwise crash the widget extension.
        return date > Date() ? date : nil
    }

    private func restStartDate(_ raw: String?) -> Date? {
        // No "must be in the future" check here, unlike restEndDate() above
        // — a rest start is expected to be in the past by the time this
        // renders. restProgressRange() below is what validates it against
        // the end date.
        guard let raw, let ms = Double(raw), ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    // The date range brandedIcon() hands to `ProgressView(timerInterval:)`.
    // Like `Text(timerInterval:)`, it traps ("Range requires lowerBound <=
    // upperBound") on an invalid range — this guards both directions: a
    // missing/unparseable restStartTime (e.g. a content-state push from
    // before this field existed) and a malformed or zero-duration push
    // where start ends up >= end. `end` itself is already guarded by
    // restEndDate() above before it ever reaches here, so this only needs
    // to check start against it; nil either way just means no ring, not a
    // crash.
    //
    // This validation would belong in ios/App/AppLogic per CLAUDE.md's
    // "New Swift logic goes in ios/App/AppLogic, with a test" (so it'd get
    // AppLogicTests coverage instead of relying on the Simulator smoke
    // test), but AppLogic isn't linked into the LiveActivityWidget
    // extension target — only App is (see "Link AppLogic into the App
    // target" in ios/MANUAL_SETUP.md) — and adding that link is an
    // Xcode-GUI-only step, same as adding a new unit test target, not
    // something scriptable from here. It lives beside restEndDate() above
    // instead, for the same reason that one already does.
    private func restProgressRange(start: Date?, end: Date?) -> ClosedRange<Date>? {
        guard let start, let end, start < end else { return nil }
        return start...end
    }
}
