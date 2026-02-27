import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../providers/chat_provider.dart';

String? maybeShowMcpOAuthFailureSnackbar({
  required BuildContext context,
  required McpOAuthPending? previous,
  required McpOAuthPending? next,
  required String? lastShownUrl,
}) {
  final nextUrl = next?.url.trim() ?? '';
  if (nextUrl.isEmpty) return lastShownUrl;

  final previousUrl = previous?.url.trim() ?? '';
  if (nextUrl == previousUrl || nextUrl == lastShownUrl) {
    return lastShownUrl;
  }

  final serverName = next?.serverName.trim().isNotEmpty == true
      ? next!.serverName.trim()
      : 'MCP server';

  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return lastShownUrl;

  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      content: Text(
        'Could not open browser for $serverName. Copy OAuth URL and open it manually.',
      ),
      duration: const Duration(seconds: 8),
      action: SnackBarAction(
        label: 'Copy URL',
        onPressed: () {
          Clipboard.setData(ClipboardData(text: nextUrl));
        },
      ),
    ),
  );

  return nextUrl;
}
