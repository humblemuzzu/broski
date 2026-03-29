import 'dart:async';

import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Autocomplete dropdown for @file mentions in the chat input.
///
/// Shows when user types '@' followed by characters. Searches files
/// via the Codex fuzzy search API (or filesystem fallback).
class CxFileMentionPicker extends ConsumerStatefulWidget {
  const CxFileMentionPicker({
    super.key,
    required this.query,
    required this.onSelect,
    required this.onDismiss,
    this.threadId,
    this.cwd,
  });

  final String query;
  final void Function(String filePath) onSelect;
  final VoidCallback onDismiss;
  final String? threadId;
  final String? cwd;

  @override
  ConsumerState<CxFileMentionPicker> createState() =>
      _CxFileMentionPickerState();
}

class _CxFileMentionPickerState extends ConsumerState<CxFileMentionPicker> {
  List<_FileResult> _results = [];
  bool _loading = false;
  String? _searchSessionId;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _search(widget.query);
  }

  @override
  void didUpdateWidget(CxFileMentionPicker old) {
    super.didUpdateWidget(old);
    if (old.query != widget.query) {
      _debounce?.cancel();
      _debounce = Timer(const Duration(milliseconds: 200), () {
        _search(widget.query);
      });
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _endSession();
    super.dispose();
  }

  Future<void> _search(String query) async {
    if (query.isEmpty) {
      setState(() => _results = []);
      return;
    }

    setState(() => _loading = true);

    try {
      final bridge = ref.read(bridgeServiceProvider);
      Map<String, dynamic> result;

      if (_searchSessionId != null) {
        result = await bridge.cxFuzzySearchUpdate(
          sessionId: _searchSessionId!,
          query: query,
        );
      } else {
        result = await bridge.cxFuzzySearchStart(
          threadId: widget.threadId,
          query: query,
          cwd: widget.cwd,
        );
        _searchSessionId = result['sessionId'] as String?;
      }

      final rawResults = result['results'] as List<dynamic>? ?? [];
      if (mounted) {
        setState(() {
          _results = rawResults
              .whereType<Map<String, dynamic>>()
              .map(
                (r) => _FileResult(
                  path: r['path'] as String? ?? '',
                  name: r['name'] as String? ?? '',
                  score: (r['score'] as num?)?.toDouble() ?? 0,
                ),
              )
              .where((r) => r.path.isNotEmpty)
              .toList();
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _endSession() {
    if (_searchSessionId != null) {
      final bridge = ref.read(bridgeServiceProvider);
      bridge.cxFuzzySearchEnd(sessionId: _searchSessionId!).catchError((_) {});
      _searchSessionId = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    if (_results.isEmpty && !_loading) {
      return const SizedBox.shrink();
    }

    return Container(
      constraints: const BoxConstraints(maxHeight: 220),
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: theme.bgSheet,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: Radii.brMd,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildHeader(theme),
            Flexible(child: _buildResults(theme)),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(OpenCodeTheme theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: theme.border)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.search, size: 12, color: theme.textMuted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Files matching "${widget.query}"',
              style: AppTypography.labelSmall(color: theme.textMuted),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (_loading)
            SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(
                strokeWidth: 1.5,
                color: theme.textMuted,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildResults(OpenCodeTheme theme) {
    return ListView.builder(
      shrinkWrap: true,
      padding: EdgeInsets.zero,
      itemCount: _results.length,
      itemBuilder: (context, index) {
        final result = _results[index];
        final parts = result.path.split('/');
        final dir = parts.length > 1
            ? parts.sublist(0, parts.length - 1).join('/')
            : '';

        return InkWell(
          onTap: () {
            widget.onSelect(result.path);
            _endSession();
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Row(
              children: [
                Icon(AppIcons.file, size: 14, color: theme.info),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        result.name,
                        style: AppTypography.labelSmall(color: theme.text),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (dir.isNotEmpty)
                        Text(
                          dir,
                          style: AppTypography.codeSmall(
                            color: theme.textMuted,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _FileResult {
  const _FileResult({
    required this.path,
    required this.name,
    required this.score,
  });

  final String path;
  final String name;
  final double score;
}
