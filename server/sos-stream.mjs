export function streamSos({companies,subscribe,verify,format,signal,headers}) {
  const encoder=new TextEncoder();
  const stopListeners=[];
  let dispose;
  const body=new ReadableStream({
    start(controller) {
      let closed=false;
      let heartbeat,expiry;
      const close=()=>{if (dispose()) controller.close();};
      dispose=()=>{
        if (closed) return false;
        closed=true;
        clearInterval(heartbeat);
        clearTimeout(expiry);
        signal.removeEventListener('abort',close);
        for (const stop of stopListeners) stop();
        return true;
      };
      if (signal.aborted) return close();
      signal.addEventListener('abort',close,{once:true});
      const write=message=>controller.enqueue(encoder.encode(message));
      const send=data=>write('data: '+JSON.stringify(data)+'\n\n');
      send({domains:[...companies.keys()]});
      heartbeat=setInterval(()=>write(': heartbeat\n\n'),6000);
      expiry=setTimeout(()=>{send({reconnect:true});close();},24000);
      try {
        for (const [domain,company] of companies) {
          if (closed) break;
          let revision=0;
          const stop=subscribe(company.id,async rows=>{
            const version=++revision;
            try {
              const allowed=await verify(domain,company.id);
              if (closed || revision!==version) return;
              const alerts=allowed?rows.map(row=>format(domain,company,row)):[];
              send({domain,alerts});
            } catch {
              close();
            }
          },close);
          if (closed) stop();
          else stopListeners.push(stop);
        }
      } catch {
        close();
      }
    },
    cancel() { dispose?.(); }
  });
  return new Response(body,{headers:{...headers,'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store, no-transform'}});
}
