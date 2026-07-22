export const FIRE_P027_FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = gl_VertexID == 0 ? vec2(-1.0, -1.0)
    : (gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0));
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`

export const FIRE_P027_STATE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 oPositionAge;
layout(location = 1) out vec4 oGenerationLife;
layout(location = 2) out vec4 oVelocityOpacity;
layout(location = 3) out vec4 oControlRelay;

/* One fragment owns one particle slot. Four MRT outputs commit one atomic state. */
uniform sampler2D uOrigins;
uniform sampler2D uPreviousPositionAge;
uniform sampler2D uPreviousGenerationLife;
uniform sampler2D uPreviousVelocityOpacity;
uniform sampler2D uPreviousControlRelay;
uniform vec4 uSpawn;
uniform vec4 uTimeLife;
uniform vec4 uForceMass;
uniform vec4 uWindDrag;
uniform vec4 uTurbulence;
uniform vec4 uConfig;
uniform vec4 uGateLag;
uniform int uOriginCount;

float hash11(float value) {
  return fract(sin(value * 12.9898 + 78.233) * 43758.5453);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 quintic(vec3 value) {
  return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
}

float coherentNoise1(vec3 p, float seed) {
  vec3 cell = floor(p);
  vec3 blend = quintic(fract(p));
  vec3 offset = vec3(seed * 19.19, seed * 7.73, seed * 31.17);
  float n000 = hash31(cell + vec3(0,0,0) + offset);
  float n100 = hash31(cell + vec3(1,0,0) + offset);
  float n010 = hash31(cell + vec3(0,1,0) + offset);
  float n110 = hash31(cell + vec3(1,1,0) + offset);
  float n001 = hash31(cell + vec3(0,0,1) + offset);
  float n101 = hash31(cell + vec3(1,0,1) + offset);
  float n011 = hash31(cell + vec3(0,1,1) + offset);
  float n111 = hash31(cell + vec3(1,1,1) + offset);
  float n00 = mix(n000, n100, blend.x);
  float n10 = mix(n010, n110, blend.x);
  float n01 = mix(n001, n101, blend.x);
  float n11 = mix(n011, n111, blend.x);
  return mix(mix(n00, n10, blend.y), mix(n01, n11, blend.y), blend.z) * 2.0 - 1.0;
}

vec3 coherentVectorNoise(vec3 p, float seed) {
  return vec3(
    coherentNoise1(p, seed + 11.0),
    coherentNoise1(p + vec3(37.2, 17.1, 53.7), seed + 23.0),
    coherentNoise1(p + vec3(71.9, 41.3, 29.4), seed + 47.0));
}

int spawnOrdinal(int slot, int startSlot, int spawnCount, int slotCount) {
  if (spawnCount <= 0) return -1;
  int distance = slot - startSlot;
  if (distance < 0) distance += slotCount;
  return distance < spawnCount ? distance : -1;
}

void main() {
  int slot = int(gl_FragCoord.x);
  int slotCount = clamp(int(uTimeLife.z + 0.5), 1, 150);
  float dt = max(0.0, uTimeLife.x);
  float rawGate = clamp(uGateLag.x, 0.0, 1.0);
  vec4 previousRelay = texelFetch(uPreviousControlRelay, ivec2(slot, 0), 0);
  float lagSeconds = max(0.0, uGateLag.y);
  float lagAlpha = lagSeconds <= 1e-6 ? 1.0 : 1.0 - exp(-dt / lagSeconds);
  float laggedGate = uTimeLife.w > 0.5 ? rawGate : mix(previousRelay.g, rawGate, lagAlpha);
  vec4 nextRelay = vec4(rawGate, laggedGate, uSpawn.y, uTimeLife.w);

  vec4 nextPositionAge = vec4(0.0);
  vec4 nextGenerationLife = vec4(0.0);
  vec4 nextVelocityOpacity = vec4(0.0);
  if (slot < slotCount && uTimeLife.w <= 0.5) {
    vec4 previousPositionAge = texelFetch(uPreviousPositionAge, ivec2(slot, 0), 0);
    vec4 previousGenerationLife = texelFetch(uPreviousGenerationLife, ivec2(slot, 0), 0);
    vec4 previousVelocityOpacity = texelFetch(uPreviousVelocityOpacity, ivec2(slot, 0), 0);
    int startSlot = int(uSpawn.x + 0.5);
    int spawnCount = int(uSpawn.y + 0.5);
    int generationBase = int(uSpawn.z + 0.5);
    int ordinal = spawnOrdinal(slot, startSlot, spawnCount, slotCount);

    if (ordinal >= 0) {
      int generationInt = generationBase + ordinal;
      int originIndex = generationInt % max(1, uOriginCount);
      vec3 origin = texelFetch(uOrigins, ivec2(originIndex, 0), 0).rgb;
      float generation = float(generationInt);
      float lifetime = max(0.0001,
        uTimeLife.y + (hash11(generation + uConfig.x * 23.0) * 2.0 - 1.0) * max(0.0, uConfig.y));
      float birthAge = uConfig.w > 0.5 ? hash11(generation + uConfig.x * 61.0) * dt : 0.0;
      nextPositionAge = vec4(origin, birthAge);
      nextGenerationLife = vec4(generation, 1.0, uSpawn.w, lifetime);
      nextVelocityOpacity = vec4(0.0, 0.0, 0.0, 1.0);
    } else if (previousGenerationLife.g > 0.5) {
      float nextAge = previousPositionAge.a + dt;
      float lifetime = max(0.0001, previousGenerationLife.a);
      if (nextAge < lifetime) {
        float mass = uGateLag.z > 0.5 ? max(0.0001, uForceMass.w) : 1.0;
        float drag = uGateLag.w > 0.5 ? max(0.0, uWindDrag.w) : 0.0;
        vec3 velocity = previousVelocityOpacity.rgb;
        vec3 acceleration = uForceMass.rgb / mass;
        acceleration += (uWindDrag.rgb - velocity) / mass;
        acceleration -= drag * velocity / mass;
        float period = max(0.001, uTurbulence.w);
        acceleration += coherentVectorNoise(previousPositionAge.rgb / period, uConfig.x)
          * uTurbulence.rgb / mass;
        velocity += acceleration * dt;
        vec3 position = previousPositionAge.rgb + velocity * dt;
        float opacity = pow(0.5, max(0.0, uConfig.z) * length(velocity));
        nextPositionAge = vec4(position, nextAge);
        nextGenerationLife = previousGenerationLife;
        nextVelocityOpacity = vec4(velocity, opacity);
      }
    }
  }
  oPositionAge = nextPositionAge;
  oGenerationLife = nextGenerationLife;
  oVelocityOpacity = nextVelocityOpacity;
  oControlRelay = nextRelay;
}`

