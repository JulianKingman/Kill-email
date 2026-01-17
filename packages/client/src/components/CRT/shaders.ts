export const vertexShaderSource = `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vUV;

void main() {
  vUV = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const fragmentShaderSource = `#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uTime;

// Effect parameters
uniform float uScanlineIntensity;
uniform float uScanlineCount;
uniform float uBloomIntensity;
uniform float uChromaticAberration;
uniform float uCurvature;
uniform float uVignetteIntensity;
uniform float uFlickerIntensity;
uniform float uNoiseIntensity;
uniform float uBrightness;
uniform float uContrast;
uniform vec3 uTintColor;

in vec2 vUV;
out vec4 fragColor;

// Apply barrel distortion for screen curvature
vec2 curveUV(vec2 uv, float curvature) {
  vec2 centered = uv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  vec2 curved = centered * (1.0 + curvature * r2);
  return curved * 0.5 + 0.5;
}

// Scanline effect with sub-pixel rendering
float scanline(vec2 uv, float count, float intensity) {
  float line = sin(uv.y * count * 3.14159265) * 0.5 + 0.5;
  float subPixel = sin(uv.y * count * 3.14159265 * 2.0) * 0.5 + 0.5;
  return mix(1.0, line * 0.7 + subPixel * 0.3, intensity);
}

// Phosphor RGB mask pattern
vec3 phosphorMask(vec2 uv, vec2 resolution) {
  vec2 pixelCoord = uv * resolution;
  int phase = int(mod(pixelCoord.x, 3.0));

  vec3 mask = vec3(0.6);
  if (phase == 0) mask.r = 1.0;
  else if (phase == 1) mask.g = 1.0;
  else mask.b = 1.0;

  // Add vertical phosphor pattern
  float vPhosphor = sin(pixelCoord.y * 3.14159 * 0.5) * 0.1 + 0.9;
  return mask * vPhosphor;
}

// Simple bloom using box blur
vec3 bloom(sampler2D tex, vec2 uv, float spread, vec2 resolution) {
  vec3 sum = vec3(0.0);
  float total = 0.0;

  for (float x = -2.0; x <= 2.0; x += 1.0) {
    for (float y = -2.0; y <= 2.0; y += 1.0) {
      vec2 offset = vec2(x, y) * spread / resolution;
      float weight = 1.0 - length(vec2(x, y)) / 3.5;
      if (weight > 0.0) {
        sum += texture(tex, uv + offset).rgb * weight;
        total += weight;
      }
    }
  }

  return sum / total;
}

// Chromatic aberration
vec3 chromaticAberration(sampler2D tex, vec2 uv, float amount, vec2 resolution) {
  vec2 direction = (uv - 0.5) * amount / resolution;
  float r = texture(tex, uv + direction).r;
  float g = texture(tex, uv).g;
  float b = texture(tex, uv - direction).b;
  return vec3(r, g, b);
}

// Vignette effect
float vignette(vec2 uv, float intensity) {
  vec2 centered = uv - 0.5;
  float dist = length(centered);
  return 1.0 - smoothstep(0.4, 0.8, dist) * intensity;
}

// Random noise
float random(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // Apply curvature distortion
  vec2 uv = curveUV(vUV, uCurvature);

  // Discard pixels outside screen (creates curved border)
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.02, 0.02, 0.02, 1.0);
    return;
  }

  // Sample with chromatic aberration
  vec3 color = chromaticAberration(uTexture, uv, uChromaticAberration, uResolution);

  // Add bloom/glow effect
  vec3 bloomColor = bloom(uTexture, uv, 2.0, uResolution);
  color = mix(color, bloomColor, uBloomIntensity);

  // Apply scanlines
  color *= scanline(uv, uScanlineCount, uScanlineIntensity);

  // Apply phosphor RGB mask
  color *= phosphorMask(uv, uResolution);

  // Apply vignette
  color *= vignette(uv, uVignetteIntensity);

  // Add flicker
  float flicker = 1.0 + sin(uTime * 60.0) * uFlickerIntensity;
  flicker *= 1.0 + sin(uTime * 83.0) * uFlickerIntensity * 0.5;
  color *= flicker;

  // Add noise
  float noise = random(uv + fract(uTime)) * uNoiseIntensity;
  color += noise;

  // Apply brightness and contrast
  color = (color - 0.5) * uContrast + 0.5;
  color *= uBrightness;

  // Apply color tint based on theme
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, luminance * uTintColor, 0.3);

  // Add subtle glow around bright areas
  float glowAmount = max(0.0, luminance - 0.5) * 0.3;
  color += uTintColor * glowAmount;

  fragColor = vec4(color, 1.0);
}
`;
