struct Camera { view_projection: mat4x4<f32>, eye: vec4<f32>, origin: vec4<i32>, viewport: vec4<f32>, glint: vec4<f32>, fog: vec4<f32>, fog_range: vec4<f32>, lightmap: array<vec4<f32>,256> };
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var textures:texture_2d_array<f32>;
@group(1) @binding(1) var tex_sampler:sampler;
struct Output { @builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) opacity:f32,@location(2) @interpolate(flat) layer:i32,@location(3) distance:f32 };
@vertex fn vs_main(@location(0) position:vec3<f32>,@location(1) uv:vec2<f32>,@location(2) packed:f32)->Output {
    var out:Output;out.position=camera.view_projection*vec4<f32>(position,1.);out.uv=uv;
    out.distance=length(position-camera.eye.xyz);out.layer=i32(floor(packed/2.));out.opacity=packed-f32(out.layer)*2.;return out;
}
@fragment fn fs_main(input:Output)->@location(0) vec4<f32> {
    if any(input.uv<vec2<f32>(0.))||any(input.uv>vec2<f32>(1.)){discard;}
    let alpha=textureSampleLevel(textures,tex_sampler,input.uv,input.layer,0.).a;
    return vec4<f32>(0.,0.,0.,alpha*input.opacity*(1.-clamp((input.distance-camera.fog_range.x)/(camera.fog_range.y-camera.fog_range.x),0.,1.)));
}
