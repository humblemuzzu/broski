import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the Codex feedback sheet. Extracted from chat_screen.dart.
void showCodexFeedbackSheet(BuildContext context, WidgetRef ref) {
  final theme = OpenCodeTheme.of(context);
  final reasonController = TextEditingController();
  String classification = 'bug';
  bool includeLogs = false;
  DetailSheet.show(
    context: context,
    title: 'Feedback',
    initialSize: 0.6,
    child: StatefulBuilder(
      builder: (context, setSheetState) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: Spacing.sm),
              Padding(
                padding: Insets.screenH,
                child: DropdownButtonFormField<String>(
                  initialValue: classification,
                  items: const [
                    DropdownMenuItem(value: 'bug', child: Text('Bug')),
                    DropdownMenuItem(
                      value: 'feature',
                      child: Text('Feature request'),
                    ),
                    DropdownMenuItem(
                      value: 'bad_output',
                      child: Text('Bad output'),
                    ),
                    DropdownMenuItem(value: 'other', child: Text('Other')),
                  ],
                  onChanged: (v) =>
                      setSheetState(() => classification = v ?? 'bug'),
                  decoration: const InputDecoration(
                    labelText: 'Classification',
                  ),
                ),
              ),
              const SizedBox(height: Spacing.sm),
              Padding(
                padding: Insets.screenH,
                child: TextField(
                  controller: reasonController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Reason (optional)',
                  ),
                ),
              ),
              const SizedBox(height: Spacing.sm),
              Padding(
                padding: Insets.screenH,
                child: SwitchListTile(
                  value: includeLogs,
                  onChanged: (v) => setSheetState(() => includeLogs = v),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    'Include logs',
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    'Attach Codex logs from the host machine',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                  activeThumbColor: theme.primary,
                ),
              ),
              const SizedBox(height: Spacing.md),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () async {
                          final bridge = ref.read(bridgeServiceProvider);
                          final chatState = ref.read(chatSessionProvider);
                          final res = await bridge.cxFeedbackUpload(
                            classification: classification,
                            reason: reasonController.text.trim().isEmpty
                                ? null
                                : reasonController.text.trim(),
                            threadId: chatState.cxThreadId,
                            includeLogs: includeLogs,
                          );
                          final threadId = res['threadId']?.toString() ?? '';
                          if (!context.mounted) return;
                          Navigator.pop(context);
                          if (threadId.isEmpty) return;
                          final thread = await bridge.cxResumeThread(threadId);
                          if (!context.mounted) return;
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  ChatScreen.codex(cxThread: thread),
                            ),
                          );
                        },
                        child: const Text('Submit'),
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
  ).whenComplete(reasonController.dispose);
}
