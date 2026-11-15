import BroskiCore
import Foundation

/// The repository checkout this package sits in.
let repository = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

let config = PhoneConfig(
    deviceName: "Test iPhone", platform: .ios, clientName: "BroskiCore tests",
    clientVersion: "0.0.0")

struct MachineEnded: Error {}

/// Pulls the machine's events until its status satisfies `done`.
func events(of machine: Machine, until done: (MachineStatus) -> Bool) async throws {
    while !done(machine.status()) {
        guard await machine.nextEvent() != nil else { throw MachineEnded() }
    }
}

/// The UI's side of a session view, as an app model keeps it: it assigns what each update carries and
/// never reduces (`docs/architecture/mobile-core.md`, "The update protocol").
struct Replica {
    var snapshot: SessionSnapshot?
    var resets = 0
    var batches = 0

    mutating func apply(_ update: SessionUpdate) {
        switch update {
        case .reset(_, _, let snapshot, _):
            self.snapshot = snapshot
            resets += 1
        case .changes(let changes, _):
            for change in changes {
                snapshot?.apply(change)
            }
            batches += 1
        case .ended:
            break
        }
    }
}

extension SessionSnapshot {
    mutating func apply(_ change: SessionChange) {
        switch change {
        case .runChanged(let run): self.run = run
        case .runItemAppended(let item): run?.items.append(item)
        case .runItemReplaced(let index, let item): run?.items[Int(index)] = item
        case .runItemsDropped(let count, let droppedItems):
            run?.items.removeFirst(Int(count))
            run?.droppedItems = droppedItems
        case .blockOpened(let block): blocks.append(block)
        case .blockTextChanged(let blockId, let text):
            if let index = blocks.firstIndex(where: { $0.blockId == blockId }) {
                blocks[index].text = text
            }
        case .blockClosed(let blockId): blocks.removeAll { $0.blockId == blockId }
        case .toolOpened(let tool): tools.append(tool)
        case .toolChanged(let tool):
            if let index = tools.firstIndex(where: { $0.toolCallId == tool.toolCallId }) {
                tools[index] = tool
            }
        case .toolClosed(let toolCallId): tools.removeAll { $0.toolCallId == toolCallId }
        case .interactionAdded(let interaction): interactions.append(interaction)
        case .interactionRemoved(let interactionId): interactions.removeAll { $0.id == interactionId }
        case .queueChanged(let items): queue = items
        case .modelChanged(let modelId, let thinking):
            self.modelId = modelId
            self.thinking = thinking
        case .modesChanged(let modes): self.modes = modes
        case .usageChanged(let usage): self.usage = usage
        case .compactionChanged(let compaction): self.compaction = compaction
        case .retryChanged(let retry): self.retry = retry
        case .outcomeChanged(let outcome): lastOutcome = outcome
        case .noticeShown, .errorShown, .extensionReceived, .inputReturned: break
        }
    }
}
