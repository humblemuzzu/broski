import 'package:broski/models/agent_type.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AgentType wire round-trip', () {
    test('every backend survives fromWireValue(wireValue)', () {
      for (final type in AgentType.values) {
        expect(AgentType.fromWireValue(type.wireValue), type);
      }
    });

    test('pi-durable uses the bridge wire value', () {
      expect(AgentType.piDurable.wireValue, 'pi-durable');
      expect(AgentType.piDurable.displayName, 'Pi Durable');
      expect(AgentType.fromWireValue('pi-durable'), AgentType.piDurable);
    });

    test('an unknown wire value still falls back to OpenCode', () {
      expect(AgentType.fromWireValue('not-a-backend'), AgentType.opencode);
      expect(AgentType.fromWireValue(''), AgentType.opencode);
    });
  });

  group('AgentsStatus', () {
    test('reads the pi-durable availability key', () {
      final status = AgentsStatus.fromJson(const {
        'pi-durable': {'available': true, 'version': '0.4.1'},
      });
      expect(status.piDurable.available, isTrue);
      expect(status.piDurable.version, '0.4.1');
      expect(status.forType(AgentType.piDurable).available, isTrue);
    });

    test('defaults pi-durable to unavailable when the key is absent', () {
      final status = AgentsStatus.fromJson(const {
        'pi': {'available': true},
      });
      expect(status.piDurable.available, isFalse);
      expect(status.pi.available, isTrue);
    });
  });
}
