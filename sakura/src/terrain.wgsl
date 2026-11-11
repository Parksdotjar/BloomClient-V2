struct Camera {
    view_projection: mat4x4<f32>,
    eye: vec4<f32>,
    origin: vec4<i32>,
    viewport: vec4<f32>,
    glint: vec4<f32>,
    fog: vec4<f32>, fog_range: vec4<f32>,
    lightmap: array<vec4<f32>,256>,
};
struct Section { origin: vec4<i32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var textures: texture_2d_array<f32>;
@group(1) @binding(1) var tex_sampler: sampler;
@group(2) @binding(0) var<uniform> section: Section;
struct WorldInput {
    @location(0) position: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) layer: u32,
    @location(3) color: vec3<f32>,
    @location(4) light: vec2<f32>,
};
struct WorldOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) layer: u32,
    @location(2) color: vec3<f32>,
    @location(3) distance: f32,
};
fn light_color(level:vec2<f32>) -> vec3<f32> {
    if level.x < 0.0 {return vec3<f32>(1.0);}
    let p=clamp(level,vec2<f32>(0.0),vec2<f32>(15.0));let lo=vec2<u32>(floor(p));let hi=min(lo+vec2<u32>(1u),vec2<u32>(15u));let f=fract(p);
    return mix(mix(camera.lightmap[lo.x+lo.y*16u].rgb,camera.lightmap[hi.x+lo.y*16u].rgb,f.x),mix(camera.lightmap[lo.x+hi.y*16u].rgb,camera.lightmap[hi.x+hi.y*16u].rgb,f.x),f.y);
}
@vertex fn vs_main(input: WorldInput) -> WorldOutput {
    var output: WorldOutput;
    let relative = vec3<f32>(section.origin.xyz - camera.origin.xyz) + input.position;
    output.position = camera.view_projection * vec4<f32>(relative, 1.0);
    output.uv = input.uv; output.layer = input.layer; output.color = input.color * light_color(input.light);
    if camera.viewport.w==2.0 && input.light.x>=0.0 {output.color=vec3<f32>(input.light.x/15.0);}
    if camera.viewport.w==3.0 && input.light.x>=0.0 {output.color=vec3<f32>(input.light.y/15.0);}
    output.distance = length(relative - camera.eye.xyz);
    return output;
}
fn encoded(c:vec3<f32>)->vec3<f32> {return select(1.055*pow(max(c,vec3<f32>(0.0)),vec3<f32>(1.0/2.4))-0.055,c*12.92,c<=vec3<f32>(0.0031308));}
fn linear(c:vec3<f32>)->vec3<f32> {return select(pow(max((c+0.055)/1.055,vec3<f32>(0.0)),vec3<f32>(2.4)),c/12.92,c<=vec3<f32>(0.04045));}
fn world_color(input: WorldOutput) -> vec4<f32> {
    var texel = vec4<f32>(1.0);
    if input.layer != 0xffffffffu {
        texel = textureSampleLevel(textures, tex_sampler, input.uv, i32(input.layer), 0.0);
    }
    let fog = clamp((input.distance-camera.fog_range.x)/(camera.fog_range.y-camera.fog_range.x),0.0,1.0);
    return vec4<f32>(linear(mix(encoded(texel.rgb) * input.color, camera.fog.rgb, fog)), texel.a);
}
@fragment fn fs_main(input: WorldOutput) -> @location(0) vec4<f32> {
    let color = world_color(input);
    if color.a < 0.5 { discard; }
    return vec4<f32>(color.rgb, 1.0);
}
@fragment fn fs_translucent(input: WorldOutput) -> @location(0) vec4<f32> {
    let color = world_color(input);
    if color.a < 0.01 { discard; }
    return color;
}
struct HudInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) layer: u32,
    @location(3) color: vec4<f32>,
};
struct HudOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) layer: u32,
    @location(2) color: vec4<f32>,
};
@vertex fn vs_hud(input: HudInput) -> HudOutput {
    var output: HudOutput;
    output.position = vec4<f32>(input.position.x / camera.viewport.x * 2.0 - 1.0,
        1.0 - input.position.y / camera.viewport.y * 2.0, 0.0, 1.0);
    output.uv = input.uv; output.layer = input.layer; output.color = input.color;
    return output;
}
@fragment fn fs_hud(input: HudOutput) -> @location(0) vec4<f32> {
    if input.layer == 0xffffffffu { return input.color; }
    return textureSampleLevel(textures, tex_sampler, input.uv, i32(input.layer), 0.0) * input.color;
}

@fragment fn fs_lightning(input: WorldOutput) -> @location(0) vec4<f32> {
    let fade=1.-clamp((input.distance-camera.fog_range.x)/(camera.fog_range.y-camera.fog_range.x),0.,1.);
    return vec4<f32>(linear(input.color),0.3*fade);
}
