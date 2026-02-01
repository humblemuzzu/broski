import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../models/permission_rule.dart';
import '../providers/permission_rules_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/permission_rules_sheet.dart';

class PermissionRulesScreen extends ConsumerWidget {
  const PermissionRulesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final oc = OpenCodeTheme.of(context);
    final state = ref.watch(permissionRulesProvider);

    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: Text('Permission Rules', style: TextStyle(color: oc.text)),
      ),
      body: SafeArea(
        child: !state.loaded
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                children: [
                  Text(
                    'Default session permissions for OpenCode.',
                    style: TextStyle(color: oc.textMuted),
                  ),
                  const SizedBox(height: 16),
                  Card(
                    color: oc.backgroundPanel,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Preset',
                            style: TextStyle(
                              color: oc.textMuted,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 8),
                          DropdownButtonFormField<PermissionPreset>(
                            value: state.preset,
                            decoration: InputDecoration(
                              filled: true,
                              fillColor: oc.background,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            items: PermissionPreset.values
                                .map(
                                  (p) => DropdownMenuItem(
                                    value: p,
                                    child: Text(p.displayName),
                                  ),
                                )
                                .toList(),
                            onChanged: (p) async {
                              if (p == null) return;
                              if (p == PermissionPreset.custom) {
                                await ref
                                    .read(permissionRulesProvider.notifier)
                                    .setPreset(PermissionPreset.custom);
                                if (!context.mounted) return;
                                await _openEditor(
                                  context,
                                  ref,
                                  initial: state.customRules.isNotEmpty
                                      ? state.customRules
                                      : PermissionPreset.askEverything
                                            .toRuleset(),
                                );
                                return;
                              }
                              await ref
                                  .read(permissionRulesProvider.notifier)
                                  .setPreset(p);
                            },
                          ),
                          const SizedBox(height: 10),
                          Text(
                            state.preset.description,
                            style: TextStyle(color: oc.textMuted),
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              FilledButton.icon(
                                onPressed: () => _openEditor(
                                  context,
                                  ref,
                                  initial: state.effectiveRuleset,
                                ),
                                icon: const Icon(Icons.edit_rounded),
                                label: const Text('Edit rules'),
                              ),
                              const Spacer(),
                              Text(
                                '${state.effectiveRuleset.length} rules',
                                style: TextStyle(color: oc.textMuted),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Future<void> _openEditor(
    BuildContext context,
    WidgetRef ref, {
    required PermissionRuleset initial,
  }) async {
    await showPermissionRulesSheet(
      context: context,
      backend: AgentType.opencode,
      initialRules: initial,
      onApply: (rules) async {
        await ref.read(permissionRulesProvider.notifier).setCustomRules(rules);
      },
    );
  }
}
