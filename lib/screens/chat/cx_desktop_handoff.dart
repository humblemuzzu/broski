import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens a Codex thread in the desktop Codex app via deep link.
///
/// Uses the `codex://threads/{threadId}` URL scheme.
Future<void> openCxThreadInDesktop({
  required BuildContext context,
  required String threadId,
}) async {
  if (threadId.isEmpty) return;

  final uri = Uri.parse('codex://threads/$threadId');
  final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);

  if (!launched && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Could not open Codex desktop app'),
        duration: Duration(seconds: 2),
      ),
    );
  }
}
