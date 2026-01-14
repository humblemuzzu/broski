import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../models/connection.dart';
import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import '../widgets/onboarding_widgets.dart';

class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen>
    with SingleTickerProviderStateMixin {
  final MobileScannerController _scannerController = MobileScannerController();
  bool _handledScan = false;
  bool _hasCachedData = false;
  bool _checkingCache = true;
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _checkCachedData();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 0.8, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  Future<void> _checkCachedData() async {
    final storage = ref.read(storageServiceProvider);
    final hasData = await storage.hasCachedData();
    if (mounted) {
      setState(() {
        _hasCachedData = hasData;
        _checkingCache = false;
      });
    }
  }

  @override
  void dispose() {
    _scannerController.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  void _handleScan(String raw) {
    if (_handledScan) return;
    final info = ConnectionInfo.parseQrPayload(raw);
    if (info == null) return;
    _handledScan = true;
    HapticFeedback.mediumImpact();
    ref.read(connectionProvider.notifier).connect(info);
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Scan QR Code',
                    style: TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      color: theme.text,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Point your camera at the QR code shown on your Mac.',
                    style: TextStyle(color: theme.textMuted, fontSize: 16),
                  ),
                ],
              ),
            ),
            // Scanner
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Stack(
                  children: [
                    // Scanner container
                    Container(
                      decoration: BoxDecoration(
                        color: theme.backgroundPanel,
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: theme.borderSubtle),
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(24),
                        child: MobileScanner(
                          controller: _scannerController,
                          onDetect: (capture) {
                            final barcode = capture.barcodes.first;
                            final raw = barcode.rawValue;
                            if (raw == null) return;
                            _handleScan(raw);
                          },
                        ),
                      ),
                    ),
                    // Scan frame overlay
                    Center(
                      child: AnimatedBuilder(
                        animation: _pulseAnimation,
                        builder: (context, child) {
                          return Transform.scale(
                            scale: _pulseAnimation.value,
                            child: child,
                          );
                        },
                        child: Container(
                          width: 220,
                          height: 220,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: theme.primary.withValues(alpha: 0.6),
                              width: 3,
                            ),
                          ),
                          child: Stack(
                            children: [
                              // Corner accents
                              Positioned(
                                top: -1.5,
                                left: -1.5,
                                child: _buildCorner(theme, 0),
                              ),
                              Positioned(
                                top: -1.5,
                                right: -1.5,
                                child: _buildCorner(theme, 1),
                              ),
                              Positioned(
                                bottom: -1.5,
                                left: -1.5,
                                child: _buildCorner(theme, 2),
                              ),
                              Positioned(
                                bottom: -1.5,
                                right: -1.5,
                                child: _buildCorner(theme, 3),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            // Actions
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: OnboardingButton(
                          label: 'Enter Manually',
                          variant: OnboardingButtonVariant.secondary,
                          icon: Icons.keyboard_rounded,
                          onPressed: () => _showManualEntry(context, theme),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Show "Try Demo" for first-time users, "Browse Offline" if they have cached data
                  OnboardingButton(
                    label: _hasCachedData ? 'Browse Offline' : 'Try Demo',
                    variant: OnboardingButtonVariant.ghost,
                    icon: _hasCachedData
                        ? Icons.cloud_off_rounded
                        : Icons.play_circle_outline_rounded,
                    onPressed: _checkingCache
                        ? null
                        : () {
                            if (_hasCachedData) {
                              // Has cached data - enter offline mode to browse it
                              ref
                                  .read(connectionProvider.notifier)
                                  .enterOfflineMode();
                            } else {
                              // No cached data - enter demo mode with sample data
                              ref
                                  .read(connectionProvider.notifier)
                                  .enterDemoMode();
                            }
                          },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCorner(OpenCodeTheme theme, int position) {
    // position: 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right
    final isTop = position < 2;
    final isLeft = position % 2 == 0;

    return SizedBox(
      width: 32,
      height: 32,
      child: CustomPaint(
        painter: _CornerPainter(
          color: theme.primary,
          isTop: isTop,
          isLeft: isLeft,
        ),
      ),
    );
  }

  Future<void> _showManualEntry(
    BuildContext context,
    OpenCodeTheme theme,
  ) async {
    final hostController = TextEditingController();
    final portController = TextEditingController(text: '18274');

    final result = await showModalBottomSheet<ConnectionInfo>(
      context: context,
      backgroundColor: theme.backgroundPanel,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(context).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: theme.borderSubtle,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Manual Connection',
                style: TextStyle(
                  color: theme.text,
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Enter the IP address and port shown on your Mac.',
                style: TextStyle(color: theme.textMuted),
              ),
              const SizedBox(height: 24),
              _buildTextField(
                theme,
                controller: hostController,
                label: 'Host (IP or hostname)',
                hint: '192.168.1.100',
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 16),
              _buildTextField(
                theme,
                controller: portController,
                label: 'Port',
                hint: '18274',
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 24),
              OnboardingButton(
                label: 'Connect',
                onPressed: () {
                  final host = hostController.text.trim();
                  final port =
                      int.tryParse(portController.text.trim()) ?? 18274;
                  if (host.isEmpty) return;
                  Navigator.pop(
                    context,
                    ConnectionInfo(localIP: host, port: port),
                  );
                },
              ),
              const SizedBox(height: 12),
              OnboardingButton(
                label: 'Cancel',
                variant: OnboardingButtonVariant.ghost,
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
        );
      },
    );

    if (result != null) {
      ref.read(connectionProvider.notifier).connect(result);
    }
  }

  Widget _buildTextField(
    OpenCodeTheme theme, {
    required TextEditingController controller,
    required String label,
    required String hint,
    TextInputType? keyboardType,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: theme.text,
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: theme.backgroundElement,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: theme.border),
          ),
          child: TextField(
            controller: controller,
            keyboardType: keyboardType,
            style: TextStyle(color: theme.text),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: TextStyle(color: theme.textMuted),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 14,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _CornerPainter extends CustomPainter {
  _CornerPainter({
    required this.color,
    required this.isTop,
    required this.isLeft,
  });

  final Color color;
  final bool isTop;
  final bool isLeft;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    final path = Path();
    const length = 24.0;

    if (isTop && isLeft) {
      path.moveTo(0, length);
      path.lineTo(0, 0);
      path.lineTo(length, 0);
    } else if (isTop && !isLeft) {
      path.moveTo(size.width - length, 0);
      path.lineTo(size.width, 0);
      path.lineTo(size.width, length);
    } else if (!isTop && isLeft) {
      path.moveTo(0, size.height - length);
      path.lineTo(0, size.height);
      path.lineTo(length, size.height);
    } else {
      path.moveTo(size.width - length, size.height);
      path.lineTo(size.width, size.height);
      path.lineTo(size.width, size.height - length);
    }

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
