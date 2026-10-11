import SwiftUI
import AppLogic

/// Layout only: everything shown comes from RemoteModel.display.
struct RemoteView: View {
    @EnvironmentObject private var model: RemoteModel
    @EnvironmentObject private var workout: WorkoutSessionController
    @State private var confirmingEnd = false

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                switch model.display {
                case .idle(let awaiting, let waiting):
                    idle(awaiting: awaiting, waiting: waiting)
                case .active(let active):
                    activeWorkout(active)
                }
                if workout.isRunning {
                    Button("End Watch Workout", role: .destructive) { confirmingEnd = true }
                        .font(.footnote)
                        .padding(.top, 12)
                }
            }
        }
        .confirmationDialog(
            "End the workout on this watch? The iPhone workout keeps going.",
            isPresented: $confirmingEnd
        ) {
            Button("End Watch Workout", role: .destructive) { model.endWatchWorkout() }
        }
    }

    @ViewBuilder
    private func idle(awaiting: Bool, waiting: Bool) -> some View {
        Text("No workout running on iPhone")
            .font(.headline)
            .multilineTextAlignment(.center)
        Button("Start Workout") { model.start() }
            .buttonStyle(.borderedProminent)
            .disabled(awaiting)
        if waiting { waitingNote }
    }

    @ViewBuilder
    private func activeWorkout(_ active: ActiveWatchDisplay) -> some View {
        let w = active.workout
        Text(setLine(w))
            .font(.caption2)
            .foregroundStyle(.secondary)
        Text(w.exerciseName)
            .font(.headline)
            .multilineTextAlignment(.center)
        Text(w.weightLabel)
            .font(.title3)
        if let plates = w.plateLabel {
            Text(plates)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }

        if let remaining = active.restRemainingSeconds {
            rest(remaining, disabled: active.awaitingPhone)
        }

        if active.waitingForPhone { waitingNote }

        if w.allSetsDone {
            Button("Finish") { model.finish() }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(active.awaitingPhone)
        } else {
            Stepper(value: $model.reps, in: 0...max(w.maxReps, 0)) {
                Text("\(model.reps) reps\(w.isAmrap ? "+" : "")")
            }
            Button("Done") { model.completeSet() }
                .buttonStyle(.borderedProminent)
                .disabled(!active.doneEnabled)
        }
    }

    private func rest(_ remaining: Int, disabled: Bool) -> some View {
        VStack(spacing: 4) {
            Text(String(format: "%d:%02d", remaining / 60, remaining % 60))
                .font(.system(.title, design: .rounded).monospacedDigit())
            HStack {
                Button("−15") { model.adjustRest(by: -15) }
                Button("Skip") { model.skipRest() }
                Button("+15") { model.adjustRest(by: 15) }
            }
            .font(.caption)
            .disabled(disabled)
        }
        .padding(.vertical, 4)
    }

    private var waitingNote: some View {
        Label("Waiting for iPhone…", systemImage: "iphone.slash")
            .font(.footnote)
            .foregroundStyle(.orange)
    }

    private func setLine(_ w: WatchWorkoutView) -> String {
        var parts = ["\(w.dayName) · Set \(w.setNumber) of \(w.setTotal)"]
        if w.isAmrap { parts.append("AMRAP") }
        if w.isBonus { parts.append("Bonus") }
        return parts.joined(separator: " · ")
    }
}
