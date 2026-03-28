import 'package:broski/services/bridge_service.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';

/// Handles MCP OAuth authentication flows.
///
/// Extracted from `opencode_mcp_config_screen.dart`.
/// Returns `true` if authentication succeeded, so the caller can refresh
/// status.

/// Shows auth-method picker (one-shot vs manual) then performs the chosen
/// OAuth flow. Returns `true` when the server was authenticated successfully.
Future<bool> startMcpAuth({
  required BuildContext context,
  required BridgeService bridge,
  required String name,
  String? projectPath,
}) async {
  final method = await showModalBottomSheet<String>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.computer),
            title: const Text('Authenticate on computer'),
            subtitle: const Text('Opens browser on your dev machine'),
            onTap: () => Navigator.pop(ctx, 'auto'),
          ),
          ListTile(
            leading: const Icon(Icons.phone_android),
            title: const Text('Authenticate on this device'),
            subtitle: const Text('Get URL here, paste code manually'),
            onTap: () => Navigator.pop(ctx, 'manual'),
          ),
        ],
      ),
    ),
  );
  if (method == null) return false;
  if (!context.mounted) return false;

  if (method == 'auto') {
    return _mcpAuthOneShotFlow(
      context: context,
      bridge: bridge,
      name: name,
      projectPath: projectPath,
    );
  } else {
    return _mcpAuthManualFlow(
      context: context,
      bridge: bridge,
      name: name,
      projectPath: projectPath,
    );
  }
}

/// One-shot: opens browser on dev machine, waits for OAuth callback
/// automatically.
Future<bool> _mcpAuthOneShotFlow({
  required BuildContext context,
  required BridgeService bridge,
  required String name,
  String? projectPath,
}) async {
  try {
    showInfo(context, 'Opening browser on your computer for "$name"…');
    final result = await bridge.mcpAuthAuthenticate(
      name,
      projectPath: projectPath,
    );
    if (!context.mounted) return false;
    final ok = result != null;
    if (ok) {
      showSuccess(context, 'Authenticated "$name"');
    } else {
      showError(context, 'Auth failed for "$name"');
    }
    return ok;
  } catch (e) {
    if (!context.mounted) return false;
    showError(context, 'Auth failed: ${humanizeError(e)}');
    return false;
  }
}

/// Two-step: get OAuth URL on phone, user pastes authorization code back.
Future<bool> _mcpAuthManualFlow({
  required BuildContext context,
  required BridgeService bridge,
  required String name,
  String? projectPath,
}) async {
  final oc = OpenCodeTheme.of(context);
  try {
    final result = await bridge.mcpAuthStart(name, projectPath: projectPath);
    if (!context.mounted) return false;
    if (result == null || result['authorizationUrl'] == null) {
      showError(context, 'Failed to start auth for "$name"');
      return false;
    }
    final url = result['authorizationUrl'] as String;
    // Show dialog with URL and code input
    final code = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final codeCtrl = TextEditingController();
        return AlertDialog(
          title: Text('Authenticate "$name"'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Open this URL in your browser:'),
              const SizedBox(height: 8),
              SelectableText(
                url,
                style: TextStyle(fontSize: 12, color: oc.primary),
              ),
              const SizedBox(height: 16),
              const Text('Then paste the authorization code:'),
              const SizedBox(height: 8),
              TextField(
                controller: codeCtrl,
                decoration: const InputDecoration(
                  hintText: 'Authorization code',
                  border: OutlineInputBorder(),
                ),
                autofocus: true,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, codeCtrl.text.trim()),
              child: const Text('Submit'),
            ),
          ],
        );
      },
    );
    if (code == null || code.isEmpty) return false;
    if (!context.mounted) return false;
    final ok = await bridge.mcpAuthCallback(
      name,
      code,
      projectPath: projectPath,
    );
    if (!context.mounted) return false;
    if (ok) {
      showSuccess(context, 'Authenticated "$name"');
    } else {
      showError(context, 'Auth failed for "$name"');
    }
    return ok;
  } catch (e) {
    if (!context.mounted) return false;
    showError(context, 'Auth failed: ${humanizeError(e)}');
    return false;
  }
}
