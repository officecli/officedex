// Native animation API probe, not a replacement for source-backed design recipes.
export async function build(PowerPoint, _data, runtime) {
  const video=runtime.video.createProject({width:960,height:540,fps:30,sourceOfTruth:'native-pptx-timing',autoAdvance:true});
  await PowerPoint.run(async context=>{
    const count=context.presentation.slides.getCount();await context.sync();if(count.value)throw new Error('Requires blank document');
    context.presentation.pageSetup.slideWidth=960;context.presentation.pageSetup.slideHeight=540;
    for(let i=0;i<2;i++) {
      context.presentation.slides.add();await context.sync();
      const slide=context.presentation.slides.getItemAt(i);
      slide.background.fill.setSolidFill({color:'#F5F3FF'});
      const title=slide.shapes.addTextBox(i?'依次出现':'动画 PPT',{left:64,top:55,width:800,height:75});
      title.name=`title-${i}`;title.textFrame.textRange.font.size=36;
      const scene=video.scene({id:`scene-${i}`,slideIndex:i+1,startMs:i*5000,durationMs:5000});
      for(let j=0;j<(i?3:1);j++) {
        const body=slide.shapes.addTextBox(['原生对象，可继续编辑','动画随 PPTX 保存','放映与导出使用同一时间轴'][j],{left:64,top:170+j*90,width:820,height:75});
        body.name=`content-${i}-${j}`;body.textFrame.textRange.font.size=28;
        scene.animate(`content-${i}-${j}`,{effect:'Entrance_FadeIn',start:'withPrevious',delayMs:300+j*500,durationMs:i?450:600});
      }
    }
    await context.sync();await video.commitNativeTiming(context);await context.sync();
  });
  return video.finalize({requireNativeTiming:true});
}
