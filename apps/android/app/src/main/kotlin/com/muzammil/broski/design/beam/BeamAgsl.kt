package com.muzammil.broski.design.beam

/** Sizes of the shader's uniform arrays; the shader reads as many entries as the counts say. */
internal object BeamLimits {
    const val BLOBS = 12
    const val STOPS = 16
}

/** The uniforms the beam shader declares, as the painter sets them. */
internal object BeamUniform {
    const val SIZE = "size"
    const val DENSITY = "density"
    const val ANGLE = "beamAngle"
    const val CORNER_RADIUS = "cornerRadius"
    const val BORDER_WIDTH = "borderWidth"
    const val KIND = "layerKind"
    const val EDGE_MASK = "edgeMaskPx"
    const val BLOBS = "blobs"
    const val BLOB_COUNT = "blobCount"
    const val BG = "bg"
    const val BG_COUNT = "bgCount"
    const val BG_IS_BLACK = "bgIsBlack"
    const val MASK = "maskStops"
    const val MASK_COUNT = "maskCount"
    const val MATRIX = "cm"
    const val OPACITY = "opacity"
    const val SHADOW_COLOR = "shadowColor"
    const val SHADOW_BLUR = "shadowBlur"
}

/**
 * AGSL port of BorderBeamKit's `beamRotateLayer` Metal shader (border-beam, MIT): one layer of the rotate
 * beam, which the painter instantiates three times with `layerKind` 0 (stroke ring), 1 (inner glow) and
 * 2 (bloom ring, blurred by the caller).
 *
 * It reproduces the web library's layers: radial-gradient ellipse blobs composited source-over, first
 * on top; a conic gradient over them; a conic beam window and the rounded-rect border ring as masks; then
 * the CSS filter chain as a 3x3 matrix. Geometry is in dp (`density` turns pixels into them), as the
 * Metal shader's is in points. Arrays are walked by loop index with constant bounds, and stops are
 * looked up without an early return, which keeps it inside what AGSL accepts.
 */
