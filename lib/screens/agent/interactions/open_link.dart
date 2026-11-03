import 'package:broski/screens/agent/interactions/answer_button.dart';
import 'package:broski/screens/agent/interactions/code_box.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
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
      CodeBox(text: url),
      Padding(
        padding: Insets.topSm,
        child: AnswerButton(
          key: const ValueKey('open-link'),
          label: 'Open',
          tone: AnswerTone.muted,
          icon: AppIcons.openExternal,
          onTap: () => _open(context),
        ),
      ),
    ],
  );
}
