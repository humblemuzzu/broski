import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../models/connection.dart';
import '../providers/connection_provider.dart';
import '../providers/onboarding_provider.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/onboarding_widgets.dart';

class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen>
    with TickerProviderStateMixin {
  final MobileScannerController _scannerController = MobileScannerController();
  bool _handledScan = false;
  bool _flashOn = false;
  bool _processingImage = false;

  late AnimationController _scanLineController;
  late AnimationController _cornerPulseController;

  @override
  void initState() {
    super.initState();

    // Scan line animation - bounces up and down
    _scanLineController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2500),
    )..repeat(reverse: true);

    // Corner bracket pulse
    _cornerPulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _scannerController.dispose();
    _scanLineController.dispose();
    _cornerPulseController.dispose();
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

  void _toggleFlash() {
    _scannerController.toggleTorch();
    HapticFeedback.lightImpact();
    setState(() => _flashOn = !_flashOn);
  }

  Future<void> _pickFromGallery() async {
    if (_processingImage) return;
    setState(() => _processingImage = true);

    try {
      final picker = ImagePicker();
      final image = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1920,
        maxHeight: 1920,
      );

      if (image == null) {
        if (mounted) setState(() => _processingImage = false);
        return;
      }

      final file = File(image.path);
      if (!file.existsSync()) {
        if (mounted) setState(() => _processingImage = false);
        return;
      }

      // Use MobileScanner to analyze the image
      final barcodeCapture = await _scannerController.analyzeImage(image.path);
      if (barcodeCapture != null && barcodeCapture.barcodes.isNotEmpty) {
        final raw = barcodeCapture.barcodes.first.rawValue;
        if (raw != null) {
          _handleScan(raw);
          if (mounted) setState(() => _processingImage = false);
          return;
        }
      }

      // No QR code found in image
      if (mounted) {
        setState(() => _processingImage = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('No QR code found in the selected image.'),
            backgroundColor: Colors.white.withValues(alpha: 0.1),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _processingImage = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to process image: $e'),
            backgroundColor: Colors.red.withValues(alpha: 0.8),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        );
      }
    }
  }

  void _dismiss() {
    // If in onboarding flow, go back to bridge setup
    final onboarding = ref.read(onboardingProvider);
    if (!onboarding.hasCompletedOnboarding) {
      ref.read(onboardingProvider.notifier).goBack();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Full-screen camera
          Positioned.fill(
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
          // Dark overlay with cutout for scan area
          Positioned.fill(
            child: _ScanOverlay(
              scanLineAnimation: _scanLineController,
              cornerPulseAnimation: _cornerPulseController,
            ),
          ),
          // Top header
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 16,
                ),
                child: Column(
                  children: [
                    const Text(
                      'Scan QR Code',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Align the QR code from your terminal',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.6),
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // Bottom controls
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Control bar
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Flash toggle
                        _ControlButton(
                          icon: _flashOn
                              ? Icons.flash_on_rounded
                              : Icons.flash_off_rounded,
                          onTap: _toggleFlash,
                          isActive: _flashOn,
                        ),
                        const SizedBox(width: 16),
                        // Camera active indicator
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 10,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            'CAMERA ACTIVE',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.5),
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 1.2,
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        // Close / back button
                        _ControlButton(
                          icon: Icons.close_rounded,
                          onTap: _dismiss,
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    // Gallery upload row
                    Row(
                      children: [
                        Expanded(
                          child: GestureDetector(
                            onTap: _processingImage ? null : _pickFromGallery,
                            child: Container(
                              height: 50,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.1),
                                ),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  if (_processingImage)
                                    SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white.withValues(
                                          alpha: 0.6,
                                        ),
                                      ),
                                    )
                                  else
                                    Icon(
                                      Icons.photo_library_outlined,
                                      color: Colors.white.withValues(
                                        alpha: 0.6,
                                      ),
                                      size: 20,
                                    ),
                                  const SizedBox(width: 10),
                                  Text(
                                    _processingImage
                                        ? 'Scanning...'
                                        : 'Upload from Gallery',
                                    style: TextStyle(
                                      color: Colors.white.withValues(
                                        alpha: 0.6,
                                      ),
                                      fontSize: 14,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        // Manual entry
                        GestureDetector(
                          onTap: () => _showManualEntry(context),
                          child: Container(
                            height: 50,
                            width: 50,
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.08),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.1),
                              ),
                            ),
                            child: Icon(
                              Icons.keyboard_rounded,
                              color: Colors.white.withValues(alpha: 0.5),
                              size: 22,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showManualEntry(BuildContext context) async {
    final hostController = TextEditingController();
    final portController = TextEditingController(text: '18274');

    final result = await DetailSheet.show<ConnectionInfo>(
      context: context,
      title: 'Manual Connection',
      initialSize: 0.5,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Enter the IP address and port shown on your Mac.',
              style: TextStyle(color: Colors.white.withValues(alpha: 0.5)),
            ),
            const SizedBox(height: 24),
            _buildTextField(
              controller: hostController,
              label: 'Host (IP or hostname)',
              hint: '192.168.1.100',
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 16),
            _buildTextField(
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
                final port = int.tryParse(portController.text.trim()) ?? 18274;
                if (host.isEmpty) return;
                Navigator.pop(
                  context,
                  ConnectionInfo(localIP: host, port: port),
                );
              },
            ),
          ],
        ),
      ),
    );

    if (result != null) {
      ref.read(connectionProvider.notifier).connect(result);
    }
  }

  Widget _buildTextField({
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
            color: Colors.white.withValues(alpha: 0.7),
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
          ),
          child: TextField(
            controller: controller,
            keyboardType: keyboardType,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.3)),
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

// =============================================================================
// SCAN OVERLAY WITH ANIMATED LINE AND CORNER BRACKETS
// =============================================================================

class _ScanOverlay extends StatelessWidget {
  const _ScanOverlay({
    required this.scanLineAnimation,
    required this.cornerPulseAnimation,
  });

  final AnimationController scanLineAnimation;
  final AnimationController cornerPulseAnimation;

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    // Scan window centered, about 65% of screen width
    final scanSize = size.width * 0.65;
    final scanLeft = (size.width - scanSize) / 2;
    final scanTop = (size.height - scanSize) / 2 - 20;

    return Stack(
      children: [
        // Dark overlay with cutout
        CustomPaint(
          size: size,
          painter: _OverlayPainter(
            scanRect: Rect.fromLTWH(scanLeft, scanTop, scanSize, scanSize),
          ),
        ),
        // Corner brackets
        AnimatedBuilder(
          animation: cornerPulseAnimation,
          builder: (context, _) {
            final opacity = 0.6 + 0.4 * cornerPulseAnimation.value;
            return Stack(
              children: [
                // Top-left
                Positioned(
                  left: scanLeft - 2,
                  top: scanTop - 2,
                  child: _CornerBracket(opacity: opacity, rotation: 0),
                ),
                // Top-right
                Positioned(
                  right: scanLeft - 2,
                  top: scanTop - 2,
                  child: _CornerBracket(opacity: opacity, rotation: 1),
                ),
                // Bottom-left
                Positioned(
                  left: scanLeft - 2,
                  bottom: size.height - scanTop - scanSize - 2,
                  child: _CornerBracket(opacity: opacity, rotation: 3),
                ),
                // Bottom-right
                Positioned(
                  right: scanLeft - 2,
                  bottom: size.height - scanTop - scanSize - 2,
                  child: _CornerBracket(opacity: opacity, rotation: 2),
                ),
              ],
            );
          },
        ),
        // Animated scan line
        AnimatedBuilder(
          animation: scanLineAnimation,
          builder: (context, _) {
            final lineY = scanTop + (scanSize * scanLineAnimation.value);
            return Positioned(
              left: scanLeft + 16,
              right: size.width - scanLeft - scanSize + 16,
              top: lineY,
              child: Container(
                height: 2,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Colors.transparent,
                      const Color(0xFF2ECB71).withValues(alpha: 0.8),
                      const Color(0xFF2ECB71),
                      const Color(0xFF2ECB71).withValues(alpha: 0.8),
                      Colors.transparent,
                    ],
                    stops: const [0.0, 0.2, 0.5, 0.8, 1.0],
                  ),
                  borderRadius: BorderRadius.circular(1),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF2ECB71).withValues(alpha: 0.4),
                      blurRadius: 12,
                      spreadRadius: 2,
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}

class _OverlayPainter extends CustomPainter {
  _OverlayPainter({required this.scanRect});

  final Rect scanRect;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Colors.black.withValues(alpha: 0.6);

    // Draw full overlay
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), paint);

    // Cut out the scan area with rounded corners
    final clearPaint = Paint()..blendMode = BlendMode.clear;
    canvas.saveLayer(Rect.fromLTWH(0, 0, size.width, size.height), Paint());
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), paint);
    canvas.drawRRect(
      RRect.fromRectAndRadius(scanRect, const Radius.circular(20)),
      clearPaint,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _OverlayPainter oldDelegate) =>
      oldDelegate.scanRect != scanRect;
}

class _CornerBracket extends StatelessWidget {
  const _CornerBracket({required this.opacity, required this.rotation});

  final double opacity;
  final int rotation; // 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 36,
      height: 36,
      child: CustomPaint(
        painter: _CornerBracketPainter(
          color: Colors.white.withValues(alpha: opacity),
          rotation: rotation,
        ),
      ),
    );
  }
}

