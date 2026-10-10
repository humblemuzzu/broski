import 'dart:async';

import 'package:broski/models/link/pairing_failure.dart';
import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/services/link/pairing_input.dart';
import 'package:broski/services/link/pairing_service.dart';
import 'package:broski/services/link/scanned_link_offer.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Pairs a scanned Link offer, or reports why the QR is unusable.
///
/// Returns true when the payload belonged to the Link flow, so the legacy QR
/// parser is never handed a v2 offer. [onDismiss] runs when the pairing panel
/// closes, whether it paired or failed.
bool startLinkPairing(
  BuildContext context,
  String raw, {
  required VoidCallback onDismiss,
}) {
  final pending = scannedLinkOffer(
    raw,
    now: DateTime.now(),
    onError: (message) => showError(context, message),
  );
  if (pending == null) return false;
  unawaited(showLinkPairing(context, pending, onDismiss: onDismiss));
  return true;
}

/// Pairs [pending] behind a modal that reports progress and failures.
Future<void> showLinkPairing(
  BuildContext context,
  PendingPairing pending, {
  required VoidCallback onDismiss,
}) => showDialog<void>(
  context: context,
  barrierDismissible: false,
  barrierColor: Colors.black.withValues(alpha: 0.88),
  builder: (_) => LinkPairingDialog(pending: pending, onDismiss: onDismiss),
);

class LinkPairingDialog extends ConsumerStatefulWidget {
  const LinkPairingDialog({
    super.key,
    required this.pending,
    required this.onDismiss,
  });

  final PendingPairing pending;
  final VoidCallback onDismiss;

  @override
  ConsumerState<LinkPairingDialog> createState() => _LinkPairingDialogState();
}

class _LinkPairingDialogState extends ConsumerState<LinkPairingDialog> {
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_pair());
  }

  Future<void> _pair() async {
    try {
      await ref.read(pairingServiceProvider).pair(widget.pending);
      _finish();
    } on PairingFailure catch (failure) {
      _fail(failure.message);
    } on PairingInputException catch (failure) {
      _fail(failure.message);
    } catch (error) {
      _fail(humanizeError(error));
    }
  }

  void _finish() {
    if (!mounted) return;
    Navigator.of(context).pop();
    widget.onDismiss();
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() => _error = message);
  }

  @override
  Widget build(BuildContext context) {
    final error = _error;
    return PopScope(
      canPop: false,
      child: Material(
        type: MaterialType.transparency,
        child: Center(
          child: Padding(
            padding: Insets.screenAll,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: error == null ? _progress() : _failure(error),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _progress() => const [
    SizedBox(
      width: 28,
      height: 28,
      child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
    ),
    SizedBox(height: Spacing.xl),
    Text(
      'Pairing with the machine...',
      textAlign: TextAlign.center,
      style: TextStyle(color: Colors.white70, fontSize: 15),
    ),
  ];

  List<Widget> _failure(String error) => [
    const Icon(AppIcons.error, color: Colors.redAccent, size: 30),
    const SizedBox(height: Spacing.lg),
    Text(
      error,
      textAlign: TextAlign.center,
      style: const TextStyle(color: Colors.white, fontSize: 15),
    ),
    const SizedBox(height: Spacing.xl),
    TextButton(
      onPressed: _finish,
      child: const Text(
        'Close',
        style: TextStyle(color: Colors.white70, fontSize: 15),
      ),
    ),
  ];
}
