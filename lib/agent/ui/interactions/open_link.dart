import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Shows a link a backend asks the person to open, whole, and opens it in
/// the phone's browser only when tapped.
class OpenLinkButton extends StatelessWidget {
  const OpenLinkButton({super.key, required this.url});

  final String url;

  Future<void> _open(BuildContext context) async {
    final uri = Uri.tryParse(url);
    final opened =
        uri != null &&
        await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) {
      showProblem(context, 'This link could not be opened: $url');
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SelectableText(url, style: AppTypography.codeSmall()),
      TextButton.icon(
        key: const ValueKey('open-link'),
        icon: const Icon(AppIcons.openExternal, size: 16),
        label: const Text('Open'),
        onPressed: () => _open(context),
      ),
    ],
  );
}
