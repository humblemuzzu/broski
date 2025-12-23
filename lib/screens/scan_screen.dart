import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../models/connection.dart';
import '../providers/connection_provider.dart';
import '../theme/colors.dart';

class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  final MobileScannerController _scannerController = MobileScannerController();
  bool _handledScan = false;

  @override
  void dispose() {
    _scannerController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BroskiColors.midnight,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Scan your Broski QR', style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 8),
                  Text(
                    'Run broski-bridge on your Mac, then scan the QR code to connect.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            Expanded(
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 20),
                decoration: BoxDecoration(
                  color: BroskiColors.abyss,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: BroskiColors.slate),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(20),
                  child: MobileScanner(
                    controller: _scannerController,
                    onDetect: (capture) {
                      if (_handledScan) return;
                      final barcode = capture.barcodes.first;
                      final raw = barcode.rawValue;
                      if (raw == null) return;
                      final info = ConnectionInfo.parseQrPayload(raw);
                      if (info == null) return;
                      _handledScan = true;
                      ref.read(connectionProvider.notifier).connect(info);
                    },
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => _showManualEntry(context),
                      child: const Text('Enter manually'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        _scannerController.start();
                      },
                      child: const Text('Rescan'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showManualEntry(BuildContext context) async {
    final hostController = TextEditingController();
    final portController = TextEditingController(text: '18274');

    final result = await showDialog<ConnectionInfo>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Manual connection'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: hostController,
                decoration: const InputDecoration(labelText: 'Host (IP or hostname)'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: portController,
                decoration: const InputDecoration(labelText: 'Port'),
                keyboardType: TextInputType.number,
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () {
                final host = hostController.text.trim();
                final port = int.tryParse(portController.text.trim()) ?? 18274;
                if (host.isEmpty) return;
                Navigator.pop(
                  context,
                  ConnectionInfo(localIP: host, port: port),
                );
              },
              child: const Text('Connect'),
            ),
          ],
        );
      },
    );

    if (result != null) {
      ref.read(connectionProvider.notifier).connect(result);
    }
  }
}
