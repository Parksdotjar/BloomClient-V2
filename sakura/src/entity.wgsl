struct Camera { view_projection: mat4x4<f32>, eye: vec4<f32>, origin: vec4<i32>, viewport: vec4<f32>, glint: vec4<f32>, fog: vec4<f32>, fog_range: vec4<f32>, lightmap: array<vec4<f32>,256> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var textures: texture_2d_array<f32>;
@group(1) @binding(1) var tex_sampler: sampler;
struct Input {
    @location(0) position: vec3<f32>, @location(1) uv: vec2<f32>, @location(2) shade: f32,
    @location(3) m0: vec4<f32>, @location(4) m1: vec4<f32>, @location(5) m2: vec4<f32>, @location(6) m3: vec4<f32>,
    @location(7) tint: vec4<f32>, @location(8) layer: u32,
};
struct Output {
    @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>,
    @location(1) tint: vec4<f32>, @location(2) @interpolate(flat) layer: u32, @location(3) distance: f32,
};
@vertex fn vs_main(input: Input) -> Output {
    var out: Output;
    let position = mat4x4<f32>(input.m0,input.m1,input.m2,input.m3) * vec4<f32>(input.position,1.0);
    out.position = camera.view_projection * position;
    out.uv = input.uv; out.tint = vec4<f32>(input.tint.rgb * input.shade,input.tint.a); out.layer = input.layer;
    out.distance = length(position.xyz - camera.eye.xyz);
    return out;
}
fn encoded(c:vec3<f32>)->vec3<f32> {return select(1.055*pow(max(c,vec3<f32>(0.0)),vec3<f32>(1.0/2.4))-0.055,c*12.92,c<=vec3<f32>(0.0031308));}
fn linear(c:vec3<f32>)->vec3<f32> {return select(pow(max((c+0.055)/1.055,vec3<f32>(0.0)),vec3<f32>(2.4)),c/12.92,c<=vec3<f32>(0.04045));}
fn color(input: Output) -> vec4<f32> {
    let sample = textureSampleLevel(textures,tex_sampler,input.uv,i32(input.layer),0.0);
    let texel=vec4<f32>(encoded(sample.rgb)*input.tint.rgb,sample.a*input.tint.a);
    let fog = clamp((input.distance-camera.fog_range.x)/(camera.fog_range.y-camera.fog_range.x),0.0,1.0);
    return vec4<f32>(linear(mix(texel.rgb,camera.fog.rgb,fog)),texel.a);
}
@fragment fn fs_main(input: Output) -> @location(0) vec4<f32> { let c = color(input); if c.a < 0.5 {discard;} return vec4<f32>(c.rgb,1.0); }
@fragment fn fs_blend(input: Output) -> @location(0) vec4<f32> { let c = color(input); if c.a < 0.01 {discard;} return c; }
