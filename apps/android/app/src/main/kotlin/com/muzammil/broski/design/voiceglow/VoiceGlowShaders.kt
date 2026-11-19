package com.muzammil.broski.design.voiceglow

/**
 * The glow's AGSL, ported from VoiceGlowKit's `VoiceGlowShaders.metal`. Coordinates are dp: the
 * painter draws under a density scale, so `coord` is already in the units the uniforms use.
 */
internal object VoiceGlowShaders {
    /**
     * One layer of the web glow: a stack of CSS radial-gradient lobes composited source-over (first
     * lobe on top), optionally the highlight above them, masked by the ellipse the glow rises in and
     * cut to the layer's geometry. Output is premultiplied.
     *
     * CSS semantics mirrored: an explicit-size radial gradient's two lengths are the ellipse radii;
     * `color 0%, transparent F%` keeps the colour and falls the alpha linearly to 0 at F% of the
     * radius. The lobe colours arrive already through the hue / brightness / saturate chain.
     *
     * `params[0]` is the kind: 0 the 1 dp edge ring, 1 the inner light (rounded rect, corner fades,
     * inset shadow), 2 the bloom's gradients (blurred and masked by the painter, as CSS blurs before
     * it masks), 3 the mask alone.
     */
    const val LAYER = """
uniform float2 size;
uniform float lobes[56];
uniform float highlight[11];
uniform float mask[6];
uniform float params[14];

float roundedRectSDF(float2 p, float2 halfSize, float radius) {
    float2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float4 srcOver(float4 src, float4 dst) {
    return src + dst * (1.0 - src.a);
}

float maskAlpha(float d, float mid, float tail) {
    if (d >= 1.0) return 0.0;
    if (d <= mid) return mix(1.0, 0.5, d / max(mid, 0.0001));
    if (tail < 0.0) return mix(0.5, 0.0, (d - mid) / max(1.0 - mid, 0.0001));
    if (d <= 0.85) return mix(0.5, tail, (d - mid) / max(0.85 - mid, 0.0001));
    return mix(tail, 0.0, (d - 0.85) / 0.15);
}

float ellipseDistance(float2 p, float2 c, float2 r) {
    if (r.x <= 0.0 || r.y <= 0.0) return 1000000.0;
    return length((p - c) / r);
}

half4 main(float2 position) {
    int kind = int(params[0]);
    float radius = params[1];
    float borderWidth = params[2];
    float fadeStop = params[3];
    float cornerFade = params[4];
    float insetBlur = params[5];
    float4 shadow = float4(params[6], params[7], params[8], params[9]);
    float opacity = params[10];
    int lobeCount = int(params[11]);

    float2 center = size * 0.5;
    float2 rel = position - center;

    float m = 1.0;
    if (params[13] > 0.5) {
        float d = ellipseDistance(position, float2(mask[0], mask[1]), float2(mask[2], mask[3]));
        m = maskAlpha(d, mask[4], mask[5]);
    }
    if (kind == 3) {
        return half4(m);
    }

    float outerSDF = roundedRectSDF(rel, center, radius);
    float outerCov = 1.0 - smoothstep(-0.5, 0.5, outerSDF);
    float geom = 1.0;
    if (kind == 0) {
        float innerR = max(radius - borderWidth, 0.0);
        float innerSDF = roundedRectSDF(rel, center - borderWidth, innerR);
        float innerCov = 1.0 - smoothstep(-0.5, 0.5, innerSDF);
        geom = max(outerCov - innerCov, 0.0);
    } else if (kind == 1) {
        float y = position.y;
        float x = position.x;
        float v = max(max(0.0, 1.0 - y / cornerFade), max(0.0, 1.0 - (size.y - y) / cornerFade));
        float h = max(max(0.0, 1.0 - x / cornerFade), max(0.0, 1.0 - (size.x - x) / cornerFade));
        geom = outerCov * (v + h * (1.0 - v));
    }
    if (geom * m <= 0.0) return half4(0.0);

    float4 col = float4(0.0);
    for (int i = 0; i < 7; i++) {
        float d = ellipseDistance(position, float2(lobes[i * 8], lobes[i * 8 + 1]), float2(lobes[i * 8 + 2], lobes[i * 8 + 3]));
        float a = lobes[i * 8 + 7] * max(0.0, 1.0 - d / fadeStop);
        if (i >= lobeCount) a = 0.0;
        col = srcOver(col, float4(lobes[i * 8 + 4], lobes[i * 8 + 5], lobes[i * 8 + 6], 1.0) * a);
    }

    if (params[12] > 0.5) {
        float d = ellipseDistance(position, float2(highlight[0], highlight[1]), float2(highlight[2], highlight[3]));
        float a0 = highlight[7];
        float p1 = highlight[8];
        float a1 = highlight[9];
        float p2 = highlight[10];
        float a = 0.0;
        if (d <= p1) {
            a = mix(a0, a1, d / max(p1, 0.0001));
        } else if (d < p2) {
            a = mix(a1, 0.0, (d - p1) / max(p2 - p1, 0.0001));
        }
        col = srcOver(float4(highlight[4], highlight[5], highlight[6], 1.0) * a, col);
    }

    if (kind == 1 && shadow.a > 0.0) {
        float e = -outerSDF;
        float s = shadow.a * (1.0 - smoothstep(1.0 - insetBlur, 1.0 + insetBlur, e));
        col = srcOver(float4(shadow.rgb, 1.0) * s, col);
    }

    return half4(col * (geom * m * opacity));
}
"""

    /**
     * A stroke's colour: [tint] (straight alpha) across [span] (the x of the band's two ends), faded
     * in and out over the first and last [fadeStop] of it, as the band's gradient stops do.
     */
    const val STROKE = """
uniform float2 span;
uniform float fadeStop;
uniform float4 tint;

half4 main(float2 coord) {
    float t = (coord.x - span.x) / max(span.y - span.x, 1.0);
    float a = clamp(min(t, 1.0 - t) / fadeStop, 0.0, 1.0) * tint.a;
    return half4(float4(tint.rgb * a, a));
}
"""

    /**
     * The light theme's white wash: alpha 1 to [stops].x, down to `midAlpha` at .y and 0 at .z, in
     * the ellipse's own units (centre and radii in [ellipse]); white, premultiplied.
     */
    const val WASH = """
uniform float4 ellipse;
uniform float3 stops;
uniform float midAlpha;

half4 main(float2 coord) {
    float d = length((coord - ellipse.xy) / ellipse.zw);
    float a = 0.0;
    if (d <= stops.x) {
        a = 1.0;
    } else if (d <= stops.y) {
        a = mix(1.0, midAlpha, (d - stops.x) / max(stops.y - stops.x, 0.0001));
    } else if (d < stops.z) {
        a = mix(midAlpha, 0.0, (d - stops.y) / max(stops.z - stops.y, 0.0001));
    }
    return half4(a);
}
"""
}
