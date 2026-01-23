import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../models/stt_settings.dart';

/// Service for Speech-to-Text transcription using Groq or OpenAI APIs.
class SttService {
  SttService();

  /// Transcribe an audio file to text.
  Future<TranscriptionResult> transcribe(
    File audioFile,
    SttSettings settings,
  ) async {
    // Validate configuration
    if (!settings.isConfigured) {
      return TranscriptionResult.failure(
        'API key not configured. Go to Settings > Voice Input.',
      );
    }

    if (!await audioFile.exists()) {
      return TranscriptionResult.failure('Audio file not found');
    }

    final fileSize = await audioFile.length();
    if (fileSize < 1000) {
      return TranscriptionResult.failure(
        'Recording too short. Speak longer and try again.',
      );
    }

    if (fileSize > 25 * 1024 * 1024) {
      return TranscriptionResult.failure('Recording too long (max 25MB)');
    }

    try {
      final uri = Uri.parse(
        '${settings.provider.baseUrl}/v1/audio/transcriptions',
      );

      final request = http.MultipartRequest('POST', uri);
      request.headers['Authorization'] = 'Bearer ${settings.currentApiKey}';

      // CRITICAL: Specify content-type explicitly for iOS recordings
      final fileName = audioFile.path.split('/').last;
      final contentType = _getContentType(fileName);

      final bytes = await audioFile.readAsBytes();
      final multipartFile = http.MultipartFile.fromBytes(
        'file',
        bytes,
        filename: fileName,
        contentType: contentType,
      );
      request.files.add(multipartFile);

      request.fields['model'] = settings.modelId;
      request.fields['response_format'] = 'json';

      if (settings.languageHint?.isNotEmpty == true) {
        request.fields['language'] = settings.languageHint!;
      }

      final streamedResponse = await request.send().timeout(
        const Duration(seconds: 30),
        onTimeout: () => throw TimeoutException('Request timed out'),
      );

      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200) {
        final json = jsonDecode(response.body) as Map<String, dynamic>;
        final text = (json['text'] as String? ?? '').trim();

        if (text.isEmpty) {
          return TranscriptionResult.failure(
            'No speech detected. Speak clearly and try again.',
          );
        }

        return TranscriptionResult.success(
          text,
          durationSeconds: (json['duration'] as num?)?.toDouble(),
          language: json['language'] as String?,
        );
      } else {
        return TranscriptionResult.failure(_parseError(response));
      }
    } on SocketException {
      return TranscriptionResult.failure(
        'Network error. Check your connection.',
      );
    } on TimeoutException {
      return TranscriptionResult.failure('Request timed out. Try again.');
    } catch (e) {
      return TranscriptionResult.failure('Failed: ${e.toString()}');
    }
  }

  /// Get content type for audio file
  MediaType _getContentType(String fileName) {
    final ext = fileName.toLowerCase().split('.').last;
    switch (ext) {
      case 'm4a':
        return MediaType('audio', 'mp4');
      case 'mp3':
        return MediaType('audio', 'mpeg');
      case 'wav':
        return MediaType('audio', 'wav');
      case 'ogg':
        return MediaType('audio', 'ogg');
      case 'webm':
        return MediaType('audio', 'webm');
      case 'flac':
        return MediaType('audio', 'flac');
      default:
        return MediaType('audio', 'mp4'); // Default to m4a
    }
  }

  /// Parse error from response
  String _parseError(http.Response response) {
    if (response.statusCode == 401) return 'Invalid API key';
    if (response.statusCode == 429)
      return 'Rate limit exceeded. Wait and retry.';
    if (response.statusCode == 413) return 'Recording too large';

    try {
      final json = jsonDecode(response.body);
      final error = json['error'];
      if (error is Map) return error['message'] ?? 'Unknown error';
      if (error is String) return error;
    } catch (_) {}

    return 'Server error (${response.statusCode})';
  }

  /// Test if an API key is valid by making a minimal request.
  ///
  /// Returns null if valid, or an error message if invalid.
  Future<String?> testApiKey(SttProvider provider, String apiKey) async {
    try {
      // We'll use a simple models endpoint to test the key
      // For Groq: GET https://api.groq.com/openai/v1/models
      // For OpenAI: GET https://api.openai.com/v1/models
      final uri = Uri.parse('${provider.baseUrl}/v1/models');

      final response = await http
          .get(uri, headers: {'Authorization': 'Bearer $apiKey'})
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        return null; // Valid
      } else if (response.statusCode == 401) {
        return 'Invalid API key';
      } else {
        return 'HTTP ${response.statusCode}';
      }
    } on SocketException {
      return 'Network error - check your connection';
    } on TimeoutException {
      return 'Request timed out';
    } catch (e) {
      return 'Error: $e';
    }
  }
}

/// Custom timeout exception
class TimeoutException implements Exception {
  TimeoutException(this.message);
  final String message;

  @override
  String toString() => message;
}
