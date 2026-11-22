import {makeRouter} from './router.js';

let route;
self.onmessage = ({data}) => {
  const {id,pack,start,stops}=data;
  try {
    if (pack) route=makeRouter(pack);
    if (!route) throw Error('O pacote viário ainda não foi carregado.');
    self.postMessage({id,result:route(start,stops)});
  } catch (error) {
    self.postMessage({id,error:error.message});
  }
};
