import 'dart:async';

import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/screens/scan/link_pairing_dialog.dart';
import 'package:broski/services/link/pairing_input.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Pairs the machine a pairing link on the clipboard names, exactly as a
/// scanned QR would.
///
/// This is how a machine whose terminal nobody can point a camera at gets
/// paired from a phone.
class PastePairingLinkButton extends StatelessWidget {
  const PastePairingLinkButton({super.key, required this.onDismiss});

  final VoidCallback onDismiss;

  Future<void> _paste(BuildContext context) async {
    final text = (await Clipboard.getData(Clipboard.kTextPlain))?.text?.trim();
    if (!context.mounted) return;
    if (text == null || text.isEmpty) {
      showError(context, 'The clipboard is empty.');
      return;
    }

    final PendingPairing? pending;
    try {
      pending = parsePairingInput(text, DateTime.now());
    } on PairingInputException catch (failure) {
      showError(context, failure.message);
      return;
    }
    if (pending == null) {
      showError(context, 'That is not a pairing link.');
      return;
    }
    unawaited(showLinkPairing(context, pending, onDismiss: onDismiss));
  }

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: 'Paste pairing link',
      child: GestureDetector(
        onTap: () => unawaited(_paste(context)),
        child: Container(
          height: 50,
          width: 50,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.08),
            borderRadius: Radii.brLg,
            border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
          ),
          child: Icon(
            AppIcons.paste,
            color: Colors.white.withValues(alpha: 0.5),
            size: 22,
          ),
        ),
      ),
    );
  }
}
