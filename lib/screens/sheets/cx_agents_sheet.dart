import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/service_providers.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Codex AGENTS.md editor sheet. Extracted from chat_screen.dart.
///
/// [cwd] is required — the working directory for the Codex thread.
void showCodexAgentsSheet(BuildContext context, WidgetRef ref, String cwd) {
  final theme = OpenCodeTheme.of(context);
  final controller = TextEditingController();
  bool loaded = false;
  bool exists = false;
  String? path;
  DetailSheet.show(
    context: context,
    title: 'Agents',
    initialSize: 0.6,
    child: StatefulBuilder(
      builder: (context, setSheetState) {
        Future<void> load() async {
          if (loaded) return;
          loaded = true;
          final bridge = ref.read(bridgeServiceProvider);
          final res = await bridge.cxReadAgentsMd(cwd);
          exists = res['exists'] == true;
          path = res['path']?.toString();
          controller.text = (res['content'] ?? '').toString();
          setSheetState(() {});
        }

        void insertTemplate() {
          controller.text =
              '''
# AGENTS.md
<INSTRUCTIONS>
Describe project-specific guidance for Codex here.
- Goal:
- Constraints:
- Style:
- Commands to run:
</INSTRUCTIONS>
'''
                  .trim();
          setSheetState(() {});
        }

        unawaited(load());
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Text(
                  path ?? cwd,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.caption(color: theme.textMuted),
                ),
              ),
              if (!exists)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Row(
                    children: [
                      Icon(AppIcons.info, size: 16, color: theme.textMuted),
                      SizedBox(width: Spacing.sm),
                      Expanded(
                        child: Text(
                          'No AGENTS.md found. Create one to guide Codex for this project.',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: insertTemplate,
                        child: const Text('Insert template'),
                      ),
                    ],
                  ),
                ),
              Padding(
                padding: Insets.screenH,
                child: SizedBox(
                  height: 300,
                  child: TextField(
                    controller: controller,
                    expands: true,
                    maxLines: null,
                    minLines: null,
                    style: AppTypography.codeSmall(color: theme.text),
                    decoration: InputDecoration(
                      hintText: 'Project instructions for Codex…',
                      filled: true,
                      fillColor: theme.background,
                      border: OutlineInputBorder(
                        borderRadius: Radii.brMd,
                        borderSide: BorderSide(
                          color: theme.borderSubtle.withValues(alpha: 0.35),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              SizedBox(height: Spacing.md),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () async {
                          final ok = await ref
                              .read(bridgeServiceProvider)
                              .cxWriteAgentsMd(
                                cwd: cwd,
                                content: controller.text,
                              );
                          if (!context.mounted) return;
                          final messenger = ScaffoldMessenger.of(context);
                          messenger.showSnackBar(
                            SnackBar(
                              content: Text(
                                ok ? 'Saved AGENTS.md' : 'Save failed',
                              ),
                              backgroundColor: ok
                                  ? theme.backgroundPanel
                                  : theme.error,
                            ),
                          );
                          Navigator.pop(context);
                        },
                        child: const Text('Save'),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    ),
  ).whenComplete(controller.dispose);
}
