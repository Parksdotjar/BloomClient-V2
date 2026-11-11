
import java.lang.reflect.*;
import java.io.*;
public class DumpLighting {
 static Object call(Object o,String name,Object...args)throws Exception {for(Method m:o.getClass().getMethods())if(m.getName().equals(name)&&m.getParameterCount()==args.length)return m.invoke(o,args);throw new NoSuchMethodException(name);}
 public static void main(String[]args)throws Exception {
  Class.forName("net.minecraft.SharedConstants").getMethod("tryDetectVersion").invoke(null);
  Class.forName("net.minecraft.server.Bootstrap").getMethod("bootStrap").invoke(null);
  Object states=Class.forName("net.minecraft.world.level.block.Block").getField("BLOCK_STATE_REGISTRY").get(null);
  Object empty=Class.forName("net.minecraft.world.level.EmptyBlockGetter").getField("INSTANCE").get(null);
  Object zero=Class.forName("net.minecraft.core.BlockPos").getField("ZERO").get(null);
  Class<?> direction=Class.forName("net.minecraft.core.Direction");
  String[] names={"EAST","WEST","UP","DOWN","SOUTH","NORTH"};
  try(DataOutputStream out=new DataOutputStream(new FileOutputStream(args[0]))){
   int count=0;
   for(Object state:(Iterable<?>)states){
    out.writeByte((int)call(state,"getLightEmission"));out.writeByte((int)call(state,"getLightDampening"));
    out.writeByte(Math.round((float)call(state,"getShadeBrightness",empty,zero)*255));
    int flags=((boolean)call(state,"propagatesSkylightDown")?1:0)|((boolean)call(state,"useShapeForLightOcclusion")?2:0)|((boolean)call(state,"isSolidRender")?4:0);
    flags|=(boolean)call(state,"isCollisionShapeFullBlock",empty,zero)?8:0;
    out.writeByte(flags);
    for(int d=0;d<6;d++){
     Object shape=call(state,"getFaceOcclusionShape",direction.getField(names[d]).get(null));
     byte[] mask=new byte[32];int u=d<2?2:0;int v=d<2?1:d<4?2:1;
     for(Object box:(Iterable<?>)call(shape,"toAabbs")){
      String[] low={"minX","minY","minZ"},high={"maxX","maxY","maxZ"};
      double a=box.getClass().getField(low[u]).getDouble(box),b=box.getClass().getField(high[u]).getDouble(box),c=box.getClass().getField(low[v]).getDouble(box),e=box.getClass().getField(high[v]).getDouble(box);
      for(int y=0;y<16;y++)for(int x=0;x<16;x++)if((x+.5)/16>=a&&(x+.5)/16<b&&(y+.5)/16>=c&&(y+.5)/16<e){int i=x+16*y;mask[i/8]|=1<<(i%8);}
     }out.write(mask);
    }count++;
   }System.err.println("states="+count);
  }
 }
}
