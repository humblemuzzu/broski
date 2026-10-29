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
