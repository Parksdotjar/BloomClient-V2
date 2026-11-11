// Equivalent sampling to the pinned Java 26.1 post/box_blur shader.
// Three horizontal/vertical pairs implement post_effect/blur.json.
// Source and destination are UNORM views of display-encoded color. No SRGB
// decode/encode belongs inside this post-process; world shading keeps its SRGB
// attachment view separately, before GUI composition and the blur chain.
struct BlurConfig {
    direction: vec2<f32>,
    radius: f32,
    _padding: f32,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var<uniform> config: BlurConfig;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    var result: VertexOutput;
    result.position = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    result.uv = uv;
    return result;
}
@fragment fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let step = config.direction / vec2<f32>(textureDimensions(source));
    var blurred = vec4<f32>(0.0);
    // A linear sample between texels replaces two unit-weight pixel samples.
    for (var offset = -config.radius + 0.5; offset <= config.radius; offset += 2.0) {
        blurred += textureSample(source, linear_sampler, input.uv + step * offset);
    }
    blurred += textureSample(source, linear_sampler, input.uv + step * config.radius) * 0.5;
    return blurred / (config.radius + 0.5);
}