export const FIRE_P027_GENERATOR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUV;
layout(location = 0) out vec4 fragColor;
uniform vec4 uGeneratorTimePreset;
uniform vec4 uGeneratorPresetA;
uniform vec4 uGeneratorPresetB;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0,0,0));
  float n100 = hash31(i + vec3(1,0,0));
  float n010 = hash31(i + vec3(0,1,0));
  float n110 = hash31(i + vec3(1,1,0));
  float n001 = hash31(i + vec3(0,0,1));
  float n101 = hash31(i + vec3(1,0,1));
  float n011 = hash31(i + vec3(0,1,1));
  float n111 = hash31(i + vec3(1,1,1));
  float n00 = mix(n000, n100, f.x);
  float n10 = mix(n010, n110, f.x);
  float n01 = mix(n001, n101, f.x);
  float n11 = mix(n011, n111, f.x);
  return mix(mix(n00, n10, f.y), mix(n01, n11, f.y), f.z);
}

float fbm(vec3 p, float harmonics, float spread, float gain) {
  float sum = 0.0;
  float amplitude = 1.0;
  float norm = 0.0;
  for (int octave = 0; octave < 5; ++octave) {
    if (float(octave) >= harmonics) break;
    sum += amplitude * valueNoise(p);
    norm += amplitude;
    p = p * spread + vec3(17.1, 9.2, 13.7);
    amplitude *= gain;
  }
  return sum / max(norm, 1e-6);
}