class _CornerBracketPainter extends CustomPainter {
  _CornerBracketPainter({required this.color, required this.rotation});

  final Color color;
  final int rotation;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    final path = Path();
    const len = 28.0;

    switch (rotation) {
      case 0: // top-left
        path.moveTo(0, len);
        path.lineTo(0, 0);
        path.lineTo(len, 0);
        break;
      case 1: // top-right
        path.moveTo(size.width - len, 0);
        path.lineTo(size.width, 0);
        path.lineTo(size.width, len);
        break;
      case 2: // bottom-right
        path.moveTo(size.width, size.height - len);
        path.lineTo(size.width, size.height);
        path.lineTo(size.width - len, size.height);
        break;
      case 3: // bottom-left
        path.moveTo(len, size.height);
        path.lineTo(0, size.height);
        path.lineTo(0, size.height - len);
        break;
    }

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _CornerBracketPainter old) =>
      old.color != color || old.rotation != rotation;
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({
    required this.icon,
    required this.onTap,
    this.isActive = false,
  });

  final IconData icon;
  final VoidCallback onTap;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: isActive
              ? Colors.white.withValues(alpha: 0.2)
              : Colors.white.withValues(alpha: 0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(
          icon,
          color: isActive
              ? const Color(0xFFFFBD2E)
              : Colors.white.withValues(alpha: 0.6),
          size: 22,
        ),
      ),
    );
  }
}
