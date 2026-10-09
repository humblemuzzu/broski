import 'package:broski/models/agent_type.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('experimental flag hides Pi Durable', () {
    test('the flag off keeps pi-durable out of every picker', () {
      final visible = visibleAgentTypes(piDurableEnabled: false);
      expect(visible, isNot(contains(AgentType.piDurable)));
      expect(visible, hasLength(AgentType.values.length - 1));
    });

    test('the flag on adds pi-durable after the four existing backends', () {
      final visible = visibleAgentTypes(piDurableEnabled: true);
      expect(visible, contains(AgentType.piDurable));
      expect(visible.take(4), [
        AgentType.opencode,
        AgentType.claudeCode,
        AgentType.codex,
        AgentType.pi,
      ]);
    });

    test('only pi-durable is gated', () {
      expect(isExperimentalAgent(AgentType.piDurable), isTrue);
      for (final type in [
        AgentType.opencode,
        AgentType.claudeCode,
        AgentType.codex,
        AgentType.pi,
      ]) {
        expect(isExperimentalAgent(type), isFalse);
      }
    });

    test('turning the flag off retreats off a hidden backend', () {
      expect(
        resolveVisibleAgent(AgentType.piDurable, piDurableEnabled: false),
        AgentType.opencode,
      );
      expect(
        resolveVisibleAgent(AgentType.piDurable, piDurableEnabled: true),
        AgentType.piDurable,
      );
      expect(
        resolveVisibleAgent(AgentType.pi, piDurableEnabled: false),
        AgentType.pi,
      );
    });
  });
}
