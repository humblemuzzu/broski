import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the OpenCode LSP status sheet.
///
/// Fetches and displays the status of all Language Servers
/// connected to the current project.
void showOcLspStatusSheet(BuildContext context, {String? projectPath}) {
  DetailSheet.show(
    context: context,
    title: 'Language Servers',
    initialSize: 0.5,
    child: _OcLspStatusContent(projectPath: projectPath),
  );
}

class _OcLspStatusContent extends ConsumerStatefulWidget {
  final String? projectPath;
  const _OcLspStatusContent({this.projectPath});

  @override
  ConsumerState<_OcLspStatusContent> createState() =>
      _OcLspStatusContentState();
}

class _OcLspStatusContentState extends ConsumerState<_OcLspStatusContent> {
  List<dynamic>? _servers;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final data = await bridge.getLspStatus(projectPath: widget.projectPath);
      if (!mounted) return;
      setState(() {
        _servers = data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);

    if (_loading) {
      return const Padding(
        padding: Insets.card,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Padding(
        padding: Insets.card,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Error: $_error', style: TextStyle(color: oc.error)),
            const SizedBox(height: Spacing.md),
            TextButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    final servers = _servers ?? [];

    if (servers.isEmpty) {
      return Padding(
        padding: Insets.card,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.dns_outlined, size: 48, color: oc.textMuted),
            const SizedBox(height: Spacing.md),
            Text(
              'No language servers active',
              style: TextStyle(color: oc.textMuted, fontSize: 14),
            ),
            const SizedBox(height: Spacing.lg),
            _buildRefreshButton(oc),
          ],
        ),
      );
    }

    return Padding(
      padding: Insets.card,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ...servers.map((s) => _buildServerCard(s, oc)),
          const SizedBox(height: Spacing.lg),
          _buildRefreshButton(oc),
        ],
      ),
    );
  }

  Widget _buildServerCard(dynamic server, OpenCodeTheme oc) {
    final map = server is Map<String, dynamic> ? server : <String, dynamic>{};
    final name = map['name'] as String? ?? 'Unknown Server';
    final status = map['status'] as String? ?? 'unknown';
    final rootPath = map['rootPath'] as String? ?? map['root'] as String? ?? '';
    final isConnected =
        status.toLowerCase() == 'connected' ||
        status.toLowerCase() == 'running';

    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.sm),
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: oc.backgroundElement,
        borderRadius: Radii.brSm,
        border: Border.all(
          color: oc.borderSubtle.withValues(alpha: 0.5),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          // Status indicator dot
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isConnected ? oc.success : oc.error,
            ),
          ),
          const SizedBox(width: Spacing.md),
          // Server info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(
                    color: oc.text,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (rootPath.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: Spacing.xxs),
                    child: Text(
                      rootPath,
                      style: TextStyle(color: oc.textMuted, fontSize: 12),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(top: Spacing.xxs),
                  child: Text(
                    status,
                    style: TextStyle(
                      color: isConnected ? oc.success : oc.error,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRefreshButton(OpenCodeTheme oc) {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: _load,
        icon: const Icon(Icons.refresh, size: 18),
        label: const Text('Refresh'),
        style: OutlinedButton.styleFrom(
          foregroundColor: oc.textMuted,
          side: BorderSide(color: oc.borderSubtle),
          padding: Insets.buttonSm,
        ),
      ),
    );
  }
}
