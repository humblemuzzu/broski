import 'dart:async';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/ui/panels/transfer/export_download.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
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
    final exported = widget.exported;
    return Column(
      key: const ValueKey('export-share'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(exported.name),
        const SizedBox(height: Spacing.sm),
        switch (_phase) {
          _Phase.fetching => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LinearProgressIndicator(
                key: const ValueKey('export-progress'),
                value: exported.bytes == 0 ? null : _received / exported.bytes,
              ),
              Text('${_kilobytes(_received)} of ${_kilobytes(exported.bytes)}'),
            ],
          ),
          _Phase.shared => Row(
            children: [
              const Expanded(child: Text('Ready. Choose where to send it.')),
              TextButton(
                key: const ValueKey('export-share-again'),
                onPressed: _share,
                child: const Text('Share again'),
              ),
            ],
          ),
          _Phase.failed => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_problem ?? '', key: const ValueKey('export-problem')),
              TextButton(
                key: const ValueKey('export-retry'),
                onPressed: _file == null ? _fetch : _share,
                child: Text(_file == null ? 'Try again' : 'Share again'),
              ),
            ],
          ),
        },
      ],
    );
  }
}

String _kilobytes(int bytes) => bytes < 1024
    ? '$bytes bytes'
    : bytes < 1024 * 1024
    ? '${(bytes / 1024).toStringAsFixed(0)} KB'
    : '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
