import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const modulePath=process.argv[2];
if (!modulePath) throw Error('Informe a entrada ES module do pacote espeak-ng 1.0.2.');
const {default:engine}=await import(pathToFileURL(resolve(modulePath)));
const voices={
  start:'Navegação iniciada.',
  left:'Vire à esquerda.',
  right:'Vire à direita.',
  straight:'Siga em frente.',
  uturn:'Faça o retorno.',
  arrive:'Chegada à parada.',
  risk:'Atenção. Você entrou em uma área de risco mapeada.'
};
await mkdir('public/audio',{recursive:true});
for (const [name, phrase] of Object.entries(voices)) {
  const cli=await engine({arguments:['-v','pt-br','-b','1','-s','155','-w','message.wav',phrase]});
  await writeFile('public/audio/'+name+'.wav',cli.FS.readFile('message.wav'));
}
