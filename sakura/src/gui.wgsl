struct Camera {view_projection:mat4x4<f32>,eye:vec4<f32>,origin:vec4<i32>,viewport:vec4<f32>,glint:vec4<f32>};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var atlas:texture_2d_array<f32>;
@group(1) @binding(1) var nearest:sampler;
struct Input {@location(0) position:vec2<f32>,@location(1) uv:vec2<f32>,@location(2) flags:u32,@location(3) color:vec4<f32>};
struct Output {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) @interpolate(flat) flags:u32,@location(2) color:vec4<f32>};
@vertex fn vs_hud(input:Input)->Output{var out:Output;out.position=vec4<f32>(input.position.x/camera.viewport.x*2.0-1.0,1.0-input.position.y/camera.viewport.y*2.0,0.0,1.0);out.uv=input.uv;out.flags=input.flags;out.color=input.color;return out;}
@fragment fn fs_hud(input:Output)->@location(0) vec4<f32>{
    if input.flags==0xffffffffu{return input.color;}
    var base=textureSampleLevel(atlas,nearest,input.uv,0,0.0)*input.color;
    if base.a<0.01{discard;}
    if input.flags==1u && camera.glint.z>0.0 {
        let time=camera.viewport.z;
        let p=input.position.xy/64.0;
        let rotated=vec2<f32>(p.x*0.985-p.y*0.174,p.x*0.174+p.y*0.985);
        let uv=camera.glint.xy+fract(rotated+vec2<f32>(-time/110.0,time/30.0))*camera.glint.zw;
        let shine=textureSampleLevel(atlas,nearest,uv,0,0.0).rgb;
        base=vec4<f32>(base.rgb+shine*vec3<f32>(0.5,0.25,0.8)*0.75,base.a);
    }
    return base;
}
