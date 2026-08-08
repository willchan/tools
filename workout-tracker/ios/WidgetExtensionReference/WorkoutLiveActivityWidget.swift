// Reference implementation for the Live Activity widget extension described
// in ios/MANUAL_SETUP.md. Not part of any Xcode target — Xcode's "Widget
// Extension" wizard generates the real target and file layout; this file's
// body is what to paste into the generated `*LiveActivity.swift` file.
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
// not": a timer glyph + orange tint while resting, a dumbbell glyph while
// active — so a glance at the pill alone tells you which one you're in,
// even before you've registered whether digits are present.
//
// LiveActivityIcon (Assets.xcassets) is the app icon, added to the lock
// screen banner so it doesn't read as anonymous system text.

import ActivityKit
import WidgetKit
import SwiftUI

struct WorkoutLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        // GenericAttributes is provided by the capacitor-live-activity plugin —
        // see ios/MANUAL_SETUP.md step 3 for how to add it to this target.
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

            DynamicIsland {
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
                if restEndTime != nil {
                    Image(systemName: "timer")
                        .foregroundStyle(.orange)
                } else {
                    Text("🏋️")
                }
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
                if let restEndTime {
                    Image(systemName: "timer")
                        .foregroundStyle(.orange)
                } else {
                    Text("🏋️")
                }
            }
            .keylineTint(restEndTime != nil ? Color.orange : Color.accentColor)
        }
    }

    private func restEndDate(_ raw: String?) -> Date? {
        guard let raw, let ms = Double(raw), ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }
}