internal val BeamAgslSource: String = """
const float PI = 3.14159265358979;

uniform float2 size;
uniform float density;
uniform float beamAngle;
uniform float cornerRadius;
uniform float borderWidth;
uniform float layerKind;
uniform float edgeMaskPx;
uniform float blobs[${BeamLimits.BLOBS * BLOB_FLOATS}];
uniform int blobCount;
uniform float bg[${BeamLimits.STOPS * 2}];
uniform int bgCount;
uniform float bgIsBlack;
uniform float maskStops[${BeamLimits.STOPS * 2}];
uniform int maskCount;
uniform float cm[9];
uniform float opacity;
uniform float4 shadowColor;
uniform float shadowBlur;

float roundedRectSDF(float2 p, float2 halfSize, float radius) {
    float2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float conicFraction(float2 p, float2 center) {
    float2 d = p - center;
    float theta = atan(d.x, -d.y);
    return fract(theta / (2.0 * PI) + 1.0);
}

float4 srcOver(float4 src, float4 dst) {
    return src + dst * (1.0 - src.a);
}

float beamWindowAlpha(float t) {
    float result = maskStops[1];
    bool found = t <= maskStops[0];
    for (int i = 1; i < ${BeamLimits.STOPS}; i++) {
        if (!found && i < maskCount) {
            float p0 = maskStops[2 * (i - 1)];
            float a0 = maskStops[2 * (i - 1) + 1];
            float p1 = maskStops[2 * i];
            float a1 = maskStops[2 * i + 1];
            result = a1;
            if (t <= p1) {
                float f = p1 > p0 ? (t - p0) / (p1 - p0) : 0.0;
                result = mix(a0, a1, f);
                found = true;
            }
        }
    }
    return result;
}

float conicAlpha(float t) {
    float result = bg[1];
    bool found = t <= bg[0];
    for (int i = 1; i < ${BeamLimits.STOPS}; i++) {
        if (!found && i < bgCount) {
            float p0 = bg[2 * (i - 1)];
            float a0 = bg[2 * (i - 1) + 1];
            float p1 = bg[2 * i];
            float a1 = bg[2 * i + 1];
            result = a1;
            if (t <= p1) {
                float f = p1 > p0 ? (t - p0) / (p1 - p0) : 0.0;
                result = mix(a0, a1, f);
                found = true;
            }
        }
    }
    return result;
}

half4 main(float2 fragCoord) {
    float2 position = fragCoord / density;
    float2 center = size * 0.5;
    float2 rel = position - center;
    int kind = int(layerKind);

    // Geometry: the full rounded rect for the inner glow, the border band for stroke and bloom.
    float outerSDF = roundedRectSDF(rel, center, cornerRadius);
    float geom = 1.0 - smoothstep(-1.0, 0.0, outerSDF);
    if (kind != 1) {
        float innerRadius = max(cornerRadius - borderWidth, 0.0);
        float innerSDF = roundedRectSDF(rel, center - borderWidth, innerRadius);
        geom = geom - (1.0 - smoothstep(-1.0, 0.0, innerSDF));
    }
    if (geom <= 0.0) return half4(0.0);

    float mask = 1.0;
    if (maskCount > 0) {
        mask = beamWindowAlpha(fract(conicFraction(position, center) - beamAngle));
    }

    // Inner glow edge fade: solid at the edges, transparent edgeMaskPx inward, vertical and horizontal united.
    if (kind == 1 && edgeMaskPx > 0.0) {
        float ev = max(1.0 - position.y / edgeMaskPx, 1.0 - (size.y - position.y) / edgeMaskPx);
        float eh = max(1.0 - position.x / edgeMaskPx, 1.0 - (size.x - position.x) / edgeMaskPx);
        mask *= clamp(max(ev, 0.0) + max(eh, 0.0), 0.0, 1.0);
    }
    if (mask <= 0.001) return half4(0.0);

    // Blobs, first on top: compositing each new one underneath equals source-over from last to first.
    float4 acc = float4(0.0);
    for (int i = 0; i < ${BeamLimits.BLOBS}; i++) {
        if (i < blobCount) {
            float2 radii = float2(max(blobs[8 * i], 0.001), max(blobs[8 * i + 1], 0.001));
            float2 c = float2(blobs[8 * i + 2], blobs[8 * i + 3]) * size;
            float d = length((position - c) / radii);
            float alpha = blobs[8 * i + 7] * clamp(1.0 - d, 0.0, 1.0);
            float4 src = float4(float3(blobs[8 * i + 4], blobs[8 * i + 5], blobs[8 * i + 6]) * alpha, alpha);
            acc = acc + src * (1.0 - acc.a);
        }
    }

    // The conic gradient on top: the white beam highlight, or the bloom ring pattern.
    if (bgCount > 0) {
        float a = conicAlpha(fract(conicFraction(position, center) - beamAngle));
        float3 rgb = bgIsBlack > 0.5 ? float3(0.0) : float3(1.0);
        acc = srcOver(float4(rgb * a, a), acc);
    }

    // Inset shadow `inset 0 0 <blur> 1px <color>`: strongest at the border, fading shadowBlur inward.
    if (kind == 1 && shadowColor.a > 0.0 && shadowBlur > 0.0) {
        float fall = clamp(1.0 - (-outerSDF) / (shadowBlur + 1.0), 0.0, 1.0);
        float a = shadowColor.a * fall * fall;
        acc = srcOver(float4(shadowColor.rgb * a, a), acc);
    }

    // The CSS filter chain as a 3x3 matrix on unpremultiplied RGB.
    if (acc.a > 0.0001) {
        float3 rgb = acc.rgb / acc.a;
        float3 filtered = float3(
            dot(float3(cm[0], cm[1], cm[2]), rgb),
            dot(float3(cm[3], cm[4], cm[5]), rgb),
            dot(float3(cm[6], cm[7], cm[8]), rgb)
        );
        float finalA = acc.a * geom * mask * clamp(opacity, 0.0, 1.0);
        return half4(float4(clamp(filtered, 0.0, 1.0) * finalA, finalA));
    }
    return half4(0.0);
}
"""
