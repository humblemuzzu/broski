import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../models/stt_settings.dart';

/// Service for Speech-to-Text transcription using Groq or OpenAI APIs.
///
/// Both providers use OpenAI-compatible API format:
/// POST {baseUrl}/v1/audio/transcriptions
/// - multipart/form-data with 'file' and 'model' fields
/// - Authorization: Bearer {apiKey}
class SttService {
  SttService();

  /// Transcribe an audio file to text.
  ///
  /// [audioFile] - The audio file to transcribe (mp3, m4a, wav, etc.)
  /// [settings] - STT settings including provider, model, and API key
  ///
  /// Returns [TranscriptionResult] with transcribed text or error.
  Future<TranscriptionResult> transcribe(
    File audioFile,
    SttSettings settings,
  ) async {
    print('[STT Service] === Starting Transcription ===');
    print('[STT Service] Provider: ${settings.provider.displayName}');
    print('[STT Service] Model: ${settings.modelId}');
    print('[STT Service] File path: ${audioFile.path}');

    // Validate configuration
    if (!settings.isConfigured) {
      print('[STT Service] ERROR: API key not configured');
      return TranscriptionResult.failure(
        'API key not configured for ${settings.provider.displayName}',
      );
    }

    print(
      '[STT Service] API key present: ${settings.currentApiKey != null}',
    );
    print(
      '[STT Service] API key length: ${settings.currentApiKey?.length ?? 0}',
    );

    if (!await audioFile.exists()) {
      print('[STT Service] ERROR: Audio file not found');
      return TranscriptionResult.failure('Audio file not found');
    }

    final fileSize = await audioFile.length();
    print(
      '[STT Service] File size: $fileSize bytes (${(fileSize / 1024).toStringAsFixed(1)} KB)',
    );

    if (fileSize < 100) {
      print('[STT Service] ERROR: Audio file too small (likely empty)');
      return TranscriptionResult.failure('Audio file is empty or too small');
    }

    if (fileSize > 25 * 1024 * 1024) {
      print('[STT Service] ERROR: Audio file too large');
      return TranscriptionResult.failure('Audio file too large (max 25MB)');
    }

    try {
      final uri = Uri.parse(
        '${settings.provider.baseUrl}/v1/audio/transcriptions',
      );
      print('[STT Service] Request URL: $uri');

      final request = http.MultipartRequest('POST', uri);

      // Set authorization header
      request.headers['Authorization'] = 'Bearer ${settings.currentApiKey}';

      // Add the audio file
      final multipartFile = await http.MultipartFile.fromPath(
        'file',
        audioFile.path,
      );
      print(
        '[STT Service] Multipart file: ${multipartFile.filename}, ${multipartFile.length} bytes',
      );
      request.files.add(multipartFile);

      // Add model
      request.fields['model'] = settings.modelId;

      // Add optional parameters
      request.fields['response_format'] = 'json';

      if (settings.languageHint != null && settings.languageHint!.isNotEmpty) {
        request.fields['language'] = settings.languageHint!;
        print('[STT Service] Language hint: ${settings.languageHint}');
      }

      if (settings.prompt != null && settings.prompt!.isNotEmpty) {
        request.fields['prompt'] = settings.prompt!;
      }

      print('[STT Service] Sending request...');
      final stopwatch = Stopwatch()..start();

      // Send request
      final streamedResponse = await request.send().timeout(
        const Duration(seconds: 60),
        onTimeout: () {
          print('[STT Service] ERROR: Request timed out');
          throw TimeoutException('Transcription request timed out');
        },
      );

      final response = await http.Response.fromStream(streamedResponse);
      stopwatch.stop();

      print(
        '[STT Service] Response received in ${stopwatch.elapsedMilliseconds}ms',
      );
      print('[STT Service] Status code: ${response.statusCode}');
      print(
        '[STT Service] Response body (first 500 chars): ${response.body.length > 500 ? response.body.substring(0, 500) : response.body}',
      );

      if (response.statusCode == 200) {
        final json = jsonDecode(response.body) as Map<String, dynamic>;
        final text = json['text'] as String? ?? '';
        final duration = json['duration'] as num?;
        final language = json['language'] as String?;

        print('[STT Service] SUCCESS!');
        print('[STT Service] Transcribed text: "$text"');
        print('[STT Service] Duration: ${duration}s');
        print('[STT Service] Language: $language');

        return TranscriptionResult.success(
          text.trim(),
          durationSeconds: duration?.toDouble(),
          language: language,
        );
      } else {
        // Parse error response
        String errorMessage;
        try {
          final errorJson = jsonDecode(response.body) as Map<String, dynamic>;
          final error = errorJson['error'];
          if (error is Map<String, dynamic>) {
            errorMessage = error['message'] as String? ?? 'Unknown error';
          } else if (error is String) {
            errorMessage = error;
          } else {
            errorMessage = 'HTTP ${response.statusCode}';
          }
        } catch (_) {
          errorMessage =
              'HTTP ${response.statusCode}: ${response.reasonPhrase}';
        }

        // Handle specific error codes
        if (response.statusCode == 401) {
          errorMessage = 'Invalid API key';
        } else if (response.statusCode == 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment.';
        } else if (response.statusCode == 413) {
          errorMessage = 'Audio file too large';
        }

        print('[STT Service] ERROR: $errorMessage');
        return TranscriptionResult.failure(errorMessage);
      }
    } on SocketException catch (e) {
      print('[STT Service] SocketException: ${e.message}');
      return TranscriptionResult.failure('Network error: ${e.message}');
    } on TimeoutException {
      print('[STT Service] TimeoutException');
      return TranscriptionResult.failure('Request timed out');
    } on FormatException catch (e) {
      print('[STT Service] FormatException: ${e.message}');
      return TranscriptionResult.failure('Invalid response: ${e.message}');
    } catch (e, stackTrace) {
      print('[STT Service] Unknown error: $e');
      print('[STT Service] Stack trace: $stackTrace');
      return TranscriptionResult.failure('Transcription failed: $e');
    }
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
