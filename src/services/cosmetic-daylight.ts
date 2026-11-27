import { Color, DoubleSide, LinearSRGBColorSpace, ShaderMaterial, type Texture } from "three";

// Vanilla Overworld entity lighting, with a neutral full daylight lightmap.
// Minecraft multiplies encoded texture and vertex-color channels before applying light.
export function cosmeticDaylightMaterial(texture: Texture, tint = "#ffffff") {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: { atlas: { value: texture }, tint: { value: new Color().setHex(parseInt(tint.slice(1), 16), LinearSRGBColorSpace) } },
    vertexShader: `
      varying vec2 atlasUv;
      varying vec3 worldNormal;
      void main() {
        atlasUv = uv;
        worldNormal = normalize(normalMatrix * normal) * mat3(viewMatrix);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D atlas;
      uniform vec3 tint;
      varying vec2 atlasUv;
      varying vec3 worldNormal;
      void main() {
        vec4 texel = texture2D(atlas, atlasUv);
        if (texel.a < 0.1) discard;
        vec3 n = normalize(gl_FrontFacing ? worldNormal : -worldNormal);
        float first = max(0.0, dot(n, normalize(vec3(0.2, 1.0, -0.7))));
        float second = max(0.0, dot(n, normalize(vec3(-0.2, 1.0, 0.7))));
        float light = min(1.0, 0.4 + 0.6 * (first + second));
        gl_FragColor = vec4(texel.rgb * tint * light, texel.a);
      }`,
  });
}
