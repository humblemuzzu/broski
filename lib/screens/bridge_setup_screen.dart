import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart'
    show onboardingProvider, kDevBypassOnboarding;

/// "Run the Bridge" screen shown after paywall during onboarding.
/// Terminal-style mockup with shimmer animation and copy-to-clipboard.
class BridgeSetupScreen extends ConsumerStatefulWidget {
  const BridgeSetupScreen({super.key});

  @override
  ConsumerState<BridgeSetupScreen> createState() => _BridgeSetupScreenState();
}

class _BridgeSetupScreenState extends ConsumerState<BridgeSetupScreen>
    with TickerProviderStateMixin {
  static const _command = 'npx broski-bridge@latest';
  bool _copied = false;

  late AnimationController _shimmerController;
  late AnimationController _cursorController;
  late AnimationController _entryController;

  @override
  void initState() {
    super.initState();

    // Shimmer wave animation - continuous right-to-left sweep
    _shimmerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2500),
    )..repeat();

    // Blinking cursor
    _cursorController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat(reverse: true);

    // Entry animation
    _entryController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..forward();
  }

  @override
  void dispose() {
    _shimmerController.dispose();
    _cursorController.dispose();
    _entryController.dispose();
    super.dispose();
  }

  void _copyCommand() {
    Clipboard.setData(const ClipboardData(text: _command));
    HapticFeedback.lightImpact();
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final entryAnimation = CurvedAnimation(
      parent: _entryController,
      curve: Curves.easeOutCubic,
    );

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 48),
              // Step indicator + title
              FadeTransition(
                opacity: entryAnimation,
                child: Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: const Color(0xFF2ECB71).withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Text(
                          '1',
                          style: TextStyle(
                            color: Color(0xFF2ECB71),
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Text(
                      'Run the Bridge',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              FadeTransition(
                opacity: entryAnimation,
                child: Text(
                  'Open your terminal on your Mac and run this command to start the server.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.5),
                    fontSize: 15,
                    height: 1.5,
                  ),
                ),
              ),
              const SizedBox(height: 28),
              // Terminal card with shimmer
              FadeTransition(
                opacity: entryAnimation,
                child: _buildTerminalCard(),
              ),
              const SizedBox(height: 20),
              // Info hint
              FadeTransition(
                opacity: entryAnimation,
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.04),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.06),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.info_outline_rounded,
                        color: Colors.white.withValues(alpha: 0.35),
                        size: 20,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Ensure your Mac and iPhone are on the same Wi-Fi network for the lowest latency.',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.4),
                            fontSize: 13,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const Spacer(),
              // CTA button
              FadeTransition(
                opacity: entryAnimation,
                child: GestureDetector(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    ref.read(onboardingProvider.notifier).goToScanner();
                  },
                  child: Container(
                    width: double.infinity,
                    height: 58,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(32),
                    ),
                    child: const Center(
                      child: Text(
                        'I have the QR Code',
                        style: TextStyle(
                          color: Colors.black,
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              // DEV BYPASS: skip to next step
              if (kDevBypassOnboarding) ...[
                const SizedBox(height: 14),
                Center(
                  child: GestureDetector(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      ref.read(onboardingProvider.notifier).skipForward();
                    },
                    child: Text(
                      'Skip (dev) \u2192',
                      style: TextStyle(
                        color: Colors.red.withValues(alpha: 0.6),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTerminalCard() {
    return AnimatedBuilder(
      animation: _shimmerController,
      builder: (context, child) {
        return Container(
          decoration: BoxDecoration(
            color: const Color(0xFF1A1A1A),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              // Shimmer wave overlay
              Positioned.fill(
                child: ShaderMask(
                  shaderCallback: (bounds) {
                    final progress = _shimmerController.value;
                    // Wave sweeps from right to left
                    final center = 1.0 - progress;
                    return LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [
                        Colors.transparent,
                        Colors.white.withValues(alpha: 0.03),
                        Colors.white.withValues(alpha: 0.08),
                        Colors.white.withValues(alpha: 0.03),
                        Colors.transparent,
                      ],
                      stops: [
                        (center - 0.3).clamp(0.0, 1.0),
                        (center - 0.15).clamp(0.0, 1.0),
                        center.clamp(0.0, 1.0),
                        (center + 0.15).clamp(0.0, 1.0),
                        (center + 0.3).clamp(0.0, 1.0),
                      ],
                    ).createShader(bounds);
                  },
                  blendMode: BlendMode.srcATop,
                  child: Container(color: Colors.white),
                ),
              ),
              // Terminal content
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Traffic lights + copy button
                    Row(
                      children: [
                        _buildTrafficLight(const Color(0xFFFF5F57)),
                        const SizedBox(width: 8),
                        _buildTrafficLight(const Color(0xFFFFBD2E)),
                        const SizedBox(width: 8),
                        _buildTrafficLight(const Color(0xFF28C840)),
                        const Spacer(),
                        GestureDetector(
                          onTap: _copyCommand,
                          child: AnimatedSwitcher(
                            duration: const Duration(milliseconds: 200),
                            child: Icon(
                              _copied
                                  ? Icons.check_rounded
                                  : Icons.copy_rounded,
                              key: ValueKey(_copied),
                              color: _copied
                                  ? const Color(0xFF2ECB71)
                                  : Colors.white.withValues(alpha: 0.4),
                              size: 18,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    // $ prompt
                    Text(
                      '\$',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.35),
                        fontSize: 14,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 8),
                    // Command text
                    Row(
                      children: [
                        const Text(
                          'npx ',
                          style: TextStyle(
                            color: Color(0xFF2ECB71),
                            fontSize: 16,
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const Text(
                          'broski-bridge@latest',
                          style: TextStyle(
                            color: Color(0xFF2ECB71),
                            fontSize: 16,
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    // Blinking cursor
                    FadeTransition(
                      opacity: _cursorController,
                      child: Container(
                        width: 8,
                        height: 18,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.6),
                          borderRadius: BorderRadius.circular(1),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTrafficLight(Color color) {
    return Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
