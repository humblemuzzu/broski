import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Global Codex error state — latest error from any handler.
final cxLatestErrorProvider = StateProvider<CxError?>((ref) => null);

class CxError {
  const CxError({required this.message, this.code, this.handler});
  final String message;
  final String? code;
  final String? handler;

  @override
  String toString() => handler != null ? '[$handler] $message' : message;
}

/// Listens for Codex errors and shows a snackbar toast.
/// Call in a ConsumerWidget's build or ConsumerStatefulWidget's initState.
void setupCxErrorListener(WidgetRef ref, BuildContext context) {
  ref.listen<CxError?>(cxLatestErrorProvider, (prev, next) {
    if (next == null || !context.mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(next.toString()),
        backgroundColor: Theme.of(context).colorScheme.error,
        duration: const Duration(seconds: 4),
        action: SnackBarAction(
          label: 'Dismiss',
          textColor: Colors.white,
          onPressed: () {},
        ),
      ),
    );
  });
}
