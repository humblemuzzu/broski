import 'dart:convert';

import 'package:broski/models/mcp.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';

/// MCP server list with individual server cards showing
/// status, connect/disconnect, and authentication controls.
///
/// Extracted from `opencode_mcp_config_screen.dart`.

/// Returns the appropriate status icon for a given [McpServerStatus].
IconData mcpStatusIcon(McpServerStatus? status) {
  if (status == null) return AppIcons.cloud;
  if (status.isConnected) return AppIcons.checkCircle;
  if (status.isConnecting) return AppIcons.sync;
  if (status.hasError) return AppIcons.error;
  return AppIcons.pause;
}

/// Returns the appropriate status color for a given [McpServerStatus].
Color mcpStatusColor(OpenCodeTheme oc, McpServerStatus? status) {
  if (status == null) return oc.textMuted;
  if (status.isConnected) return oc.success;
  if (status.isConnecting) return oc.info;
  if (status.hasError) return oc.error;
  return oc.warning;
}

/// Displays the list of configured MCP servers (or an empty-state message).
///
/// Pure presentation widget — all mutations are handled via callbacks.
class OpenCodeMcpServerList extends StatelessWidget {
  const OpenCodeMcpServerList({
    super.key,
    required this.names,
    required this.status,
    required this.onToggleConnection,
    required this.onStartAuth,
  });

  /// Sorted server names from the MCP config.
  final List<String> names;

  /// Current status for each server (keyed by name).
  final Map<String, McpServerStatus> status;

  /// Called when the user taps Connect / Disconnect.
  /// Parameters: server name, `true` to connect / `false` to disconnect.
  final void Function(String name, bool connect) onToggleConnection;

  /// Called when the user needs to authenticate a server.
  final void Function(String name) onStartAuth;

  Widget _trailingButton(
    String name,
    McpServerStatus? serverStatus,
    bool isConnected,
    OpenCodeTheme oc,
  ) {
    // Show "Authenticate" for servers needing auth
    if (serverStatus?.status == McpConnectionStatus.needsAuth ||
        serverStatus?.status == McpConnectionStatus.needsClientRegistration) {
      return TextButton(
        onPressed: () => onStartAuth(name),
        child: Text('Authenticate', style: TextStyle(color: oc.warning)),
      );
    }
    return TextButton(
      onPressed: serverStatus?.isConnecting == true
          ? null
          : () => onToggleConnection(name, !isConnected),
      child: Text(isConnected ? 'Disconnect' : 'Connect'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);

    if (names.isEmpty) {
      return Center(
        child: Padding(
          padding: Insets.cardLg,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(AppIcons.dns, color: oc.textMuted, size: 56),
              const SizedBox(height: Spacing.md),
              Text(
                'No MCP servers configured',
                style: TextStyle(color: oc.text),
              ),
              const SizedBox(height: Spacing.sm),
              Text(
                'Tap + to add your first MCP server.',
                textAlign: TextAlign.center,
                style: TextStyle(color: oc.textMuted),
              ),
            ],
          ),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      itemCount: names.length,
      itemBuilder: (context, idx) {
        final name = names[idx];
        final serverStatus = status[name];
        final isConnected = serverStatus?.isConnected ?? false;
        return Card(
          color: oc.backgroundElement,
          margin: const EdgeInsets.only(bottom: 10),
          shape: RoundedRectangleBorder(
            borderRadius: Radii.brMd,
            side: BorderSide(color: oc.border),
          ),
          child: ListTile(
            leading: Icon(
              mcpStatusIcon(serverStatus),
              color: mcpStatusColor(oc, serverStatus),
            ),
            title: Text(
              name,
              style: TextStyle(color: oc.text, fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              serverStatus?.statusDisplay ?? 'Configured in OpenCode config',
              style: TextStyle(color: oc.textMuted),
            ),
            trailing: _trailingButton(name, serverStatus, isConnected, oc),
          ),
        );
      },
    );
  }
}

/// A simple JSON-object editor screen used when adding a new MCP server.
///
/// Pushes a new route; pops with the decoded `Map<String, dynamic>` or `null`
/// if the user cancels.
class JsonObjectEditorScreen extends StatefulWidget {
  const JsonObjectEditorScreen({
    super.key,
    required this.title,
    required this.initialJson,
  });

  final String title;
  final String initialJson;

  @override
  State<JsonObjectEditorScreen> createState() => _JsonObjectEditorScreenState();
}

class _JsonObjectEditorScreenState extends State<JsonObjectEditorScreen> {
  late final TextEditingController _json;

  @override
  void initState() {
    super.initState();
    _json = TextEditingController(text: widget.initialJson);
  }

  @override
  void dispose() {
    _json.dispose();
    super.dispose();
  }

  void _done() {
    try {
      final decoded = jsonDecode(_json.text);
      if (decoded is! Map) {
        throw const FormatException('Config must be a JSON object');
      }
      Navigator.pop(context, decoded.cast<String, dynamic>());
    } catch (e) {
      showInfo(context, 'Invalid JSON: ${humanizeError(e)}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text(widget.title, style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          TextButton(
            onPressed: _done,
            child: Text(
              'Done',
              style: TextStyle(color: oc.primary, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: Padding(
          padding: Insets.card,
          child: TextField(
            controller: _json,
            maxLines: null,
            expands: true,
            style: AppTypography.code(),
            decoration: InputDecoration(
              filled: true,
              fillColor: oc.backgroundElement,
              border: OutlineInputBorder(
                borderRadius: Radii.brMd,
                borderSide: BorderSide(color: oc.border),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
