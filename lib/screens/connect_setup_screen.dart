import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/onboarding_provider.dart';

/// "Connect to your Mac" screen shown after paywall during onboarding.
/// Asks whether the user has the bridge running or needs setup instructions.
class ConnectSetupScreen extends ConsumerStatefulWidget {
  const ConnectSetupScreen({super.key});

  @override
  ConsumerState<ConnectSetupScreen> createState() => _ConnectSetupScreenState();
}

class _ConnectSetupScreenState extends ConsumerState<ConnectSetupScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.of(context).size;
    final isTablet = screenSize.width > 600;

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 1),
            // Illustration
            FadeTransition(
              opacity: CurvedAnimation(
                parent: _controller,
                curve: const Interval(0.0, 0.5, curve: Curves.easeOut),
              ),
              child: _ConnectionIllustration(isTablet: isTablet),
            ),
            const SizedBox(height: 40),
            // Text
            FadeTransition(
              opacity: CurvedAnimation(
                parent: _controller,
                curve: const Interval(0.2, 0.7, curve: Curves.easeOut),
              ),
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: isTablet ? 64 : 32),
                child: Column(
                  children: [
                    Text(
                      'Connect to your Mac',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: isTablet ? 32 : 28,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Broski connects to a lightweight bridge running on your development machine.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: isTablet ? 17 : 16,
                        color: Colors.white.withValues(alpha: 0.6),
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const Spacer(flex: 1),
            // Buttons
            FadeTransition(
              opacity: CurvedAnimation(
                parent: _controller,
                curve: const Interval(0.4, 1.0, curve: Curves.easeOut),
              ),
              child: Padding(
                padding: EdgeInsets.fromLTRB(24, 0, 24, isTablet ? 48 : 32),
                child: Column(
                  children: [
                    _PrimaryButton(
                      label: 'Set up my Mac',
                      onPressed: () {
                        ref
                            .read(onboardingProvider.notifier)
                            .setHasMacSetup(false);
                      },
                    ),
                    const SizedBox(height: 12),
                    _SecondaryButton(
                      label: 'I already have the bridge running',
                      onPressed: () {
                        ref
                            .read(onboardingProvider.notifier)
                            .setHasMacSetup(true);
                      },
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// CONNECTION ILLUSTRATION
// =============================================================================

class _ConnectionIllustration extends StatelessWidget {
  const _ConnectionIllustration({required this.isTablet});

  final bool isTablet;

  @override
  Widget build(BuildContext context) {
    final size = isTablet ? 180.0 : 140.0;

    return SizedBox(
      height: size * 1.2,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Connection line
          Positioned(
            child: Container(
              width: size * 1.6,
              height: 3,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    const Color(0xFF6366F1).withValues(alpha: 0.6),
                    const Color(0xFF10B981).withValues(alpha: 0.6),
                  ],
                ),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          // Animated dots on line
          ...List.generate(3, (index) {
            return Positioned(
              left: size * 0.3 + (index * size * 0.5),
              child: TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: 1),
                duration: Duration(milliseconds: 1500 + (index * 200)),
                builder: (context, value, child) {
                  return Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: Color.lerp(
                        const Color(0xFF6366F1),
                        const Color(0xFF10B981),
                        (index / 2),
                      ),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF6366F1).withValues(alpha: 0.5),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                  );
                },
              ),
            );
          }),
          // Phone
          Positioned(
            left: 0,
            child: Container(
              width: size * 0.55,
              height: size,
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A1A),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.1),
                  width: 2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF6366F1).withValues(alpha: 0.3),
                    blurRadius: 30,
                    offset: const Offset(-10, 10),
                  ),
                ],
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Center(
                      child: Text(
                        'B',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 20,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'iPhone',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.6),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Mac
          Positioned(
            right: 0,
            child: Container(
              width: size * 0.85,
              height: size * 0.7,
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A1A),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.1),
                  width: 2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF10B981).withValues(alpha: 0.3),
                    blurRadius: 30,
                    offset: const Offset(10, 10),
                  ),
                ],
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.laptop_mac_rounded,
                    color: Color(0xFF10B981),
                    size: 36,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Your Mac',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.6),
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// BUTTONS
// =============================================================================

class _PrimaryButton extends StatefulWidget {
  const _PrimaryButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  State<_PrimaryButton> createState() => _PrimaryButtonState();
}

class _PrimaryButtonState extends State<_PrimaryButton>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 100),
    );
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 0.97,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => _controller.forward(),
      onTapUp: (_) {
        _controller.reverse();
        HapticFeedback.lightImpact();
        widget.onPressed();
      },
      onTapCancel: () => _controller.reverse(),
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) {
          return Transform.scale(scale: _scaleAnimation.value, child: child);
        },
        child: Container(
          width: double.infinity,
          height: 56,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.white.withValues(alpha: 0.25),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Center(
            child: Text(
              widget.label,
              style: const TextStyle(
                color: Colors.black,
                fontSize: 17,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.2,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SecondaryButton extends StatelessWidget {
  const _SecondaryButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        HapticFeedback.lightImpact();
        onPressed();
      },
      child: Container(
        width: double.infinity,
        height: 56,
        decoration: BoxDecoration(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.6),
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}
