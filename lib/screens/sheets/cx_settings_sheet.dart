import 'package:broski/models/codex.dart';
import 'package:broski/providers/codex/cx_output_schema_provider.dart';
import 'package:broski/providers/codex_settings_provider.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the Codex settings sheet. Extracted from chat_screen.dart.
void showCodexSettingsSheet(BuildContext context) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Codex Settings',
    initialSize: 0.7,
    child: Consumer(
      builder: (context, ref, _) {
        final settings = ref.watch(codexSettingsProvider);
        final notifier = ref.read(codexSettingsProvider.notifier);
        Widget chipGroup<T>({
          required String label,
          required List<T> values,
          required T selected,
          required String Function(T) display,
          required void Function(T) onSelected,
        }) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: Spacing.sm),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: values.map((v) {
                  final isSelected = v == selected;
                  return ChoiceChip(
                    label: Text(display(v)),
                    selected: isSelected,
                    onSelected: (_) => onSelected(v),
                    labelStyle: TextStyle(
                      color: isSelected ? theme.background : theme.text,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                    selectedColor: theme.primary,
                    backgroundColor: theme.background,
                    shape: RoundedRectangleBorder(
                      borderRadius: Radii.brMd,
                      side: BorderSide(
                        color: theme.borderSubtle.withValues(alpha: 0.3),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ],
          );
        }

        return Padding(
          padding: Insets.screenH,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              chipGroup<CodexApprovalPolicy>(
                label: 'Approvals',
                values: CodexApprovalPolicy.values,
                selected: settings.approvalPolicy,
                display: (v) => v.wireValue,
                onSelected: notifier.setApprovalPolicy,
              ),
              const SizedBox(height: Spacing.lg),
              chipGroup<CodexSandboxMode>(
                label: 'Sandbox',
                values: CodexSandboxMode.values,
                selected: settings.sandboxMode,
                display: (v) => v.threadWireValue,
                onSelected: notifier.setSandboxMode,
              ),
              const SizedBox(height: Spacing.md),
              if (settings.sandboxMode == CodexSandboxMode.workspaceWrite)
                SwitchListTile(
                  value: settings.networkAccessEnabled,
                  onChanged: notifier.setNetworkAccessEnabled,
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Network access',
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    'Allow network in Codex sandbox',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                  activeThumbColor: theme.primary,
                ),
              const SizedBox(height: Spacing.md),
              chipGroup<CodexReasoningEffort>(
                label: 'Reasoning effort',
                values: CodexReasoningEffort.values,
                selected: settings.reasoningEffort,
                display: (v) => v.wireValue,
                onSelected: notifier.setReasoningEffort,
              ),
              const SizedBox(height: Spacing.lg),
              chipGroup<CodexReasoningSummary>(
                label: 'Reasoning summary',
                values: CodexReasoningSummary.values,
                selected: settings.reasoningSummary,
                display: (v) => v.wireValue,
                onSelected: notifier.setReasoningSummary,
              ),
              const SizedBox(height: Spacing.md),
              chipGroup<CodexWebSearchMode>(
                label: 'Web search',
                values: CodexWebSearchMode.values,
                selected: settings.webSearchMode,
                display: (v) => v.name[0].toUpperCase() + v.name.substring(1),
                onSelected: notifier.setWebSearchMode,
              ),
              SwitchListTile(
                value: settings.skillsEnabled,
                onChanged: notifier.setSkillsEnabled,
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  'Skills discovery',
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                subtitle: Text(
                  'Allow Codex to discover skills from disk',
                  style: AppTypography.label(color: theme.textMuted),
                ),
                activeThumbColor: theme.primary,
              ),
              const SizedBox(height: Spacing.md),
              chipGroup<CodexPersonality>(
                label: 'Personality',
                values: CodexPersonality.values,
                selected: settings.personality,
                display: (v) => v.displayName,
                onSelected: notifier.setPersonality,
              ),
              const SizedBox(height: Spacing.lg),
              // Collaboration mode: plan vs default (ModeKind from SDK)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Collaboration mode',
                    style: TextStyle(
                      color: theme.textMuted,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: Spacing.sm),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: CodexCollaborationMode.values.map((mode) {
                      final isSelected = settings.collaborationMode == mode;
                      return ChoiceChip(
                        label: Text(mode.displayName),
                        selected: isSelected,
                        onSelected: (_) {
                          notifier.setCollaborationMode(mode);
                        },
                        labelStyle: TextStyle(
                          color: isSelected ? theme.background : theme.text,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                        selectedColor: theme.primary,
                        backgroundColor: theme.background,
                        shape: RoundedRectangleBorder(
                          borderRadius: Radii.brMd,
                          side: BorderSide(
                            color: theme.borderSubtle.withValues(alpha: 0.3),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],
              ),
              const SizedBox(height: Spacing.lg),
              chipGroup<CodexServiceTier>(
                label: 'Speed',
                values: CodexServiceTier.values,
                selected: settings.serviceTier,
                display: (v) => v.displayName,
                onSelected: notifier.setServiceTier,
              ),
              const SizedBox(height: Spacing.lg),
              // Output Schema (optional JSON)
              const _OutputSchemaField(),
            ],
          ),
        );
      },
    ),
  );
}

class _OutputSchemaField extends ConsumerStatefulWidget {
  const _OutputSchemaField();

  @override
  ConsumerState<_OutputSchemaField> createState() => _OutputSchemaFieldState();
}

class _OutputSchemaFieldState extends ConsumerState<_OutputSchemaField> {
  late final TextEditingController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: ref.read(cxOutputSchemaProvider) ?? '');
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Output Schema (optional)',
          style: AppTypography.labelSmall(color: theme.textMuted),
        ),
        const SizedBox(height: 4),
        TextField(
          controller: _ctrl,
          maxLines: 3,
          onChanged: (v) {
            ref.read(cxOutputSchemaProvider.notifier).state = v.trim().isEmpty
                ? null
                : v.trim();
          },
          style: AppTypography.codeSmall(color: theme.text),
          decoration: InputDecoration(
            hintText: '{"type": "object", "properties": {...}}',
            hintStyle: AppTypography.codeSmall(
              color: theme.textMuted.withValues(alpha: 0.5),
            ),
            filled: true,
            fillColor: theme.bgRaised,
            border: OutlineInputBorder(
              borderRadius: Radii.brSm,
              borderSide: BorderSide(color: theme.border),
            ),
            contentPadding: const EdgeInsets.all(10),
          ),
        ),
      ],
    );
  }
}
