
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/stt_provider.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';
/// Shows a modern voice recording overlay and returns the transcribed text.
///
/// Returns null if cancelled or failed.
Future<String?> showVoiceRecordingSheet(BuildContext context) async {
  final ocTheme = OpenCodeTheme.of(context);
  return showGeneralDialog<String>(
    context: context,
    barrierDismissible: false,
    barrierColor: ocTheme.bgDeep.withValues(alpha: 0.54),
    transitionDuration: const Duration(milliseconds: 300),
    pageBuilder: (context, animation, secondaryAnimation) {
      return const _VoiceRecordingOverlay();
    },
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      return SlideTransition(
        position: Tween<Offset>(begin: const Offset(0, 0.3), end: Offset.zero)
            .animate(
              CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
            ),
        child: FadeTransition(opacity: animation, child: child),
      );
    },
  );
}
/// Modern voice recording overlay with waveform visualization
class _VoiceRecordingOverlay extends ConsumerStatefulWidget {
  const _VoiceRecordingOverlay();
  @override
  ConsumerState<_VoiceRecordingOverlay> createState() =>
      _VoiceRecordingOverlayState();
}
class _VoiceRecordingOverlayState extends ConsumerState<_VoiceRecordingOverlay>
    with TickerProviderStateMixin {
  Timer? _durationTimer;
  Duration _duration = Duration.zero;
  bool _isProcessing = false;
  String? _localError;
  // Animation controllers
  late AnimationController _pulseController;
  late AnimationController _waveController;
  late Animation<double> _pulseAnimation;
  // Audio levels for waveform (simulated based on recording state)
  final List<double> _audioLevels = List.filled(24, 0.1);
  final math.Random _random = math.Random();
  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 1500),
      vsync: this,
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 0.95, end: 1.05).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
    // Waveform uses a simple periodic timer to update levels at ~30fps.
    // The AnimatedBuilder in _AnimatedWaveformLive drives the repaint without
    // calling setState on the parent overlay (huge rebuild savings).
    _waveController = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _startRecording();
    });
  }
  @override
  void dispose() {
    _durationTimer?.cancel();
    _waveTimer?.cancel();
    _pulseController.dispose();
    _waveController.dispose();
    super.dispose();
  }
  Timer? _waveTimer;
  void _startWaveformAnimation() {
    _waveController.repeat();
    // Update waveform levels at ~30fps via a timer. The actual repaint is
    // driven by the AnimationController; this timer only mutates the level
    // data without calling setState on the parent.
    _waveTimer?.cancel();
    _waveTimer = Timer.periodic(const Duration(milliseconds: 33), (_) {
      if (!mounted) return;
      final sttState = ref.read(sttProvider);
      final isRecording = sttState.recordingState == RecordingState.recording;
      for (int i = 0; i < _audioLevels.length; i++) {
        if (isRecording) {
          final target = 0.2 + _random.nextDouble() * 0.8;
          _audioLevels[i] = _audioLevels[i] * 0.7 + target * 0.3;
        } else {
          _audioLevels[i] = _audioLevels[i] * 0.9 + 0.1 * 0.1;
        }
      }
    });
  }
  void _stopWaveformAnimation() {
    _waveTimer?.cancel();
    _waveTimer = null;
    _waveController.stop();
  }
  Future<void> _startRecording() async {
    final notifier = ref.read(sttProvider.notifier);
    final success = await notifier.startRecording();
    if (!mounted) return;
    if (success) {
      HapticFeedback.mediumImpact();
      // Start waveform animation (does NOT call setState on parent)
      _startWaveformAnimation();
      // Duration timer at 250ms — humans can't read faster than ~4fps on a
      // counter and this avoids 10 setState/sec for a cosmetic display.
      _durationTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
        if (!mounted) return;
        setState(() {
          _duration += const Duration(milliseconds: 250);
        });
        notifier.updateRecordingDuration(_duration);
      });
    } else {
      final error = ref.read(sttProvider).error;
      setState(() {
        _localError = error ?? 'Failed to start recording';
      });
      HapticFeedback.heavyImpact();
    }
  }
  Future<void> _stopAndTranscribe() async {
    if (_isProcessing) return;
    setState(() {
      _isProcessing = true;
      _localError = null;
    });
    _durationTimer?.cancel();
    _stopWaveformAnimation();
    HapticFeedback.lightImpact();
    final notifier = ref.read(sttProvider.notifier);
    final result = await notifier.stopAndTranscribe();
    if (!mounted) return;
    if (result != null && result.isSuccess && result.text.trim().isNotEmpty) {
      HapticFeedback.heavyImpact();
      Navigator.of(context).pop(result.text.trim());
    } else {
      setState(() {
        _isProcessing = false;
        _localError = result?.error ?? 'Transcription failed';
      });
      HapticFeedback.heavyImpact();
    }
  }
  Future<void> _cancel() async {
    _durationTimer?.cancel();
    _stopWaveformAnimation();
    HapticFeedback.lightImpact();
    final notifier = ref.read(sttProvider.notifier);
    await notifier.cancelRecording();
    if (mounted) {
      Navigator.of(context).pop(null);
    }
  }
  @override
  Widget build(BuildContext context) {
    final sttState = ref.watch(sttProvider);
    final isRecording = sttState.recordingState == RecordingState.recording;
    final isTranscribing =
        sttState.recordingState == RecordingState.transcribing || _isProcessing;
    final hasError = _localError != null;
    final ocTheme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Center(
        child: Padding(
          padding: Insets.cardLg,
          child: ScaleTransition(
            scale: _pulseAnimation,
            child: Container(
              constraints: const BoxConstraints(maxWidth: 360),
              decoration: BoxDecoration(
                color: ocTheme.backgroundPanel,
                borderRadius: Radii.brXxl,
                border: Border.all(
                  color: ocTheme.borderSubtle,
                  width: 1,
                ),
                boxShadow: [
                  BoxShadow(
                    color: ocTheme.bgDeep.withValues(alpha: 0.4),
                    blurRadius: 40,
                    spreadRadius: 10,
                  ),
                ],
              ),
              child: Padding(
                padding: Insets.screenAll,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Top row: Cancel and Confirm buttons
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // Cancel button
                        _CircleButton(
                          icon: AppIcons.close,
                          onTap: isTranscribing ? null : _cancel,
                          backgroundColor: ocTheme.bgHighlight,
                          iconColor: ocTheme.textMuted,
                        ),
                        // Confirm button
                        _CircleButton(
                          icon: AppIcons.check,
                          onTap: (isRecording && _duration.inMilliseconds > 300)
                              ? _stopAndTranscribe
                              : null,
                          backgroundColor: isTranscribing
                              ? ocTheme.bgHighlight
                              : ocTheme.primary,
                          iconColor: isTranscribing
                              ? ocTheme.textMuted
                              : ocTheme.selectedListItemText,
                          isLoading: isTranscribing,
                        ),
                      ],
                    ),
                    SizedBox(height: Spacing.xxxl),
                    // Waveform visualization
                    if (hasError)
                      _ErrorDisplay(
                        error: _localError!,
                        onRetry: () {
                          setState(() {
                            _localError = null;
                            _duration = Duration.zero;
                          });
                          ref.read(sttProvider.notifier).clearError();
                          _startRecording();
                        },
                      )
                    else
                      // AnimatedBuilder repaints only this subtree on each
                      // animation tick — no setState on the parent overlay.
                      AnimatedBuilder(
                        animation: _waveController,
                        builder: (context, _) => _AnimatedWaveform(
                          levels: _audioLevels,
                          isActive: isRecording,
                          color: ocTheme.primary,
                        ),
                      ),
                    SizedBox(height: Spacing.xxxl),
                    // Bottom row: Language indicator
                    Row(
                      children: [
                        Container(
                          padding: Insets.cardXs,
                          decoration: BoxDecoration(
                            color: ocTheme.bgHover,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: ocTheme.borderSubtle,
                              width: 1,
                            ),
                          ),
                          child: Icon(
                            AppIcons.globe,
                            color: ocTheme.textMuted,
                            size: 18,
                          ),
                        ),
                        SizedBox(width: Spacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                sttState.settings.provider.displayName,
                                style: TextStyle(
                                  color: ocTheme.text,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                _formatDuration(_duration),
                                style: TextStyle(
                                  color: isRecording
                                      ? ocTheme.error
                                      : ocTheme.textMuted,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                  fontFeatures: const [
                                    FontFeature.tabularFigures(),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        // Recording indicator dot
                        if (isRecording)
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: ocTheme.error,
                              shape: BoxShape.circle,
                              boxShadow: [
                                BoxShadow(
                                  color: ocTheme.error.withValues(alpha: 0.5),
                                  blurRadius: 8,
                                  spreadRadius: 2,
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
  String _formatDuration(Duration d) {
    final minutes = d.inMinutes;
    final seconds = d.inSeconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }
}
/// Circular action button with optional loading state
class _CircleButton extends StatelessWidget {
  const _CircleButton({
    required this.icon,
    required this.onTap,
    required this.backgroundColor,
    required this.iconColor,
    this.isLoading = false,
  });
  final IconData icon;
  final VoidCallback? onTap;
  final Color backgroundColor;
  final Color iconColor;
  final bool isLoading;
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: backgroundColor,
          shape: BoxShape.circle,
        ),
        child: Center(
          child: isLoading
              ? SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: iconColor,
                  ),
                )
              : Icon(icon, color: iconColor, size: 22),
        ),
      ),
    );
  }
}
/// Animated waveform visualization with vertical bars
class _AnimatedWaveform extends StatelessWidget {
  const _AnimatedWaveform({
    required this.levels,
    required this.isActive,
    required this.color,
  });
  final List<double> levels;
  final bool isActive;
  final Color color;
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 80,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: List.generate(levels.length, (index) {
          // Create a wave pattern - bars in center are taller
          final distanceFromCenter = (index - levels.length / 2).abs();
          final baseHeight =
              1 - (distanceFromCenter / (levels.length / 2)) * 0.3;
          final level = isActive ? levels[index] : 0.15;
          final height = (level * baseHeight * 60).clamp(4.0, 60.0);
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 100),
              curve: Curves.easeOut,
              width: 4,
              height: height,
              decoration: BoxDecoration(
                color: color.withValues(alpha: isActive ? 1.0 : 0.3),
                borderRadius: Radii.brXs,
              ),
            ),
          );
        }),
      ),
    );
  }
}
/// Error display with retry option
class _ErrorDisplay extends StatelessWidget {
  const _ErrorDisplay({required this.error, required this.onRetry});
  final String error;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Builder(builder: (context) {
        final ocTheme = OpenCodeTheme.of(context);
        return Container(
          padding: Insets.card,
          decoration: BoxDecoration(
            color: ocTheme.error.withValues(alpha: 0.1),
            borderRadius: Radii.brLg,
            border: Border.all(
              color: ocTheme.error.withValues(alpha: 0.3),
              width: 1,
            ),
          ),
          child: Column(
            children: [
              Icon(
                AppIcons.error,
                color: ocTheme.error,
                size: 32,
              ),
              SizedBox(height: Spacing.md),
              Text(
                error,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: ocTheme.text,
                  fontSize: 13,
                ),
              ),
              SizedBox(height: Spacing.lg),
              GestureDetector(
                onTap: onRetry,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: ocTheme.bgHighlight,
                    borderRadius: Radii.brXl,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        AppIcons.refresh,
                        color: ocTheme.text,
                        size: 18,
                      ),
                      SizedBox(width: Spacing.sm),
                      Text(
                        'Try Again',
                        style: TextStyle(
                          color: ocTheme.text,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
        }),
      ],
    );
  }
}
