struct Camera {
    view_projection:mat4x4<f32>,eye:vec4<f32>,origin:vec4<i32>,viewport:vec4<f32>,glint:vec4<f32>,
    fog:vec4<f32>,fog_range:vec4<f32>,lightmap:array<vec4<f32>,256>,
};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var textures:texture_2d_array<f32>;
@group(1) @binding(1) var tex_sampler:sampler;
struct Out {
    @builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>,
    @location(1) @interpolate(flat) snow:u32,@location(2) color:vec4<f32>,@location(3) distance:f32,
};
@vertex fn vs_main(@builtin(vertex_index) vertex:u32,@location(0) base:vec3<f32>,@location(1) snow:u32,@location(2) light:vec2<f32>,@location(3) phase:f32,@location(4) strength:f32)->Out {
    let corners=array<vec2<f32>,6>(vec2(0.,0.),vec2(1.,0.),vec2(1.,1.),vec2(0.,0.),vec2(1.,1.),vec2(0.,1.));
    let uv=corners[vertex];
    let delta=base.xz-camera.eye.xz;
    let distance=length(delta);
    let side=vec2(-delta.y,delta.x)/max(distance,0.001)*0.5;
    let bottom=max(base.y,camera.eye.y-10.);
    let top=max(base.y,camera.eye.y+10.);
    let world=vec3(base.x+side.x*(uv.x*2.-1.),mix(top,bottom,uv.y),base.z+side.y*(uv.x*2.-1.));
    let seconds=camera.viewport.z;
    // UV increases with world height: a positive time offset moves features DOWN.
    var drift=vec2(0.,seconds*20./32.*(3.+phase)+phase*32.);
    if snow==1u {drift=vec2(phase+seconds*0.2*(phase*2.-1.),seconds*20./512.+phase*8.);}
    let index=u32(clamp(round(light.x),0.,15.))+16u*u32(clamp(round(light.y),0.,15.));
    // The outer ring fades to zero before a column enters/leaves the snapshot.
    let fade=1.-smoothstep(8.,10.,distance);
    let alpha=strength*fade*select(0.5,0.8,snow==1u);
    var o:Out;o.position=camera.view_projection*vec4(world,1.);o.uv=vec2(uv.x,world.y*0.25)+drift;
    o.snow=snow;o.color=vec4(camera.lightmap[index].rgb,alpha);o.distance=length(world-camera.eye.xyz);return o;
}
fn encoded(c:vec3<f32>)->vec3<f32> {return select(1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-0.055,c*12.92,c<=vec3(0.0031308));}
fn linear(c:vec3<f32>)->vec3<f32> {return select(pow(max((c+0.055)/1.055,vec3(0.)),vec3(2.4)),c/12.92,c<=vec3(0.04045));}
@fragment fn fs_main(i:Out)->@location(0) vec4<f32> {
    let tex=textureSample(textures,tex_sampler,i.uv,i32(i.snow));
    let alpha=tex.a*i.color.a;if alpha<0.003 {discard;}
    let fog=smoothstep(camera.fog_range.x,camera.fog_range.y,i.distance);
    return vec4(linear(mix(encoded(tex.rgb)*i.color.rgb,camera.fog.rgb,fog)),alpha);
}
