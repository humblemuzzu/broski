import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/stt_provider.dart';
import '../theme/opencode_theme.dart';

/// Shows a voice recording bottom sheet and returns the transcribed text.
///
/// Returns null if cancelled or failed.
Future<String?> showVoiceRecordingSheet(BuildContext context) async {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    isDismissible: false, // Prevent accidental dismiss
    enableDrag: false,
    backgroundColor: Colors.transparent,
    builder: (ctx) => const _VoiceRecordingSheetContent(),
  );
}

/// Internal content widget for the voice recording sheet.
class _VoiceRecordingSheetContent extends ConsumerStatefulWidget {
  const _VoiceRecordingSheetContent();

  @override
  ConsumerState<_VoiceRecordingSheetContent> createState() =>
      _VoiceRecordingSheetContentState();
}

class _VoiceRecordingSheetContentState
    extends ConsumerState<_VoiceRecordingSheetContent> {
  Timer? _durationTimer;
  Duration _duration = Duration.zero;
  bool _isProcessing = false;
  String? _localError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _startRecording();
    });
  }

  @override
  void dispose() {
    _durationTimer?.cancel();
    super.dispose();
  }

  Future<void> _startRecording() async {
    print('[Voice] Starting recording...');

    final notifier = ref.read(sttProvider.notifier);
    final success = await notifier.startRecording();

    if (!mounted) return;

    if (success) {
      print('[Voice] Recording started successfully');
      HapticFeedback.mediumImpact();

      _durationTimer = Timer.periodic(const Duration(milliseconds: 100), (_) {
        if (!mounted) return;
        setState(() {
          _duration += const Duration(milliseconds: 100);
        });
        notifier.updateRecordingDuration(_duration);
      });
    } else {
      print('[Voice] Failed to start recording');
      final error = ref.read(sttProvider).error;
      setState(() {
        _localError = error ?? 'Failed to start recording';
      });

      // Show error then close
      await Future.delayed(const Duration(seconds: 2));
      if (mounted) {
        Navigator.of(context).pop(null);
      }
    }
  }

  Future<void> _stopAndTranscribe() async {
    if (_isProcessing) return;

    setState(() {
      _isProcessing = true;
      _localError = null;
    });

    _durationTimer?.cancel();
    HapticFeedback.lightImpact();

    print('[Voice] Stopping recording and transcribing...');

    final notifier = ref.read(sttProvider.notifier);
    final result = await notifier.stopAndTranscribe();

    if (!mounted) return;

    print(
      '[Voice] Transcription result: text="${result?.text}", error="${result?.error}"',
    );

    if (result != null && result.isSuccess && result.text.trim().isNotEmpty) {
      final transcribedText = result.text.trim();
      print('[Voice] Success! Returning text: "$transcribedText"');
      HapticFeedback.heavyImpact();

      // Return the transcribed text
      Navigator.of(context).pop(transcribedText);
    } else {
      // Show error
      final errorMsg = result?.error ?? 'Transcription failed';
      print('[Voice] Failed: $errorMsg');

      setState(() {
        _isProcessing = false;
        _localError = errorMsg;
      });

      HapticFeedback.heavyImpact();

      // Keep sheet open to show error, user can retry or cancel
    }
  }

  Future<void> _cancel() async {
    print('[Voice] Cancelling...');
    _durationTimer?.cancel();
    HapticFeedback.lightImpact();

    final notifier = ref.read(sttProvider.notifier);
    await notifier.cancelRecording();

    if (mounted) {
      Navigator.of(context).pop(null);
    }
  }

  Future<void> _retry() async {
    setState(() {
      _localError = null;
      _duration = Duration.zero;
      _isProcessing = false;
    });

    // Clear error in provider
    ref.read(sttProvider.notifier).clearError();

    await _startRecording();
  }

  String _formatDuration(Duration d) {
    final minutes = d.inMinutes;
    final seconds = d.inSeconds % 60;
    final ms = (d.inMilliseconds % 1000) ~/ 100;
    if (minutes > 0) {
      return '$minutes:${seconds.toString().padLeft(2, '0')}';
    }
    return '0:${seconds.toString().padLeft(2, '0')}.$ms';
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final sttState = ref.watch(sttProvider);
    final isRecording = sttState.recordingState == RecordingState.recording;
    final isTranscribing =
        sttState.recordingState == RecordingState.transcribing || _isProcessing;
    final hasError = _localError != null || sttState.error != null;
    final errorMessage = _localError ?? sttState.error;

    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Handle bar
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: ocTheme.textMuted.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 24),

              // Status indicator
              _buildStatusIndicator(
                ocTheme,
                isRecording,
                isTranscribing,
                hasError,
              ),

              const SizedBox(height: 16),

              // Duration display
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: ocTheme.background,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  _formatDuration(_duration),
                  style: TextStyle(
                    color: isRecording ? ocTheme.error : ocTheme.textMuted,
                    fontSize: 24,
                    fontWeight: FontWeight.w600,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Error message
              if (hasError && errorMessage != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: ocTheme.error.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.error_outline, color: ocTheme.error, size: 20),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          errorMessage,
                          style: TextStyle(color: ocTheme.error, fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // Action buttons
              _buildActionButtons(
                ocTheme,
                isRecording,
                isTranscribing,
                hasError,
              ),

              const SizedBox(height: 8),

              // Provider info
              Text(
                'Using ${sttState.settings.provider.displayName} • ${sttState.settings.model.displayName}',
                style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusIndicator(
    OpenCodeTheme ocTheme,
    bool isRecording,
    bool isTranscribing,
    bool hasError,
  ) {
    if (hasError) {
      return Column(
        children: [
          Icon(Icons.error_outline, size: 60, color: ocTheme.error),
          const SizedBox(height: 16),
          Text(
            'Error',
            style: TextStyle(
              color: ocTheme.error,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    if (isTranscribing) {
      return Column(
        children: [
          SizedBox(
            width: 60,
            height: 60,
            child: CircularProgressIndicator(
              strokeWidth: 4,
              color: ocTheme.primary,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Transcribing...',
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    if (isRecording) {
      return Column(
        children: [
          _RecordingIndicator(color: ocTheme.error),
          const SizedBox(height: 16),
          Text(
            'Recording...',
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      );
    }

    return Column(
      children: [
        SizedBox(
          width: 60,
          height: 60,
          child: CircularProgressIndicator(
            strokeWidth: 4,
            color: ocTheme.textMuted,
          ),
        ),
        const SizedBox(height: 16),
        Text(
          'Starting...',
          style: TextStyle(color: ocTheme.textMuted, fontSize: 18),
        ),
      ],
    );
  }

  Widget _buildActionButtons(
    OpenCodeTheme ocTheme,
    bool isRecording,
    bool isTranscribing,
    bool hasError,
  ) {
    if (hasError) {
      // Show Retry and Cancel buttons
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _cancel,
              icon: const Icon(Icons.close),
              label: const Text('Cancel'),
              style: OutlinedButton.styleFrom(
                foregroundColor: ocTheme.textMuted,
                side: BorderSide(color: ocTheme.borderSubtle),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            flex: 2,
            child: FilledButton.icon(
              onPressed: _retry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
              style: FilledButton.styleFrom(
                backgroundColor: ocTheme.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
        ],
      );
    }

    // Normal Cancel and Send buttons
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: isTranscribing ? null : _cancel,
            icon: const Icon(Icons.close),
            label: const Text('Cancel'),
            style: OutlinedButton.styleFrom(
              foregroundColor: ocTheme.textMuted,
              side: BorderSide(color: ocTheme.borderSubtle),
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          flex: 2,
          child: FilledButton.icon(
            onPressed: (isRecording && _duration.inMilliseconds > 300)
                ? _stopAndTranscribe
                : null,
            icon: isTranscribing
                ? SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: ocTheme.background,
                    ),
                  )
                : const Icon(Icons.send),
            label: Text(isTranscribing ? 'Processing...' : 'Send'),
            style: FilledButton.styleFrom(
              backgroundColor: ocTheme.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              disabledBackgroundColor: ocTheme.primary.withValues(alpha: 0.3),
            ),
          ),
        ),
      ],
    );
  }
}

/// Animated recording indicator with pulsing effect
class _RecordingIndicator extends StatefulWidget {
  const _RecordingIndicator({required this.color});

  final Color color;

  @override
  State<_RecordingIndicator> createState() => _RecordingIndicatorState();
}

class _RecordingIndicatorState extends State<_RecordingIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _opacityAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    )..repeat();

    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 1.5,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOut));

    _opacityAnimation = Tween<double>(
      begin: 0.6,
      end: 0.0,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 80,
      height: 80,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Pulsing ring
          AnimatedBuilder(
            animation: _controller,
            builder: (context, child) {
              return Transform.scale(
                scale: _scaleAnimation.value,
                child: Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: widget.color.withValues(
                        alpha: _opacityAnimation.value,
                      ),
                      width: 3,
                    ),
                  ),
                ),
              );
            },
          ),
          // Main mic icon
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              color: widget.color.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.mic, color: widget.color, size: 32),
          ),
        ],
      ),
    );
  }
}