void main() {
  float preset = step(0.5, fract(uGeneratorTimePreset.y));
  float period = mix(uGeneratorPresetA.x, uGeneratorPresetB.x, preset);
  float harmonics = mix(uGeneratorPresetA.y, uGeneratorPresetB.y, preset);
  float spread = mix(uGeneratorPresetA.z, uGeneratorPresetB.z, preset);
  float gain = mix(uGeneratorPresetA.w, uGeneratorPresetB.w, preset);
  float seconds = uGeneratorTimePreset.x;
  vec2 centered = vUV * 2.0 - vec2(1.0);
  centered.y += 0.12;
  vec3 flow = vec3(centered.x * period * 4.1,
    (centered.y - seconds * 0.35) * period * 3.6,
    seconds * period * 0.55 + preset * 41.0);
  float n0 = fbm(flow, harmonics, spread, gain);
  float n1 = fbm(flow * vec3(1.7, 2.1, 1.25) + vec3(23.0, -seconds, 7.0),
    min(harmonics + 1.0, 5.0), max(spread, 1.65), gain);
  vec2 warped = centered + vec2(n0 - 0.5, n1 - 0.5) * vec2(0.34, 0.22);
  float radial = 1.0 - length(warped * vec2(1.0, 0.83));
  float lift = clamp((0.9 - centered.y) * 0.42, 0.0, 0.7);
  float field = radial + (n0 - 0.5) * 0.56 + (n1 - 0.5) * 0.30 + lift * 0.18;
  float alpha = smoothstep(0.12, 0.78, field);
  alpha *= 1.0 - smoothstep(0.72, 1.08, abs(centered.x));
  alpha *= 1.0 - smoothstep(0.86, 1.16, abs(centered.y));
  float perforation = smoothstep(0.08, 0.38, abs(n1 - n0) + length(warped) * 0.28);
  alpha *= mix(0.28, 1.0, perforation);
  alpha = pow(alpha, 1.7) * 0.45;
  if (alpha < 0.004) alpha = 0.0;
  float body = pow(clamp(field * 1.55, 0.0, 1.0), 1.2);
  vec3 color = vec3(body, body * (0.22 + 0.55 * n0), 0.0);
  color *= alpha * 2.1;
  fragColor = vec4(color, alpha);
}`

export const FIRE_P027_RASTER_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 aCorner;
uniform sampler2D uPositionAge;
uniform sampler2D uGenerationLife;
uniform sampler2D uVelocityOpacity;
uniform sampler2D uControlRelay;
uniform vec4 uSizeOrthoSlots;
uniform vec4 uOutputLayers;
out vec2 vLocal;
out float vOpacity;
flat out int vLayer;
flat out float vAlive;

void main() {
  int slot = gl_InstanceID;
  vec4 generationLife = texelFetch(uGenerationLife, ivec2(slot, 0), 0);
  vAlive = generationLife.g;
  vLocal = aCorner;
  if (vAlive <= 0.5 || slot >= int(uSizeOrthoSlots.w + 0.5)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vOpacity = 0.0;
    vLayer = 0;
    return;
  }
  vec4 positionAge = texelFetch(uPositionAge, ivec2(slot, 0), 0);
  vec4 velocityOpacity = texelFetch(uVelocityOpacity, ivec2(slot, 0), 0);
  float sizeGate = clamp(texelFetch(uControlRelay, ivec2(0, 0), 0).g, 0.0, 1.0);
  vec2 spriteSize = max(uSizeOrthoSlots.xy * sizeGate, vec2(1e-6));
  vec2 world = positionAge.xy + (aCorner - vec2(0.5)) * spriteSize;
  vec2 outputSize = max(uOutputLayers.xy, vec2(1.0));
  float aspect = outputSize.x / outputSize.y;
  float ortho = max(uSizeOrthoSlots.z, 1e-6);
  gl_Position = vec4(world.x * 2.0 / ortho, world.y * 2.0 * aspect / ortho, 0.0, 1.0);
  float phase = float(slot) / float(max(int(uSizeOrthoSlots.w + 0.5) - 1, 1)) * 60.0;
  float lifePhase = generationLife.a > 0.0 ? positionAge.a / generationLife.a * 60.0 : 0.0;
  vLayer = clamp(int(floor(phase + lifePhase + 0.5)), 0, max(int(uOutputLayers.z + 0.5) - 1, 0));
  vOpacity = clamp(velocityOpacity.a, 0.0, 1.0);
}`

export const FIRE_P027_RASTER_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vLocal;
in float vOpacity;
flat in int vLayer;
flat in float vAlive;
uniform sampler2DArray uFireLayers;
uniform vec4 uTint;
layout(location = 0) out vec4 fragColor;
void main() {
  if (vAlive <= 0.5) discard;
  vec4 sprite = texture(uFireLayers, vec3(vLocal.x, 1.0 - vLocal.y, float(vLayer)));
  vec4 sourceColor = sprite * uTint;
  sourceColor.rgb *= sourceColor.a * vOpacity;
  sourceColor.a *= vOpacity;
  fragColor = sourceColor * (1.0 - sourceColor.a);
}`

export const FIRE_P027_DISPLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uAccumulatedFire;
layout(location = 0) out vec4 fragColor;
void main() {
  vec4 color = texture(uAccumulatedFire, vUV);
  color.a = clamp(color.a, 0.0, 1.0);
  fragColor = color;
}`
