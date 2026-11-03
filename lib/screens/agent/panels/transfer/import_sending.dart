import 'package:broski/screens/agent/panels/transfer/file_transfers.dart';
import 'package:broski/screens/agent/panels/transfer/transfer_progress.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// How far an upload is, and whether the person asked to stop it.
final class ImportSending {
  final sent = ValueNotifier<int>(0);
  final stopped = ValueNotifier<bool>(false);

  void dispose() {
    sent.dispose();
    stopped.dispose();
  }
}

/// The file on its way to the Mac, over whatever screen the person is on: it
/// stays until the upload ends.
class ImportSendingDialog extends StatelessWidget {
  const ImportSendingDialog({
    super.key,
    required this.file,
    required this.sending,
  });

  final PickedFile file;
  final ImportSending sending;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return PopScope(
      canPop: false,
      child: Dialog(
        backgroundColor: Colors.transparent,
        elevation: 0,
        child: Container(
          padding: Insets.cardLg,
          decoration: BoxDecoration(
            color: theme.backgroundPanel,
            borderRadius: Radii.brLg,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: _Body(file: file, sending: sending, theme: theme),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.file, required this.sending, required this.theme});

  final PickedFile file;
  final ImportSending sending;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _Heading(theme: theme),
      const SizedBox(height: Spacing.md),
      Text(
        file.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppTypography.caption(color: theme.textMuted),
      ),
      const SizedBox(height: Spacing.sm),
      ValueListenableBuilder<int>(
        valueListenable: sending.sent,
        builder: (context, bytes, _) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TransferProgressBar(
              key: const ValueKey('import-progress'),
              value: file.size == 0 ? null : bytes / file.size,
            ),
            const SizedBox(height: Spacing.md),
            Align(
              alignment: Alignment.centerRight,
              child: _Stop(sending: sending),
            ),
          ],
        ),
      ),
    ],
  );
}

class _Heading extends StatelessWidget {
  const _Heading({required this.theme});

  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        padding: Insets.cardXs,
        decoration: BoxDecoration(
          color: theme.primary.withValues(alpha: 0.1),
          borderRadius: Radii.brSm,
        ),
        child: Icon(AppIcons.upload, size: 18, color: theme.primary),
      ),
      const SizedBox(width: 14),
      Expanded(
        child: Text(
          'Sending to your Mac',
          style: AppTypography.labelLarge(color: theme.text),
        ),
      ),
    ],
  );
}

class _Stop extends StatelessWidget {
  const _Stop({required this.sending});

  final ImportSending sending;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ValueListenableBuilder<bool>(
      valueListenable: sending.stopped,
      builder: (context, stopped, _) {
        final tone = stopped ? theme.textMuted : theme.error;
        return GestureDetector(
          key: const ValueKey('import-cancel'),
          onTap: stopped ? null : () => sending.stopped.value = true,
          behavior: HitTestBehavior.opaque,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.10),
              borderRadius: Radii.brSm,
            ),
            child: Text(
              stopped ? 'Stopping…' : 'Cancel',
              style: AppTypography.label(color: tone),
            ),
          ),
        );
      },
    );
  }
}
