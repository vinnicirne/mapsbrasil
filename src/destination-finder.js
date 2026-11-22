const minimumQueryLength=3;

export function createDestinationFinder(form,{find,select,navigate}) {
  const query=form.querySelector('input');
  const feedback=form.querySelector('[role="status"]');
  const results=form.querySelector('ul');
  const searchButton=form.querySelector('[type="submit"]');
  const go=form.querySelector('[data-go]');
  let target, sequence=0, starting=false;
  let timer, controller, searchedAddress, mapPreview;

  function clearSelection() {
    target=undefined;
    go.hidden=true;
    if(mapPreview) {
      mapPreview=undefined;
      select(undefined);
    }
  }
  function clearResults() {
    sequence++;
    clearTimeout(timer);
    controller?.abort();
    controller=undefined;
    searchedAddress=undefined;
    results.replaceChildren();
    clearSelection();
    feedback.textContent='';
  }
  function schedule(address,delay,retry=true) {
    clearTimeout(timer);
    timer=setTimeout(()=>void search(address,retry),delay);
  }
  query.addEventListener('input',event=>{
    clearResults();
    const address=query.value.trim();
    if(!event.isComposing && address.length>=minimumQueryLength) schedule(address,270);
  });
  query.addEventListener('compositionend',()=>{
    const address=query.value.trim();
    if(address.length>=minimumQueryLength) schedule(address,270);
  });
  function showMatches(matches,provisional=false) {
    results.replaceChildren();
    if(!matches.length) {
      feedback.textContent='Endereço sem correspondência. Confira rua, número e cidade. Sem internet, a busca usa a região baixada.';
      return;
    }
    feedback.textContent=provisional?'Resultados da região. Buscando mais endereços…':'Escolha o destino abaixo.';
    for (const match of matches) {
      const item=document.createElement('li');
      const choice=document.createElement('button');
      choice.type='button';
      choice.className='destination-result';
      const name=document.createElement('strong');
      name.textContent=match.name;
      const detail=document.createElement('span');
      const precision=match.numberMissing ? 'Número sem registro · ponto aproximado'
        : match.precision==='street' ? 'Ponto aproximado na rua' : 'Ponto no mapa';
      detail.textContent=[match.locality,precision].filter(Boolean).join(' · ');
      choice.append(name,detail);
      choice.onclick=()=>{
        sequence++;
        controller?.abort();
        controller=undefined;
        clearTimeout(timer);
        target=match;
        searchedAddress=match.name;
        query.value=match.name;
        results.replaceChildren();
        feedback.textContent=(match.precision==='street'?'Confira o ponto aproximado no mapa. ':'')+(select(match) ?? '');
        go.hidden=false;
        go.focus();
      };
      item.append(choice);
      results.append(item);
    }
    if(mapPreview!==matches[0]) {
      mapPreview=matches[0];
      select(mapPreview);
    }
  }
  async function search(address,retry=true) {
    if(starting || controller || address===searchedAddress) return;
    const request=sequence;
    const active=controller=new AbortController();
    feedback.textContent='Procurando endereço…';
    let preview;
    try {
      const matches=await find(address,{
        signal:active.signal,
        preview:matches=>{
          if(request!==sequence || !matches.length) return;
          preview=matches;
          showMatches(matches,true);
        }
      });
      if(request!==sequence) return;
      if(matches.length) searchedAddress=address;
      showMatches(matches);
    } catch(error) {
      if(request!==sequence) return;
      if(preview) showMatches(preview);
      else if(error.status===429 && retry) schedule(address,
        Number.isFinite(error.retryAfterMs)?Math.min(1300,Math.max(50,error.retryAfterMs+25)):1300,false);
      else feedback.textContent=error.message;
    } finally {
      if(controller===active) controller=undefined;
    }
  }
  form.onsubmit=event=>{
    event.preventDefault();
    const address=query.value.trim();
    if(address.length<minimumQueryLength) {
      feedback.textContent='Digite pelo menos três caracteres do endereço.';
      return;
    }
    clearTimeout(timer);
    void search(address);
  };
  go.onclick=async()=>{
    if(!target || starting) return;
    starting=true;
    go.disabled=true;
    query.disabled=true;
    searchButton.disabled=true;
    feedback.textContent='Calculando trajeto a partir do GPS…';
    try {
      await navigate(target);
      feedback.textContent='';
    } catch(error) {feedback.textContent=error.message;}
    finally {
      go.disabled=false;
      query.disabled=false;
      searchButton.disabled=false;
      starting=false;
    }
  };
  return {
    reset() {
      query.value='';
      clearResults();
    }
  };
}
