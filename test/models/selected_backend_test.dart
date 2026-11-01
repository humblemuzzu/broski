import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/screens/ai_backend/selected_backend_label.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('every stored name leads back to the selection it was stored from', () {
    for (final type in AgentType.values) {
      final selection = LegacySelection(type);
      expect(SelectedBackend.fromWire(selection.wire), selection);
    }
    final pi = SelectedBackend.fromWire('pi');
    expect(pi, const ContractSelection(BackendId.pi));
    expect(SelectedBackend.fromWire('nothing'), isNull);
  });

  test('a legacy name is the legacy agent, never the contract backend', () {
    expect(
      SelectedBackend.fromWire('claude-code'),
      const LegacySelection(AgentType.claudeCode),
    );
  });

  test('the contract Claude Code is stored apart from the old one', () {
    const contract = ContractSelection(BackendId.claudeCode);
    expect(contract.wire, 'contract:claude-code');
    expect(SelectedBackend.fromWire(contract.wire), contract);
    expect(
      const LegacySelection(AgentType.claudeCode).wire,
      'claude-code',
      reason: 'a stored old selection keeps its name',
    );
    expect(
      contract,
      isNot(const LegacySelection(AgentType.claudeCode)),
      reason: 'the two never compare equal, so the picker marks one',
    );
  });

  test('a backend no old agent shares keeps its bare name', () {
    expect(const ContractSelection(BackendId.pi).wire, 'pi');
    expect(
      SelectedBackend.fromWire('contract:pi'),
      const ContractSelection(BackendId.pi),
    );
    expect(SelectedBackend.fromWire('contract:nothing'), isNull);
    expect(SelectedBackend.fromWire('contract:'), isNull);
  });

  test('a contract selection has no old-protocol agent', () {
    expect(const ContractSelection(BackendId.pi).legacy, isNull);
    expect(
      const LegacySelection(AgentType.claudeCode).legacy,
      AgentType.claudeCode,
    );
  });

  test('a selection shows as the person reads it', () {
    expect(const ContractSelection(BackendId.pi).displayName, 'Pi');
    expect(const ContractSelection(BackendId.pi).badge, 'PI');
    expect(const LegacySelection(AgentType.claudeCode).badge, 'CC');
    expect(
      const LegacySelection(AgentType.claudeCode).displayName,
      'Claude Code',
    );
    expect(
      const ContractSelection(BackendId.claudeCode).displayName,
      'Claude Code (new)',
    );
  });
}
