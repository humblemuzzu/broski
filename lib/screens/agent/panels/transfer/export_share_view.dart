import 'dart:async';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/transfer/export_download.dart';
import 'package:broski/screens/agent/panels/transfer/file_transfers.dart';
import 'package:broski/screens/agent/panels/transfer/transfer_progress.dart';
import 'package:broski/screens/agent/shared/tinted_button.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// An export the Mac has written aside: fetched part by part, then handed to
/// the share sheet. It says how far it is, and when it cannot finish, why,
/// with a way to try again. The file is kept for another share while the view
/// is up, and removed with it.
class ExportShareView extends ConsumerStatefulWidget {
  const ExportShareView({
    super.key,
    required this.session,
    required this.exported,
  });

  final SessionRef session;
  final SessionExported exported;

  @override
  ConsumerState<ExportShareView> createState() => _ExportShareViewState();
}

enum _Phase { fetching, shared, failed }

class _ExportShareViewState extends ConsumerState<ExportShareView> {
  var _phase = _Phase.fetching;
  var _received = 0;
  String? _problem;
  DownloadedFile? _file;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() {
      _phase = _Phase.fetching;
      _received = 0;
      _problem = null;
    });
    final exported = widget.exported;
    final file = await ref
        .read(fileTransfersProvider)
        .startDownload(exported.name);
    _file = file;
    final problem = await downloadExport(
      client: ref.read(contractClientProvider),
      file: file,
      session: widget.session,
      exported: exported,
      onProgress: (received) {
        if (mounted) setState(() => _received = received);
      },
      stopped: () => !mounted,
    );
    if (!mounted) {
      await file.discard();
      return;
    }
    if (problem != null) {
      await file.discard();
      _file = null;
      setState(() {
        _phase = _Phase.failed;
        _problem = problem;
      });
      return;
    }
    await _share();
  }

  /// A download still under way discards its own file when it sees the view
  /// gone (`_fetch`); a finished one is discarded here.
  @override
  void dispose() {
    final file = _file;
    if (file != null && _phase != _Phase.fetching) unawaited(file.discard());
    super.dispose();
  }

  Future<void> _share() async {
    final file = _file;
    if (file == null) return;
    final box = context.findRenderObject();
    final origin = box is RenderBox && box.hasSize
        ? box.localToGlobal(Offset.zero) & box.size
        : null;
    try {
      await file.share(mimeType: widget.exported.mimeType, origin: origin);
      if (mounted) setState(() => _phase = _Phase.shared);
    } on Object catch (error) {
      if (mounted) {
        setState(() {
          _phase = _Phase.failed;
          _problem = 'The share sheet could not open: $error';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      key: const ValueKey('export-share'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _ExportHead(exported: widget.exported, theme: theme),
        const SizedBox(height: Spacing.md),
        switch (_phase) {
          _Phase.fetching => _Fetching(
            received: _received,
            exported: widget.exported,
          ),
          _Phase.shared => _Shared(onShareAgain: _share),
          _Phase.failed => _Failed(
            problem: _problem,
            label: _file == null ? 'Try again' : 'Share again',
            onTap: _file == null ? _fetch : _share,
          ),
        },
      ],
    );
  }
}

/// The file the Mac wrote: its name and its size.
class _ExportHead extends StatelessWidget {
  const _ExportHead({required this.exported, required this.theme});

  final SessionExported exported;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Container(
    padding: Insets.cardMd,
    decoration: BoxDecoration(
      color: theme.backgroundPanel,
      borderRadius: Radii.brMd,
      border: Border.all(color: theme.borderSubtle),
    ),
    child: Row(
      children: [
        Container(
          padding: Insets.cardXs,
          decoration: BoxDecoration(
            color: theme.primary.withValues(alpha: 0.1),
            borderRadius: Radii.brSm,
          ),
          child: Icon(AppIcons.description, size: 18, color: theme.primary),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                exported.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.labelLarge(color: theme.text),
              ),
              Text(
                _kilobytes(exported.bytes),
                style: AppTypography.caption(color: theme.textMuted),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _Fetching extends StatelessWidget {
  const _Fetching({required this.received, required this.exported});

  final int received;
  final SessionExported exported;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TransferProgressBar(
          key: const ValueKey('export-progress'),
          value: exported.bytes == 0 ? null : received / exported.bytes,
        ),
        const SizedBox(height: Spacing.xs),
        Text(
          '${_kilobytes(received)} of ${_kilobytes(exported.bytes)}',
          style: AppTypography.caption(color: theme.textMuted),
        ),
      ],
    );
  }
}

class _Shared extends StatelessWidget {
  const _Shared({required this.onShareAgain});

  final VoidCallback onShareAgain;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(AppIcons.checkCircle, size: 16, color: theme.success),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'Ready. Choose where to send it.',
                style: AppTypography.bodySmall(color: theme.text),
              ),
            ),
          ],
        ),
        const SizedBox(height: Spacing.sm),
        TintedButton(
          key: const ValueKey('export-share-again'),
          icon: AppIcons.share,
          label: 'Share again',
          color: theme.primary,
          onTap: onShareAgain,
        ),
      ],
    );
  }
}

class _Failed extends StatelessWidget {
  const _Failed({
    required this.problem,
    required this.label,
    required this.onTap,
  });

  final String? problem;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(AppIcons.error, size: 16, color: theme.error),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                problem ?? '',
                key: const ValueKey('export-problem'),
                style: AppTypography.bodySmall(color: theme.error),
              ),
            ),
          ],
        ),
        const SizedBox(height: Spacing.sm),
        TintedButton(
          key: const ValueKey('export-retry'),
          icon: AppIcons.refresh,
          label: label,
          color: theme.primary,
          onTap: onTap,
        ),
      ],
    );
  }
}

String _kilobytes(int bytes) => bytes < 1024
    ? '$bytes bytes'
    : bytes < 1024 * 1024
    ? '${(bytes / 1024).toStringAsFixed(0)} KB'
    : '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
