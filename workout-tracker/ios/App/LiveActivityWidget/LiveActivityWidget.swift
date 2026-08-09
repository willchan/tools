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
// display-ready text), setProgress ("x/y"), and restEndTime (a stringified
// epoch-ms timestamp, empty string when not resting).
//
// Every presentation (lock screen, expanded island, compact/minimal island)
// makes rest-vs-active an explicit state, not just "is there a timer or
// not": orange tint while resting vs. the accent color while active, plus
// (see brandedIcon below) an orange ring around the app icon itself while
// resting — so a glance at the pill alone tells you which one you're in,
// even before you've registered whether digits are present.
//
// LiveActivityIcon (Assets.xcassets, in this same target folder) is the app
// icon. It's shown everywhere this widget renders an icon — lock screen
// banner, expanded island, and compact/minimal island — in *both* the
// active and resting states, so the pill always reads as *this* app's
// activity rather than a generic system glyph a glance could mistake for
// any other running timer (Clock app, another app's Live Activity, ...).
// brandedIcon() draws a ring around it while resting rather than swapping
// the icon out for a bare SF Symbol (or overlaying a small badge glyph —
// illegible at this scale, and clipped by the system's automatic circular
// mask on the `minimal` presentation), so app identity and rest-vs-active
// state are both visible at once even in the compact/minimal island's
// single small glyph slot.

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
                brandedIcon(size: 20, cornerRadius: 5, isResting: restEndTime != nil)
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
                brandedIcon(size: 18, cornerRadius: nil, isResting: restEndTime != nil)
            }
            .keylineTint(restEndTime != nil ? Color.orange : Color.accentColor)
        }
    }

    // The app icon for the compact/minimal Dynamic Island, ringed in orange
    // while resting. `size` drives both the icon's frame and the ring's
    // line width, so callers just pick one number per slot. `cornerRadius`
    // selects the shape: a rounded square (compact leading slot, matching
    // the app's normal icon shape) when non-nil, a circle (minimal slot)
    // when nil — the ring reuses the exact same shape as the clip, so on
    // `minimal`, where the system additionally forces its own circular
    // mask on whatever this returns, the ring already coincides with that
    // mask instead of a corner badge that would fall outside it and get
    // clipped away.
    private func brandedIcon(size: CGFloat, cornerRadius: CGFloat?, isResting: Bool) -> some View {
        let icon = Image("LiveActivityIcon")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
        let ringWidth = size * 0.14

        return Group {
            if let cornerRadius {
                let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                icon.clipShape(shape).overlay {
                    if isResting {
                        shape.strokeBorder(Color.orange, lineWidth: ringWidth)
                    }
                }
            } else {
                icon.clipShape(Circle()).overlay {
                    if isResting {
                        Circle().strokeBorder(Color.orange, lineWidth: ringWidth)
                    }
                }
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
}
