export function createDestinationFinder(form,{find,select,navigate}) {
  const query=form.querySelector('input');
  const feedback=form.querySelector('[role="status"]');
  const results=form.querySelector('ul');
  const searchButton=form.querySelector('[type="submit"]');
  const go=form.querySelector('[data-go]');
  let target, sequence=0, starting=false;
  let timer, lastSearch=0, searchedAddress, searching=false;

  function clearSelection() {
    target=undefined;
    go.hidden=true;
    select(undefined);
  }
  function clearResults() {
    sequence++;
    clearTimeout(timer);
    searchedAddress=undefined;
    searching=false;
    results.replaceChildren();
    clearSelection();
    feedback.textContent='';
  }
  function schedule(address,delay,retry=true) {
    clearTimeout(timer);
    timer=setTimeout(()=>void search(address,retry),Math.max(delay,1300-(Date.now()-lastSearch)));
  }
  query.addEventListener('input',event=>{
    clearResults();
    const address=query.value.trim();
    if(!event.isComposing && address.length>=4) schedule(address,650);
  });
  query.addEventListener('compositionend',()=>{
    const address=query.value.trim();
    if(address.length>=4) schedule(address,650);
  });
  async function search(address,retry) {
    if(starting || searching || address===searchedAddress) return;
    const request=sequence;
    lastSearch=Date.now();
    searching=true;
    feedback.textContent='Procurando endereço…';
    try {
      const matches=await find(address);
      if(request!==sequence) return;
      searchedAddress=address;
      if(!matches.length) {
        feedback.textContent='Endereço sem correspondência. Confira rua, número e cidade. Sem internet, a busca usa a região baixada.';
        return;
      }
      feedback.textContent='Escolha o destino abaixo.';
      select(matches[0]);
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
    } catch(error) {
      if(request!==sequence) return;
      if(error.status===429 && retry) schedule(address,1300,false);
      else feedback.textContent=error.message;
    } finally {
      if(request===sequence) searching=false;
    }
  }
  form.onsubmit=event=>{
    event.preventDefault();
    const address=query.value.trim();
    if(address.length<3) {
      feedback.textContent='Digite pelo menos três caracteres do endereço.';
      return;
    }
    if (!starting && !searching && address!==searchedAddress) schedule(address,0);
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
