import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import 'package:broski/theme/app_icons.dart';
import '../utils/responsive.dart';
import '../providers/onboarding_provider.dart'
    show onboardingProvider, kDevBypassOnboarding;

/// "Run the Bridge" screen shown after paywall during onboarding.
/// Pixel-perfect terminal mockup matching Figma design.
class BridgeSetupScreen extends ConsumerStatefulWidget {
  const BridgeSetupScreen({super.key});
  @override
  ConsumerState<BridgeSetupScreen> createState() => _BridgeSetupScreenState();
}

class _BridgeSetupScreenState extends ConsumerState<BridgeSetupScreen>
    with TickerProviderStateMixin {
  late AnimationController _cursorController;
  late AnimationController _entryController;
  int _copiedIndex = -1;
  static const _installCmd = 'curl -fsSL https://broskiapp.com/install | sh';
  static const _wizardCmd = 'broski';
  static const _daemonCmd = 'broski install';
  @override
  void initState() {
    super.initState();
    _cursorController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat(reverse: true);
    _entryController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..forward();

    // Pre-prompt iOS Local Network permission by making a dummy request.
    // iOS shows the "Allow app to find devices on local network?" dialog on
    // the first local network access after a fresh install. By triggering it
    // here (while the user is reading setup instructions), the permission is
    // already granted by the time they scan the QR code and we attempt the
    // real WebSocket connection. The request silently fails — we don't care
    // about the result, only about triggering the OS dialog.
    if (!kIsWeb) {
      _prePromptLocalNetworkPermission();
    }
  }

  /// Trigger iOS Local Network permission dialog early.
  /// Makes a throwaway HTTP request to a non-routable local IP.
  /// The connection will fail (expected), but iOS will show the
  /// permission dialog if it hasn't been granted yet.
  void _prePromptLocalNetworkPermission() {
    Future.microtask(() async {
      try {
        final client = HttpClient();
        client.connectionTimeout = const Duration(milliseconds: 500);
        // 192.0.0.8 is an IANA dummy/documentation IP — guaranteed not to
        // route, but the outbound attempt is enough to trigger the iOS
        // Local Network permission prompt.
        final request = await client.getUrl(
          Uri.parse('http://192.0.0.8:18274/ping'),
        );
        await request.close().timeout(
          const Duration(milliseconds: 500),
          onTimeout: () => throw TimeoutException('expected'),
        );
      } catch (_) {
        // Expected to fail — we only care about triggering the OS dialog.
      }
    });
  }

  @override
  void dispose() {
    _cursorController.dispose();
    _entryController.dispose();
    super.dispose();
  }

  void _copyCommand(int index, String command) {
    Clipboard.setData(ClipboardData(text: command));
    HapticFeedback.lightImpact();
    setState(() => _copiedIndex = index);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copiedIndex = -1);
    });
  }

  @override
  Widget build(BuildContext context) {
    final entry = CurvedAnimation(
      parent: _entryController,
      curve: Curves.easeOutCubic,
    );
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      body: SafeArea(
        child: Padding(
          padding: Responsive.isTablet(context)
              ? const EdgeInsets.symmetric(horizontal: 80, vertical: 24)
              : Insets.section,
          child: Column(
            children: [
              // ── Main dark card
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFF111111),
                    borderRadius: Radii.brXxl,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.06),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // ── Step 1: Install
                          FadeTransition(
                            opacity: entry,
                            child: _stepHeader('1', 'Install Broski'),
                          ),
                          const SizedBox(height: 14),
                          FadeTransition(
                            opacity: entry,
                            child: Text(
                              'Open your terminal on your Mac and run\nthis command to install the bridge.',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.45),
                                fontSize: 15,
                                height: 1.5,
                              ),
                            ),
                          ),
                          SizedBox(height: Spacing.xl),
                          FadeTransition(
                            opacity: entry,
                            child: _terminalCard(
                              index: 0,
                              prefix: 'curl',
                              rest: ' -fsSL https://broskiapp.com/install | sh',
                              command: _installCmd,
                            ),
                          ),
                          SizedBox(height: Spacing.xxxl),
                          // ── Step 2: Run
                          FadeTransition(
                            opacity: entry,
                            child: _stepHeader('2', 'Run the Bridge'),
                          ),
                          const SizedBox(height: 14),
                          FadeTransition(
                            opacity: entry,
                            child: Text(
                              'Choose how you want to start.',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.45),
                                fontSize: 15,
                                height: 1.5,
                              ),
                            ),
                          ),
                          SizedBox(height: Spacing.xl),
                          // Option A: Wizard
                          FadeTransition(
                            opacity: entry,
                            child: _optionCard(
                              index: 1,
                              label: 'Setup Wizard',
                              description: 'Interactive guided setup',
                              prefix: 'broski',
                              rest: '',
                              command: _wizardCmd,
                            ),
                          ),
                          SizedBox(height: Spacing.md),
                          // Option B: Daemon
                          FadeTransition(
                            opacity: entry,
                            child: _optionCard(
                              index: 2,
                              label: 'Always-On Daemon',
                              description: 'Runs in the background on boot',
                              prefix: 'broski',
                              rest: ' install',
                              command: _daemonCmd,
                            ),
                          ),
                          SizedBox(height: Spacing.xxl),
                          // ── Info hint
                          FadeTransition(
                            opacity: entry,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 14,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.04),
                                borderRadius: Radii.brLg,
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.06),
                                ),
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    AppIcons.info,
                                    color: Colors.white.withValues(alpha: 0.3),
                                    size: 20,
                                  ),
                                  SizedBox(width: Spacing.md),
                                  Expanded(
                                    child: Text(
                                      'Ensure your Mac and iPhone are on the same Wi-Fi network for the lowest latency.',
                                      style: TextStyle(
                                        color: Colors.white.withValues(
                                          alpha: 0.4,
                                        ),
                                        fontSize: 13,
                                        height: 1.45,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              SizedBox(height: Spacing.xl),
              // ── CTA button
              FadeTransition(
                opacity: entry,
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
                      borderRadius: Radii.brFull,
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
              // DEV BYPASS (only in debug builds)
              if (kDebugMode && kDevBypassOnboarding) ...[
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
              SizedBox(height: Spacing.md),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Widgets
  // ---------------------------------------------------------------------------
  /// Step number circle + title row.
  Widget _stepHeader(String number, String title) {
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: const BoxDecoration(
            color: Colors.white,
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              number,
              style: const TextStyle(
                color: Colors.black,
                fontSize: 15,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
        const SizedBox(width: 14),
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.3,
          ),
        ),
      ],
    );
  }

  /// Full terminal card with traffic lights, prompt, command, and cursor.
  Widget _terminalCard({
    required int index,
    required String prefix,
    required String rest,
    required String command,
  }) {
    final isCopied = _copiedIndex == index;
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: Radii.brLg,
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title bar
          Container(
            padding: Insets.section,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.04),
            ),
            child: Row(
              children: [
                _dot(const Color(0xFFFF5F57)),
                SizedBox(width: Spacing.sm),
                _dot(const Color(0xFFFFBD2E)),
                SizedBox(width: Spacing.sm),
                _dot(const Color(0xFF28C840)),
                const Spacer(),
              ],
            ),
          ),
          // Body
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // $ + copy
                Row(
                  children: [
                    Text(
                      '\$',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.3),
                        fontSize: 14,
                        fontFamily: AppTypography.codeFontFamily,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const Spacer(),
                    GestureDetector(
                      onTap: () => _copyCommand(index, command),
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 200),
                        child: Icon(
                          isCopied ? AppIcons.check : AppIcons.copy,
                          key: ValueKey('c_${index}_$isCopied'),
                          color: isCopied
                              ? const Color(0xFF2ECB71)
                              : Colors.white.withValues(alpha: 0.35),
                          size: 18,
                        ),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
                // Command
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: prefix,
                        style: TextStyle(
                          color: const Color(0xFF2ECB71),
                          fontSize: 15,
                          fontFamily: AppTypography.codeFontFamily,
                          fontWeight: FontWeight.w600,
                          height: 1.5,
                        ),
                      ),
                      if (rest.isNotEmpty)
                        TextSpan(
                          text: rest,
                          style: TextStyle(
                            color: const Color(
                              0xFF2ECB71,
                            ).withValues(alpha: 0.75),
                            fontSize: 15,
                            fontFamily: AppTypography.codeFontFamily,
                            fontWeight: FontWeight.w500,
                            height: 1.5,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 6),
                // Cursor
                FadeTransition(
                  opacity: _cursorController,
                  child: Container(
                    width: 8,
                    height: 18,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.5),
                      borderRadius: Radii.brXs,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Compact option card for step 2 choices (wizard vs daemon).
  Widget _optionCard({
    required int index,
    required String label,
    required String description,
    required String prefix,
    required String rest,
    required String command,
  }) {
    final isCopied = _copiedIndex == index;
    return Container(
      padding: Insets.card,
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: Radii.brLg,
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    SizedBox(height: Spacing.xs),
                    Text(
                      description,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.4),
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: () => _copyCommand(index, command),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  child: Icon(
                    isCopied ? AppIcons.check : AppIcons.copy,
                    key: ValueKey('c_${index}_$isCopied'),
                    color: isCopied
                        ? const Color(0xFF2ECB71)
                        : Colors.white.withValues(alpha: 0.35),
                    size: 18,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          // Inline command pill
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.4),
              borderRadius: Radii.brSm,
            ),
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '\$ ',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.3),
                      fontSize: 14,
                      fontFamily: AppTypography.codeFontFamily,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  TextSpan(
                    text: prefix,
                    style: TextStyle(
                      color: const Color(0xFF2ECB71),
                      fontSize: 14,
                      fontFamily: AppTypography.codeFontFamily,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (rest.isNotEmpty)
                    TextSpan(
                      text: rest,
                      style: TextStyle(
                        color: const Color(0xFF2ECB71).withValues(alpha: 0.75),
                        fontSize: 14,
                        fontFamily: AppTypography.codeFontFamily,
                        fontWeight: FontWeight.w500,
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

  Widget _dot(Color color) {
    return Container(
      width: 12,
      height: 12,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
