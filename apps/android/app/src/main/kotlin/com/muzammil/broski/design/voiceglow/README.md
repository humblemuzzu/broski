# Voice Glow

The sound-reactive glow of the composer's dictation: a colourful beam rising from the bottom edge
of a rounded view with the level of a voice. `Modifier.voiceGlow(level, active, cornerRadius)`.

A Kotlin and AGSL port of [Voice Glow](https://github.com/Jakubantalik/Libraries.dev/tree/cd89f411ff257f0dfeab66a54f888db2de3b6c8c/packages/voice-glow)
by Jakub Antalik (MIT, [LICENSE](LICENSE)), made from its SwiftUI port VoiceGlowKit
(`ports/ios/VoiceGlowKit`, the same commit) so the Android and iOS apps draw the same glow. The
level-driven path only: no microphone meter, no mood colouring, no processing motion.

| Here | VoiceGlowKit |
|---|---|
| `VoiceGlowEngine` | `VoiceGlowEngine.step` and its helpers (pure Kotlin, tested against the Swift's numbers) |
| `VoiceGlowStyle`, `VoiceGeometry`, `VoiceGlowConfig`, `VoiceColorMatrix` | `VoiceGlowStyle.swift`, `VoiceGeometry`, `VoiceGlowConfig`, `VoiceColorMatrix` |
| `VoiceGlowLayerInputs`, `VoiceGlowShaders.LAYER` | `VoiceGlowLayers.layer(...)` and `VoiceGlowShaders.metal` |
| `VoiceGlowBandPlan`, `VoiceGlowBandPainter` | `VoiceGlowBand` |
| `VoiceGlowPainter`, `VoiceGlowModifier` | `VoiceGlowLayers`, `VoiceGlow` |

Needs API 33 (AGSL `RuntimeShader`); below that the modifier does nothing, as it does if a shader
fails to compile.
