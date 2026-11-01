import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_test/flutter_test.dart';

class _BrokenStore extends StorageService {
  @override
  Future<String?> getSelectedAgentType() async => throw StateError('locked');
}

class _Stored extends StorageService {
  _Stored(this.wire);

  final String wire;

  @override
  Future<String?> getSelectedAgentType() async => wire;
}

void main() {
  test('a store that cannot be read leaves the default and is ready', () async {
    final notifier = SelectedBackendNotifier(_BrokenStore());
    addTearDown(notifier.dispose);
    await notifier.ready;
    expect(notifier.state, const LegacySelection(AgentType.claudeCode));
  });

  test('ready completes once the stored choice is applied', () async {
    final notifier = SelectedBackendNotifier(_Stored('contract:claude-code'));
    addTearDown(notifier.dispose);
    expect(notifier.state, const LegacySelection(AgentType.claudeCode));
    await notifier.ready;
    expect(notifier.state.wire, 'contract:claude-code');
  });
}
