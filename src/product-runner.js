(function(root){'use strict';var TF=root.TF=root.TF||{},busy=false;
 function available(){return typeof root.Worker==='function'&&root.Blob&&root.URL&&typeof TF.ENGINE_WORKER_SOURCE==='string'&&TF.engine&&typeof TF.engine.restoreCheckpointInto==='function';}
 function workerMain(){var handle=null,cancel=false,chunk=120,lastProgress=0,policy=null,waiting=false,afterSave=null;
  function send(type,data){postMessage(Object.assign({type:type},data));}
  function checkpoint(reason,next){waiting=true;afterSave=next;send('checkpoint',{reason:reason,checkpoint:TF.engine.saveCheckpoint(handle)});}
  function pump(){try{
   if(cancel){handle.status='cancelled';send('done',{status:'cancelled',checkpoint:TF.engine.saveCheckpoint(handle)});return;}
   var before=handle.match.tick,result=TF.engine.stepMatch(handle,chunk);
   if(Date.now()-lastProgress>200){lastProgress=Date.now();send('progress',{snapshot:TF.engine.readSnapshot(handle)});}
   if(result.status==='completed'||result.status==='error'||result.status==='cancelled'){send('done',{status:result.status,checkpoint:TF.engine.saveCheckpoint(handle),result:TF.engine.getResult(handle)});return;}
   if(handle.match.tick===before&&result.status!=='half-time')throw new Error('Engine did not advance.');
   if(handle.match.tick>2000000)throw new Error('Match exceeded the bounded execution tick budget.');
   var next=function(){if(result.status==='half-time')TF.engine.continueAfterHalfTime(handle);setTimeout(pump,0);},reason=policy.due(result.status);
   if(reason)checkpoint(reason,next);else next();
  }catch(e){if(handle){handle.status='error';handle.core.pause();}send('error',{message:e.message,checkpoint:handle?TF.engine.saveCheckpoint(handle):null});}}
  onmessage=function(e){var data=e.data;if(data.type==='cancel'){cancel=true;return;}if(data.type==='checkpoint-saved'&&waiting){waiting=false;policy.saved();var next=afterSave;afterSave=null;next();return;}if(data.type==='run'){try{handle=TF.engine.restoreCheckpoint(data.checkpoint);handle.status='running';handle.core.resume();if(!handle.match.state.halfTime&&!handle.match.state.finished)handle.match.clock.running=true;chunk=Math.max(1,Math.min(600,data.chunkTicks||120));policy=TF.productData.checkpointPolicy(handle,{checkpointIntervalMs:data.checkpointIntervalMs});checkpoint('initial',pump);}catch(error){send('error',{message:error.message});}}};
 }
 async function run(handle,options){options=options||{};if(!available()){var unavailable=new Error('A local simulation worker is unavailable.');unavailable.code='WORKER_UNAVAILABLE';throw unavailable;}if(busy){var busyError=new Error('Another local worker match is running. Wait or cancel it first.');busyError.code='WORKER_BUSY';throw busyError;}
  busy=true;var worker,url,initial=TF.engine.saveCheckpoint(handle),latest=initial;if(handle.core)handle.core.pause();
  try{url=URL.createObjectURL(new Blob([TF.ENGINE_WORKER_SOURCE+'\n('+workerMain.toString()+')();'],{type:'text/javascript'}));
   try{worker=new Worker(url);}catch(cause){var startError=new Error('The local simulation worker could not start.');startError.code='WORKER_START_FAILED';startError.cause=cause;throw startError;}
   return await new Promise(function(resolve,reject){var abortTimer=null,settled=false,persisting=Promise.resolve();
   function finish(error,data){if(settled)return;settled=true;if(abortTimer)clearTimeout(abortTimer);if(options.signal)options.signal.removeEventListener('abort',abort);try{if(data&&data.checkpoint)TF.engine.restoreCheckpointInto(handle,data.checkpoint);}catch(e){reject(e);return;}if(error)reject(error);else resolve(data);}
   function recover(error){TF.engine.restoreCheckpointInto(handle,latest);if(error.code!=='WORKER_START_FAILED')handle.status='error';handle.core.pause();finish(error);}
   function abort(){worker.postMessage({type:'cancel'});abortTimer=setTimeout(function(){persisting.then(function(){if(settled)return;TF.engine.restoreCheckpointInto(handle,latest);handle.status='cancelled';handle.core.pause();finish(null,{status:'cancelled',checkpoint:TF.engine.saveCheckpoint(handle),recoveredFromLatestCheckpoint:true});},function(){});},2000);}
   if(options.signal){options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted){handle.status='cancelled';finish(null,{status:'cancelled',checkpoint:TF.engine.saveCheckpoint(handle)});return;}}
   worker.onmessage=function(e){var data=e.data;if(settled)return;
    if(data.type==='progress'){if(options.onProgress)options.onProgress(data.snapshot);return;}
    if(data.type==='checkpoint'){
     // The worker waits for this acknowledgement: one immutable checkpoint/write at a time.
     persisting=Promise.resolve().then(function(){if(options.onCheckpoint)return options.onCheckpoint(data.checkpoint,data.reason);}).then(function(){latest=data.checkpoint;if(!settled)worker.postMessage({type:'checkpoint-saved'});},function(cause){var error=new Error(cause.message||'The local checkpoint could not be saved. Older saved data is preserved.');error.code=cause.code||'CHECKPOINT_WRITE_FAILED';error.checkpointPersistenceFailed=true;recover(error);});return;
    }
    if(data.type==='error'){var error=new Error(data.message||'Local simulation worker failed.');error.code='SIMULATION_ERROR';finish(error,{checkpoint:data.checkpoint||latest});return;}
    if(data.type==='done')finish(null,data);
   };
   worker.onerror=function(){var error=new Error('The local simulation worker stopped. Its latest verified checkpoint is preserved.');error.code='WORKER_START_FAILED';persisting.then(function(){if(!settled)recover(error);});};
   worker.postMessage({type:'run',checkpoint:initial,chunkTicks:options.chunkTicks||120,checkpointIntervalMs:options.checkpointIntervalMs});
  });}finally{if(worker)worker.terminate();if(url)URL.revokeObjectURL(url);busy=false;}
 }
 TF.productRunner={available:available,run:run};
})(typeof window!=='undefined'?window:globalThis);
