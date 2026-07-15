export const FLUID_FIRE_RELAY_VERTEX_SHADER = `
attribute vec2 position;
varying vec2 projectionUv;

void main() {
  projectionUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

export const FLUID_FIRE_RELAY_FIELD_SHADER = `
precision highp float;
varying vec2 projectionUv;
uniform sampler2D densityField;
uniform sampler2D temperatureField;
uniform float relayMix;

void main() {
  float density = texture2D(densityField, projectionUv).r;
  float temperature = texture2D(temperatureField, projectionUv).r;
  float relay = mix(density, temperature, relayMix);
  gl_FragColor = vec4(relay, relay * relay, temperature, relay);
}
`

export const FLUID_FIRE_RELAY_BLOOM_SHADER = `
precision highp float;
varying vec2 projectionUv;
uniform sampler2D relayField;
uniform float bloomGain;

void main() {
  vec4 relay = texture2D(relayField, projectionUv);
  gl_FragColor = vec4(relay.rgb * bloomGain, relay.a);
}
`
