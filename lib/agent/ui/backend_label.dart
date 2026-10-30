import 'package:broski/contract/generated/contract.dart';

/// The name a person reads for a backend. Display only: the one place the
/// app core may name a backend, so nothing here can steer behaviour by it.
String backendLabel(BackendId backend) => switch (backend) {
  BackendId.claudeCode => 'Claude Code',
  BackendId.codex => 'Codex',
  BackendId.opencode => 'OpenCode',
  BackendId.pi => 'Pi',
  BackendId.piDurable => 'Pi Durable',
};

/// The two letters a compact chip carries for a backend.
String backendBadge(BackendId backend) => switch (backend) {
  BackendId.claudeCode => 'CC',
  BackendId.codex => 'CX',
  BackendId.opencode => 'OC',
  BackendId.pi => 'PI',
  BackendId.piDurable => 'PD',
};

/// One line saying what a backend is, for the place a person chooses one.
String backendBlurb(BackendId backend) => switch (backend) {
  BackendId.claudeCode => 'Anthropic Claude Code SDK',
  BackendId.codex => 'OpenAI Codex app-server',
  BackendId.opencode => 'Open source AI coding agent',
  BackendId.pi => 'Multi-provider coding agent',
  BackendId.piDurable => 'Pi sessions that survive bridge restarts',
};

/// The picture that stands for a backend, if the app ships one.
String? backendLogoAsset(BackendId backend) => switch (backend) {
  BackendId.pi => 'assets/logos/pi/pi-logo-dark.svg',
  BackendId.claudeCode ||
  BackendId.codex ||
  BackendId.opencode ||
  BackendId.piDurable => null,
};
