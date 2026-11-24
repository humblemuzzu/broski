import BroskiCore
import SwiftUI

struct ScreenAuthSheet: View {
    let machineName: String
    let schemes: [AuthScheme]
    let initialUsername: String
    let errorMessage: String?
    let onSubmit: (String, String, Bool) -> Void
    let onCancel: () -> Void

    @State private var username: String
    @State private var password = ""
    @State private var remember = true

    init(
        machineName: String,
        schemes: [AuthScheme],
        initialUsername: String = "",
        errorMessage: String?,
        onSubmit: @escaping (String, String, Bool) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.machineName = machineName
        self.schemes = schemes
        self.initialUsername = initialUsername
        self.errorMessage = errorMessage
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _username = State(initialValue: initialUsername)
    }

    private var needsUsername: Bool {
        schemes.contains(.appleCredentials)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    if needsUsername {
                        TextField("Mac username", text: $username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    SecureField("Mac password", text: $password)
                        .textContentType(.password)
                    Toggle("Remember on this iPhone", isOn: $remember)
                } header: {
                    Text("Sign in to \(machineName)")
                } footer: {
                    Text("Sent end-to-end encrypted through Broski Link directly to macOS Screen Sharing. Saved only in this iPhone's Keychain when remembered.")
                }
            }
            .navigationTitle("Mac Login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Connect") {
                        onSubmit(username.trimmingCharacters(in: .whitespacesAndNewlines), password, remember)
                        password = ""
                    }
                    .disabled(password.isEmpty || (needsUsername && username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
        }
    }
}

struct ScreenTextEntrySheet: View {
    let isPassword: Bool
    let onSend: (String, Bool) -> Void
    let onCancel: () -> Void

    @State private var text = ""
    @State private var pressReturn = true

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if isPassword {
                        SecureField("Password", text: $text)
                            .textContentType(.password)
                    } else {
                        TextField("Text to type on Mac", text: $text)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    Toggle("Press Return after typing", isOn: $pressReturn)
                } footer: {
                    Text(
                        isPassword
                            ? "Use Face ID / Passwords AutoFill here, then send straight into the Mac's active password field. Cleared immediately."
                            : "Types directly into the active window on your Mac."
                    )
                }
            }
            .navigationTitle(isPassword ? "Type Password" : "Type Text")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        let toSend = text
                        text = ""
                        onSend(toSend, pressReturn)
                    }
                    .disabled(text.isEmpty)
                }
            }
        }
    }
}

struct ScreenDisabledView: View {
    let machineName: String
    let detail: String
    let onRetry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Screen Sharing Is Off", systemImage: "display.trianglebadge.exclamationmark")
        } description: {
            Text("On \(machineName), open System Settings → General → Sharing and turn on Screen Sharing once.\n\n\(detail)")
        } actions: {
            Button("Try Again", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
