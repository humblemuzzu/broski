import 'package:broski/models/agent_type.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/agent_type_restore.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/network_monitor_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

ProviderContainer containerWith(Map<String, String> stored) {
  FlutterSecureStorage.setMockInitialValues(stored);
  return ProviderContainer(
    overrides: [
      connectionProvider.overrideWith(
        (ref) => ConnectionNotifier(
          ref,
          ref.read(storageServiceProvider),
          ref.read(webSocketServiceProvider),
          NetworkMonitorService(),
          ref.read(bridgeServiceProvider),
        ),
      ),
    ],
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('restoredAgentType', () {
    test(
      'never restores a stored experimental backend while its flag is off',
      () {
        expect(
          restoredAgentType('pi-durable', piDurableEnabled: false),
          AgentType.opencode,
        );
      },
    );

    test('restores pi-durable once the flag is on', () {
      expect(
        restoredAgentType('pi-durable', piDurableEnabled: true),
        AgentType.piDurable,
      );
    });

    test('ignores the flag for every non-experimental backend', () {
      for (final type in [
        AgentType.opencode,
        AgentType.claudeCode,
        AgentType.codex,
        AgentType.pi,
      ]) {
        expect(
          restoredAgentType(type.wireValue, piDurableEnabled: false),
          type,
        );
      }
    });

    test('nothing persisted leaves the boot backend to the caller', () {
      expect(restoredAgentType(null, piDurableEnabled: true), isNull);
    });
  });

  group('AgentTypeNotifier boot restore', () {
    test(
      'boots off a stored pi-durable backend while the flag is off',
      () async {
        final container = containerWith({
          'broski_selected_agent_type': 'pi-durable',
          'broski_pi_durable_enabled': 'false',
        });
        addTearDown(container.dispose);

        container.read(agentTypeProvider);
        await pumpEventQueue();

        expect(container.read(agentTypeProvider), AgentType.opencode);
      },
    );

    test('boots onto pi-durable when the flag is on', () async {
      final container = containerWith({
        'broski_selected_agent_type': 'pi-durable',
        'broski_pi_durable_enabled': 'true',
      });
      addTearDown(container.dispose);

      container.read(agentTypeProvider);
      await pumpEventQueue();

      expect(container.read(agentTypeProvider), AgentType.piDurable);
    });

    test(
      'boots onto a non-experimental backend regardless of the flag',
      () async {
        final container = containerWith({
          'broski_selected_agent_type': 'pi',
          'broski_pi_durable_enabled': 'false',
        });
        addTearDown(container.dispose);

        container.read(agentTypeProvider);
        await pumpEventQueue();

        expect(container.read(agentTypeProvider), AgentType.pi);
      },
    );
  });
}
