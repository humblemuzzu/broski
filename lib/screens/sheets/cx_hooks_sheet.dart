import 'package:flutter/material.dart';

import '../../models/codex/codex_hook.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the Codex hooks execution viewer.
void showCxHooksSheet(BuildContext context, List<CodexHookRun> hooks) {
  DetailSheet.show(
    context: context,
    title: 'Hooks',
    initialSize: 0.5,
    child: CxHooksSheet(hooks: hooks),
  );
}

class CxHooksSheet extends StatelessWidget {
  const CxHooksSheet({super.key, required this.hooks});

  final List<CodexHookRun> hooks;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    if (hooks.isEmpty) {
      return Padding(
        padding: Insets.card,
        child: Center(
          child: Text(
            'No hooks have run in this session.',
            style: AppTypography.bodySmall(color: theme.textMuted),
          ),
        ),
      );
    }

    // Group by eventName
    final sessionStartHooks = hooks
        .where((h) => h.eventName == 'sessionStart')
        .toList();
    final stopHooks = hooks.where((h) => h.eventName == 'stop').toList();
    final otherHooks = hooks
        .where((h) => h.eventName != 'sessionStart' && h.eventName != 'stop')
        .toList();

    return Padding(
      padding: Insets.screenH,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (sessionStartHooks.isNotEmpty) ...[
            _SectionHeader(title: 'SESSION START HOOKS', theme: theme),
            ...sessionStartHooks.map((h) => _HookRow(hook: h)),
            SizedBox(height: Spacing.md),
          ],
          if (stopHooks.isNotEmpty) ...[
            _SectionHeader(title: 'STOP HOOKS', theme: theme),
            ...stopHooks.map((h) => _HookRow(hook: h)),
            SizedBox(height: Spacing.md),
          ],
          if (otherHooks.isNotEmpty) ...[
            _SectionHeader(title: 'OTHER HOOKS', theme: theme),
            ...otherHooks.map((h) => _HookRow(hook: h)),
          ],
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.theme});
  final String title;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 6),
      child: Text(title, style: AppTypography.label(color: theme.textMuted)),
    );
  }
}

class _HookRow extends StatelessWidget {
  const _HookRow({required this.hook});
  final CodexHookRun hook;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text(hook.status.icon, style: const TextStyle(fontSize: 14)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  hook.handlerType.isNotEmpty ? hook.handlerType : 'hook',
                  style: AppTypography.labelLarge(color: theme.text),
                ),
              ),
              if (hook.durationDisplay.isNotEmpty)
                Text(
                  hook.durationDisplay,
                  style: AppTypography.label(color: theme.textMuted),
                ),
            ],
          ),
          if (hook.scope.isNotEmpty || hook.sourcePath.isNotEmpty) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                if (hook.scope.isNotEmpty) ...[
                  Text(
                    'Scope: ${hook.scope}',
                    style: AppTypography.label(color: theme.textMuted),
                  ),
                ],
                if (hook.scope.isNotEmpty && hook.sourcePath.isNotEmpty)
                  const SizedBox(width: 8),
                if (hook.sourcePath.isNotEmpty)
                  Expanded(
                    child: Text(
                      'Source: ${hook.sourcePath}',
                      style: AppTypography.label(color: theme.textMuted),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
          ],
          if (hook.statusMessage != null && hook.statusMessage!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              hook.statusMessage!,
              style: AppTypography.label(
                color: hook.status == CodexHookRunStatus.failed
                    ? theme.error
                    : theme.textMuted,
              ),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }
}
