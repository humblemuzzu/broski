import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/stt_provider.dart';
import '../screens/voice_settings_screen.dart';
import '../theme/opencode_theme.dart';
import 'voice_recording_sheet.dart';

/// A mic button that triggers voice input recording.
///
/// Shows different states:
/// - Gray mic: idle, ready to record
/// - Pulsing red mic: recording
/// - Spinner: transcribing
/// - Disabled: not configured
class VoiceInputButton extends ConsumerWidget {
  const VoiceInputButton({
    super.key,
    required this.onTranscription,
    this.size = 24,
    this.padding = const EdgeInsets.all(8),
  });

  /// Called when transcription completes successfully with the transcribed text.
  final void Function(String text) onTranscription;

  /// Icon size
  final double size;

  /// Button padding
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sttState = ref.watch(sttProvider);
    final ocTheme = OpenCodeTheme.of(context);

    // Determine icon and color based on state
    IconData icon;
    Color color;

    switch (sttState.recordingState) {
      case RecordingState.recording:
        icon = Icons.mic;
        color = ocTheme.error;
        break;
      case RecordingState.transcribing:
        icon = Icons.mic;
        color = ocTheme.primary;
        break;
      case RecordingState.error:
        icon = Icons.mic_off;
        color = ocTheme.error;
        break;
      case RecordingState.idle:
        if (!sttState.isConfigured) {
          icon = Icons.mic_off;
          color = ocTheme.textMuted;
        } else {
          icon = Icons.mic;
          color = ocTheme.textMuted;
        }
        break;
    }

    return GestureDetector(
      onTap: () => _handleTap(context, ref, sttState),
      child: Padding(
        padding: padding,
        child: _buildIcon(sttState, icon, color, ocTheme),
      ),
    );
  }

  Widget _buildIcon(
    SttState state,
    IconData icon,
    Color color,
    OpenCodeTheme ocTheme,
  ) {
    if (state.recordingState == RecordingState.transcribing) {
      return SizedBox(
        width: size,
        height: size,
        child: CircularProgressIndicator(strokeWidth: 2, color: color),
      );
    }

    if (state.recordingState == RecordingState.recording) {
      return _PulsingMic(size: size, color: color);
    }

    return Icon(icon, size: size, color: color);
  }

  void _handleTap(BuildContext context, WidgetRef ref, SttState state) async {
    if (!state.isConfigured) {
      _showConfigurePrompt(context);
      return;
    }

    if (state.recordingState == RecordingState.recording ||
        state.recordingState == RecordingState.transcribing) {
      return;
    }

    final transcribedText = await showVoiceRecordingSheet(context);

    if (transcribedText != null && transcribedText.isNotEmpty) {
      onTranscription(transcribedText);
    }
  }

  void _showConfigurePrompt(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ocTheme.backgroundPanel,
        title: Text(
          'Voice Input Not Configured',
          style: TextStyle(color: ocTheme.text),
        ),
        content: Text(
          'Set up your API key to use voice input.',
          style: TextStyle(color: ocTheme.textMuted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel', style: TextStyle(color: ocTheme.textMuted)),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const VoiceSettingsScreen()),
              );
            },
            child: Text('Configure', style: TextStyle(color: ocTheme.primary)),
          ),
        ],
      ),
    );
  }
}

/// Pulsing mic icon for recording state
class _PulsingMic extends StatefulWidget {
  const _PulsingMic({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  State<_PulsingMic> createState() => _PulsingMicState();
}

class _PulsingMicState extends State<_PulsingMic>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    )..repeat(reverse: true);
    _animation = Tween<double>(
      begin: 0.8,
      end: 1.0,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Transform.scale(
          scale: _animation.value,
          child: Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: widget.color.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.mic, size: widget.size - 8, color: widget.color),
          ),
        );
      },
    );
  }
}
