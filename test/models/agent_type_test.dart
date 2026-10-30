import 'package:broski/models/agent_type.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AgentType wire round-trip', () {
    test('every backend survives fromWireValue(wireValue)', () {
      for (final type in AgentType.values) {
        expect(AgentType.fromWireValue(type.wireValue), type);
      }
    });

    test('an unknown wire value still falls back to OpenCode', () {
      expect(AgentType.fromWireValue('not-a-backend'), AgentType.opencode);
      expect(AgentType.fromWireValue(''), AgentType.opencode);
    });
  });

  group('AgentsStatus', () {
    test('reads each backend by its wire key', () {
      final status = AgentsStatus.fromJson(const {
        'claude-code': {'available': true, 'version': '2.1.0'},
        'codex': {'available': false},
      });
      expect(status.forType(AgentType.claudeCode).available, isTrue);
      expect(status.forType(AgentType.claudeCode).version, '2.1.0');
      expect(status.forType(AgentType.codex).available, isFalse);
      expect(status.forType(AgentType.opencode).available, isFalse);
    });
  });
}
