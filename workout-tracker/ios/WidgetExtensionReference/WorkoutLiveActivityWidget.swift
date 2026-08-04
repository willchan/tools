// Reference implementation for the Live Activity widget extension described
// in ios/MANUAL_SETUP.md. Not part of any Xcode target — Xcode's "Widget
// Extension" wizard generates the real target and file layout; this file's
// body is what to paste into the generated `*LiveActivity.swift` file.
//
// Content-state keys here match src/native/liveActivity.ts's
// `toContentState()`: exerciseName, setProgress ("x/y"), and restEndTime (a
// stringified epoch-ms timestamp, empty string when not resting).

import ActivityKit
import WidgetKit
import SwiftUI

struct WorkoutLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        // GenericAttributes is provided by the capacitor-live-activity plugin —
        // see ios/MANUAL_SETUP.md step 3 for how to add it to this target.
        ActivityConfiguration(for: GenericAttributes.self) { context in
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.values["dayName"] ?? "Workout")
                    .font(.headline)
                Text(context.state.values["exerciseName"] ?? "")
                    .font(.subheadline)
                HStack {
                    Text("Set \(context.state.values["setProgress"] ?? "")")
                    Spacer()
                    if let restEndTime = restEndDate(context.state.values["restEndTime"]) {
                        Text(timerInterval: Date.now...restEndTime, countsDown: true)
                    }
                }
                .font(.caption)
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.values["exerciseName"] ?? "")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("Set \(context.state.values["setProgress"] ?? "")")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let restEndTime = restEndDate(context.state.values["restEndTime"]) {
                        Text(timerInterval: Date.now...restEndTime, countsDown: true)
                    }
                }
            } compactLeading: {
                Text("🏋️")
            } compactTrailing: {
                Text(context.state.values["setProgress"] ?? "")
            } minimal: {
                Text("🏋️")
            }
        }
    }

    private func restEndDate(_ raw: String?) -> Date? {
        guard let raw, let ms = Double(raw), ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }
}
