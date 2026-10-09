import 'dart:async';

import 'package:broski/models/card_style.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/pi_bash_card.dart';
import 'package:broski/providers/card_style_provider.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi/pi_live_bash_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Compact card for a Pi `!` shell command: the command, its live or final
/// output, exit status, and a stop button while it runs.
class PiBashCommandCard extends ConsumerWidget {
  const PiBashCommandCard({super.key, required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final cardStyle = ref.watch(cardStyleProvider);
    final sessionId = message.sessionId.isNotEmpty
        ? message.sessionId
        : (ref.watch(chatSessionProvider).piSessionId ?? '');
    final liveOutput = ref.watch(
      piLiveBashProvider.select((buffers) => buffers[sessionId] ?? ''),
    );
    final card = PiBashCardState.fromMetadata(
      message.metadata,
      liveOutput: liveOutput,
    );
    final accent = card.isSuccess
        ? theme.success
        : (card.error != null || (card.exitCode != null && card.exitCode != 0))
        ? theme.error
        : theme.toolBash;

    final Color headerBg;
    switch (cardStyle.headerStyle) {
      case CardHeaderStyle.solid:
        headerBg = theme.cardHeaderBg;
      case CardHeaderStyle.tinted:
        headerBg = accent.withValues(alpha: 0.1);
      case CardHeaderStyle.minimal:
        headerBg = theme.bgRaised;
    }
    final Color borderColor;
    switch (cardStyle.borderVisibility) {
      case CardBorderVisibility.subtle:
        borderColor = theme.cardBorderSubtle;
      case CardBorderVisibility.visible:
        borderColor = theme.cardHeaderBorder;
      case CardBorderVisibility.accent:
        borderColor = accent.withValues(alpha: 0.5);
    }

    return Container(
      margin: const EdgeInsets.symmetric(vertical: Spacing.xxs),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brMd,
        border: Border.all(
          color: card.isRunning ? accent.withValues(alpha: 0.4) : borderColor,
          width: card.isRunning ? 1.5 : 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(ref, theme, card, accent, headerBg),
          if (card.hasOutput || card.isRunning) _output(theme, card),
          if (!card.isRunning) _footer(theme, card, accent),
        ],
      ),
    );
  }

  Widget _header(
    WidgetRef ref,
    OpenCodeTheme theme,
    PiBashCardState card,
    Color accent,
    Color headerBg,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.md, vertical: 10),
      color: headerBg,
      child: Row(
        children: [
          Icon(AppIcons.terminal, size: 16, color: accent),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              '${card.excludeFromContext ? '!!' : '!'}${card.command}',
              style: AppTypography.code(color: theme.cardHeaderText),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (card.excludeFromContext) ...[
            const SizedBox(width: Spacing.sm),
            _badge(theme.textMuted, 'no context'),
          ],
          if (card.isRunning) ...[
            const SizedBox(width: Spacing.sm),
            _stopButton(ref, theme),
          ],
        ],
      ),
    );
  }

  Widget _output(OpenCodeTheme theme, PiBashCardState card) {
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(maxHeight: 260),
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        border: Border(
          top: BorderSide(color: theme.borderSubtle.withValues(alpha: 0.5)),
        ),
      ),
      child: SingleChildScrollView(
        child: SelectableText(
          card.hasOutput ? card.output : 'Running…',
          style: AppTypography.codeSmall(
            color: theme.text,
          ).copyWith(height: 1.4),
        ),
      ),
    );
  }

  Widget _footer(OpenCodeTheme theme, PiBashCardState card, Color accent) {
    final hasStatus =
        card.cancelled ||
        card.exitCode != null ||
        card.truncated ||
        card.error != null;
    if (!hasStatus) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.md,
        vertical: Spacing.sm,
      ),
      child: Row(
        children: [
          if (card.cancelled)
            _badge(theme.warning, 'cancelled')
          else if (card.exitCode != null)
            _badge(accent, 'exit ${card.exitCode}'),
          if (card.truncated) ...[
            const SizedBox(width: Spacing.sm),
            _badge(theme.warning, 'output truncated'),
          ],
          if (card.error != null) ...[
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                card.error!,
                style: AppTypography.caption(color: theme.error),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _stopButton(WidgetRef ref, OpenCodeTheme theme) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => unawaited(
        ref
            .read(piBridgeServiceProvider)
            .abortBash(projectPath: ref.read(chatSessionProvider).piCwd),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.sm,
          vertical: 4,
        ),
        decoration: BoxDecoration(
          color: theme.error.withValues(alpha: 0.12),
          borderRadius: Radii.brXs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.stop, size: 12, color: theme.error),
            const SizedBox(width: 4),
            Text('Stop', style: AppTypography.caption(color: theme.error)),
          ],
        ),
      ),
    );
  }

  Widget _badge(Color color, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.brXs,
      ),
      child: Text(label, style: AppTypography.caption(color: color)),
    );
  }
}
