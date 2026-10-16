import SwiftUI
import AppLogic

/// Layout only: everything shown comes from RemoteModel.display.
///
/// One fixed screen, no scrolling: on a watch the Digital Crown would
/// otherwise both scroll and adjust whatever control is focused (it changed
/// the rep count when it was meant to scroll). Set number in the title bar,
/// then exercise, weight, a compact middle row (reps, or the rest countdown
/// while rest locks Done), and one big button whose job WatchRemoteState
/// decides: Done, Skip Rest or Finish.
struct RemoteView: View {
    @EnvironmentObject private var model: RemoteModel
    @EnvironmentObject private var workout: WorkoutSessionController
    @State private var confirmingEnd = false

    var body: some View {
        NavigationStack {
            Group {
                switch model.display {
                case .idle(let awaiting, let waiting):
                    idle(awaiting: awaiting, waiting: waiting)
                case .active(let active):
                    activeWorkout(active)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if workout.isRunning {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { confirmingEnd = true } label: {
                            Image(systemName: "ellipsis")
                        }
                        .accessibilityLabel("Workout options")
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
    }

    private var title: String {
        guard case .active(let active) = model.display else { return "Workout" }
        let w = active.workout
        if w.allSetsDone { return "Done" }
        var title = "Set \(w.setNumber)/\(w.setTotal)"
        if w.isAmrap { title += " · AMRAP" } else if w.isBonus { title += " · Bonus" }
        return title
    }

    // MARK: - Idle

    @ViewBuilder
    private func idle(awaiting: Bool, waiting: Bool) -> some View {
        VStack(spacing: 8) {
            Spacer(minLength: 0)
            Text("No workout running on iPhone")
                .font(.headline)
                .multilineTextAlignment(.center)
            if waiting { waitingNote }
            Spacer(minLength: 0)
            Button("Start Workout") { model.start() }
                .buttonStyle(.borderedProminent)
                .disabled(awaiting)
        }
    }

    // MARK: - Active

    private func activeWorkout(_ active: ActiveWatchDisplay) -> some View {
        let w = active.workout
        let restLocked = active.primaryAction == .skipRest
        return VStack(spacing: 2) {
            Text(w.allSetsDone ? w.dayName : w.exerciseName)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if !w.allSetsDone {
                Text(weightLine(w))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }

            Spacer(minLength: 2)

            if active.waitingForPhone {
                waitingNote
            } else if w.allSetsDone {
                Text("All sets done")
                    .font(.title3)
            } else if restLocked, let remaining = active.restRemainingSeconds {
                restRow(remaining, enabled: !active.awaitingPhone)
            } else {
                repsRow(active, enabled: !active.awaitingPhone)
                if let remaining = active.restRemainingSeconds {
                    // Rest that doesn't lock Done (e.g. an accessory during a
                    // main set's rest): shown, skippable, but not in the way.
                    Button("Rest \(clock(remaining)) · Skip") { model.skipRest() }
                        .buttonStyle(.plain)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .disabled(active.awaitingPhone)
                }
            }

            Spacer(minLength: 2)

            primaryButton(active)
        }
    }

    private func primaryButton(_ active: ActiveWatchDisplay) -> some View {
        let (label, tint): (String, Color) = {
            switch active.primaryAction {
            case .done: return ("Done", .accentColor)
            case .skipRest: return ("Skip Rest", .orange)
            case .finish: return ("Finish", .green)
            }
        }()
        return Button(label) { model.primary() }
            .buttonStyle(.borderedProminent)
            .tint(tint)
            .disabled(!active.primaryEnabled)
    }

    private func repsRow(_ active: ActiveWatchDisplay, enabled: Bool) -> some View {
        let w = active.workout
        return HStack(spacing: 6) {
            roundButton("minus") { model.changeReps(by: -1) }
                .disabled(!enabled || active.reps <= 0)
            VStack(spacing: -2) {
                Text("\(active.reps)")
                    .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                Text(w.isAmrap ? "reps (\(w.reps)+)" : "reps")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(minWidth: 56)
            roundButton("plus") { model.changeReps(by: 1) }
                .disabled(!enabled || active.reps >= w.maxReps)
        }
    }

    private func restRow(_ remaining: Int, enabled: Bool) -> some View {
        HStack(spacing: 6) {
            Button("−15") { model.adjustRest(by: -15) }
                .buttonStyle(.bordered)
                .font(.caption)
                .frame(width: 44)
            Text(clock(remaining))
                .font(.system(size: 32, weight: .semibold, design: .rounded).monospacedDigit())
                .frame(minWidth: 70)
            Button("+15") { model.adjustRest(by: 15) }
                .buttonStyle(.bordered)
                .font(.caption)
                .frame(width: 44)
        }
        .disabled(!enabled)
    }

    private func roundButton(_ systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.circle)
    }

    private var waitingNote: some View {
        Label("Waiting for iPhone…", systemImage: "iphone.slash")
            .font(.footnote)
            .foregroundStyle(.orange)
    }

    private func weightLine(_ w: WatchWorkoutView) -> String {
        guard let plates = w.plateLabel else { return w.weightLabel }
        return "\(w.weightLabel) · \(plates.replacingOccurrences(of: " per side", with: "/side"))"
    }

    private func clock(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
