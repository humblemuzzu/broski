import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers/app_auth_provider.dart';

/// Pixel-perfect "Identify Yourself" auth screen matching Figma design.
/// Dark, cinematic aesthetic with scanning animation over profile image.
class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});

  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _scanController;

  @override
  void initState() {
    super.initState();
    _scanController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2400),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _scanController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(appAuthProvider);
    final screenWidth = MediaQuery.of(context).size.width;

    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 48),

              // -- SYSTEM ONLINE indicator --
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: const Color(0xFF22C55E),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF22C55E).withValues(alpha: 0.5),
                          blurRadius: 8,
                          spreadRadius: 1,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    'SYSTEM ONLINE',
                    style: GoogleFonts.jetBrainsMono(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: Colors.white.withValues(alpha: 0.55),
                      letterSpacing: 1.5,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // -- "Identify\nYourself." heading --
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: 'Identify\n',
                      style: GoogleFonts.inter(
                        fontSize: 44,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                        height: 1.1,
                        letterSpacing: -1.0,
                      ),
                    ),
                    TextSpan(
                      text: 'Yourself.',
                      style: GoogleFonts.inter(
                        fontSize: 44,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFF555555),
                        height: 1.1,
                        letterSpacing: -1.0,
                      ),
                    ),
                  ],
                ),
              ),

              const Spacer(flex: 2),

              // -- Scanning image box --
              Center(
                child: _ScanningImageBox(
                  scanController: _scanController,
                  boxWidth: math.min(screenWidth - 56, 320),
                ),
              ),

              const Spacer(flex: 2),

              // -- Error display --
              if (state.error != null) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444).withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: const Color(0xFFEF4444).withValues(alpha: 0.20),
                    ),
                  ),
                  child: Text(
                    state.error!,
                    style: const TextStyle(
                      color: Color(0xFFEF4444),
                      fontSize: 13,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // -- Continue with Apple button (iOS only, on top) --
              if (Platform.isIOS) ...[
                _AuthButton(
                  label: 'Continue with Apple',
                  icon: Icons.apple,
                  isLoading: state.isLoading,
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    ref.read(appAuthProvider.notifier).signInWithApple();
                  },
                ),
                const SizedBox(height: 14),
              ],

              // -- Continue with Google button --
              _AuthButton(
                label: 'Continue with Google',
                icon: Icons.g_mobiledata_rounded,
                iconAsset: 'docs/assets/google-logo.png',
                isLoading: state.isLoading,
                outlined: true,
                onPressed: () {
                  HapticFeedback.lightImpact();
                  ref.read(appAuthProvider.notifier).signInWithGoogle();
                },
              ),
              const SizedBox(height: 20),

              // -- Terms and Privacy Policy --
              Center(
                child: Text.rich(
                  TextSpan(
                    style: GoogleFonts.jetBrainsMono(
                      fontSize: 11,
                      color: Colors.white.withValues(alpha: 0.35),
                      height: 1.5,
                    ),
                    children: [
                      const TextSpan(text: 'By identifying, you agree to the '),
                      WidgetSpan(
                        child: GestureDetector(
                          onTap: () =>
                              _launchUrl('https://broskiapp.com/legal/terms'),
                          child: Text(
                            'Terms of Service',
                            style: GoogleFonts.jetBrainsMono(
                              fontSize: 11,
                              color: Colors.white.withValues(alpha: 0.55),
                              decoration: TextDecoration.underline,
                              decorationColor: Colors.white.withValues(
                                alpha: 0.35,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const TextSpan(text: '\nand '),
                      WidgetSpan(
                        child: GestureDetector(
                          onTap: () =>
                              _launchUrl('https://broskiapp.com/legal/privacy'),
                          child: Text(
                            'Privacy Policy',
                            style: GoogleFonts.jetBrainsMono(
                              fontSize: 11,
                              color: Colors.white.withValues(alpha: 0.55),
                              decoration: TextDecoration.underline,
                              decorationColor: Colors.white.withValues(
                                alpha: 0.35,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const TextSpan(text: '.'),
                    ],
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}

// =============================================================================
// SCANNING IMAGE BOX
// =============================================================================

class _ScanningImageBox extends StatelessWidget {
  const _ScanningImageBox({
    required this.scanController,
    required this.boxWidth,
  });

  final AnimationController scanController;
  final double boxWidth;

  @override
  Widget build(BuildContext context) {
    final boxHeight = boxWidth * 0.88; // slightly taller than square

    return SizedBox(
      width: boxWidth,
      height: boxHeight,
      child: Stack(
        children: [
          // -- Rounded container with border --
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.08),
                  width: 1,
                ),
                color: Colors.white.withValues(alpha: 0.03),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(15),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    // -- Dull profile image --
                    ColorFiltered(
                      colorFilter: ColorFilter.matrix(<double>[
                        0.3, 0.3, 0.3, 0, 0, //
                        0.3, 0.3, 0.3, 0, 0, //
                        0.3, 0.3, 0.3, 0, 0, //
                        0, 0, 0, 0.7, 0, //
                      ]),
                      child: Image.asset(
                        'docs/assets/dax-oc.jpg',
                        fit: BoxFit.cover,
                      ),
                    ),
                    // -- Dark overlay to make it more moody --
                    Container(color: Colors.black.withValues(alpha: 0.35)),
                  ],
                ),
              ),
            ),
          ),

          // -- Fingerprint icon (centered) --
          Center(
            child: Icon(
              Icons.fingerprint_rounded,
              size: 56,
              color: Colors.white.withValues(alpha: 0.65),
            ),
          ),

          // -- Scanning line animation --
          AnimatedBuilder(
            animation: scanController,
            builder: (context, _) {
              final yPos = scanController.value * (boxHeight - 2);
              return Positioned(
                top: yPos,
                left: 0,
                right: 0,
                child: Container(
                  height: 1.5,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.transparent,
                        Colors.white.withValues(alpha: 0.45),
                        Colors.white.withValues(alpha: 0.7),
                        Colors.white.withValues(alpha: 0.45),
                        Colors.transparent,
                      ],
                      stops: const [0.0, 0.2, 0.5, 0.8, 1.0],
                    ),
                  ),
                ),
              );
            },
          ),

          // -- Subtle glow around scan line --
          AnimatedBuilder(
            animation: scanController,
            builder: (context, _) {
              final yPos = scanController.value * (boxHeight - 2);
              return Positioned(
                top: yPos - 20,
                left: 0,
                right: 0,
                child: Container(
                  height: 42,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.transparent,
                        Colors.white.withValues(alpha: 0.04),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              );
            },
          ),

          // -- "ID: UNKNOWN" and "ACCESS: PENDING" text at bottom --
          Positioned(
            left: 16,
            bottom: 16,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'ID: UNKNOWN',
                  style: GoogleFonts.jetBrainsMono(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: Colors.white.withValues(alpha: 0.40),
                    letterSpacing: 1.2,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'ACCESS: PENDING',
                  style: GoogleFonts.jetBrainsMono(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: Colors.white.withValues(alpha: 0.40),
                    letterSpacing: 1.2,
                  ),
                ),
              ],
            ),
          ),

          // -- Corner bracket marks for sci-fi feel --
          // Top-left
          Positioned(
            top: 0,
            left: 0,
            child: _CornerBracket(
              rotation: 0,
              color: Colors.white.withValues(alpha: 0.12),
            ),
          ),
          // Top-right
          Positioned(
            top: 0,
            right: 0,
            child: _CornerBracket(
              rotation: 90,
              color: Colors.white.withValues(alpha: 0.12),
            ),
          ),
          // Bottom-right
          Positioned(
            bottom: 0,
            right: 0,
            child: _CornerBracket(
              rotation: 180,
              color: Colors.white.withValues(alpha: 0.12),
            ),
          ),
          // Bottom-left
          Positioned(
            bottom: 0,
            left: 0,
            child: _CornerBracket(
              rotation: 270,
              color: Colors.white.withValues(alpha: 0.12),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// CORNER BRACKET DECORATION
// =============================================================================

class _CornerBracket extends StatelessWidget {
  const _CornerBracket({required this.rotation, required this.color});

  final double rotation;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: rotation * math.pi / 180,
      child: SizedBox(
        width: 24,
        height: 24,
        child: CustomPaint(painter: _CornerBracketPainter(color: color)),
      ),
    );
  }
}

class _CornerBracketPainter extends CustomPainter {
  _CornerBracketPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final path = Path()
      ..moveTo(0, size.height * 0.45)
      ..lineTo(0, 0)
      ..lineTo(size.width * 0.45, 0);

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// =============================================================================
// AUTH BUTTON
// =============================================================================

class _AuthButton extends StatelessWidget {
  const _AuthButton({
    required this.label,
    required this.icon,
    required this.isLoading,
    required this.onPressed,
    this.outlined = false,
    this.iconAsset,
  });

  final String label;
  final IconData icon;
  final bool isLoading;
  final VoidCallback onPressed;
  final bool outlined;
  final String? iconAsset;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isLoading ? null : onPressed,
      child: Container(
        width: double.infinity,
        height: 56,
        decoration: BoxDecoration(
          color: outlined
              ? Colors.transparent
              : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: Colors.white.withValues(alpha: outlined ? 0.12 : 0.10),
            width: 1,
          ),
        ),
        child: Center(
          child: isLoading
              ? SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (iconAsset != null)
                      Image.asset(
                        iconAsset!,
                        width: 20,
                        height: 20,
                        fit: BoxFit.contain,
                      )
                    else
                      Icon(
                        icon,
                        color: Colors.white.withValues(alpha: 0.8),
                        size: 22,
                      ),
                    const SizedBox(width: 12),
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: Colors.white.withValues(alpha: 0.85),
                        letterSpacing: 0.1,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
