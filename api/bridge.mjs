import { configureDriveHandler } from '../server/firestore-api.mjs';
import { forwardApi } from '../server/vercel-proxy.mjs';

let drive;
export default {
  async fetch(request) {
    if (!process.env.FIRESTORE_PROJECT_ID) return forwardApi(request,process.env.MAPSBRASIL_API_ORIGIN);
    try {
      drive ??= configureDriveHandler(process.env);
      return await (await drive)(request);
    } catch (error) {
      drive=undefined;
      console.error('Configuração do Drive indisponível:',error.name);
      return Response.json({error:'Serviço do MapsBrasil Drive ainda não configurado.'},{status:503,headers:{'cache-control':'no-store'}});
    }
  }
};
