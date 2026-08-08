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
// not": a timer glyph + orange tint while resting, the app icon while
// active — so a glance at the pill alone tells you which one you're in,
// even before you've registered whether digits are present.
//
// LiveActivityIcon (Assets.xcassets, in this same target folder) is the app
// icon — used on the lock screen banner and in place of a generic emoji in
// the compact/minimal Dynamic Island so the pill reads as *this* app's
// activity, not a generic system glyph.

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
                    Image("LiveActivityIcon")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 20, height: 20)
                        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
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
                    Image("LiveActivityIcon")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 18, height: 18)
                        .clipShape(Circle())
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
