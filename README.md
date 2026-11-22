# MapsBrasil Drive

PWA independente para motoristas terceirizados. A empresa aprova um vínculo pelo identificador da conta, mesmo quando o motorista usa e-mail pessoal. O sistema tem frontend, API, banco SQLite, service worker e publicação próprios. Pode autenticar no mesmo projeto Firebase do sistema corporativo. O PWA consulta apenas a sua API e o provedor de identidade.

## Executar o piloto local

Requer Node.js 24.12 ou superior e npm.

```sh
npm ci
npm run build
```

No PowerShell, execute:

```powershell
$env:MAPSBRASIL_DEMO = '1'
npm start
```

Abra [MapsBrasil Drive local](http://127.0.0.1:4173). A demonstração só inicia em loopback e fora de produção. Os usuários, pedidos e aprovações são fictícios. A base viária de Rio do Ouro é um extrato do OpenStreetMap e o único polígono de risco dessa demonstração é simulado.

1. Abra o PWA e entre como motorista. Solicite acesso com o código `rio-demo`.
2. Em outro perfil de navegador, abra [/gestao](http://127.0.0.1:4173/gestao) e entre como empresa. Aprove o vínculo.
3. No motorista, atualize a situação, baixe a região e use **Carregar rota de teste**. Também é possível clicar no mapa para informar a origem e as paradas.
4. Para um turno real, importe um CSV separado por ponto e vírgula no formato `Nome;Latitude;Longitude`, preservando a ordem das linhas. A opção de ordenar por proximidade organiza as paradas pela distância em linha reta, e o trajeto entre elas segue o grafo viário. Endereços em texto são aceitos quando rua e número têm correspondência única no pacote. Endereços ambíguos exigem coordenadas ou marcação no mapa. O piloto aceita até 30 paradas. Os apps de entrega continuam responsáveis por suas próprias rotas e confirmações de entrega.

A navegação acompanha o GPS, mostra a próxima manobra, estima tempo e distância sem dados de trânsito e oferece instruções sonoras. A região baixada contém as vias, a base do mapa e os polígonos necessários. As instruções de voz usam uma voz local pt-BR quando disponível e gravações sintetizadas incluídas no PWA como alternativa offline, geradas com [eSpeak NG](https://github.com/espeak-ng/espeak-ng).

Dentro da região baixada, um desvio pode ser recalculado no próprio dispositivo. Na falta de cobertura viária ou de GPS confiável, o PWA informa o estado e mantém a rota salva disponível. A navegação e os alertas dependem do PWA visível. Ao voltar de outro app, o painel verifica a posição atual. A autorização para reabrir offline dura até oito horas desde a última emissão online e fica vinculada à conta, à empresa e à versão da região.

## Testes

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

O E2E usa um servidor local com banco temporário, dois contextos isolados de navegador e GPS simulado. Cobre autocadastro, aprovação, bloqueio de gestão para motorista, download, reabertura com a rede desligada, avanço de manobras, entrada em polígono, recálculo após desvio, chegada e revogação. Defina `MAPSBRASIL_CHROMIUM` para usar um executável Chromium já disponível.

## Configurar a homologação HTTPS

- Publique o build e o servidor Node juntos em uma instância dedicada, atrás de TLS. Use um volume persistente para `DATA_DIR` e inclua os arquivos SQLite no backup. Use uma instância escritora por banco.
- Configure o Firebase em `.env` a partir de `.env.example`. Habilite Google e E-mail/senha, cadastre o domínio autorizado do PWA e valide o login com contas verificadas. O Firebase Admin valida os tokens e a confirmação do e-mail na API. O servidor mantém os vínculos e as decisões em sua própria base, sem consultar o banco corporativo. Configure o ambiente sem o modo demo.
- Cadastre nome, identificador, código de adesão e UIDs de administradores para cada empresa em `COMPANIES_JSON`. O código identifica a empresa no autocadastro, cuja aprovação é obrigatória. Um convite é ligado ao e-mail verificado, vence em sete dias e é consumido de forma atômica. O administrador copia o link e envia pelo canal da empresa.
- Configure `PILOT_PACK_PATH` com o caminho do pacote autorizado. A API libera o download somente para um vínculo aprovado. O pacote de demonstração distribuído no repositório é utilizável explicitamente no modo demo ou com `ALLOW_SAMPLE_PACK=1`. O PWA sinaliza dados simulados.
- Homologue a cobertura viária, a voz e a geolocalização sem rede em veículos e aparelhos físicos. O navegador pode remover os dados locais. A tela exige baixar novamente quando o mapa for descartado pelo navegador. Valide os dados cartográficos antes de usar na operação.

## Gerar um pacote regional

Forneça um extrato OSM JSON e o arquivo GeoJSON de risco autorizado. O extrato incluído corresponde à caixa de Rio do Ouro indicada no script. Para outra área, defina PACK_BOUNDS na ordem oeste,sul,leste,norte e PACK_REGION com o nome da região. Use fontes licenciadas para expansão e preserve a atribuição [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

```sh
npm run pack:osm -- /caminho/osm.json /caminho/regiao.json /caminho/risco.geojson
```

O arquivo de risco deve conter feições `Polygon` ou `MultiPolygon`, com identificador estável. A preparação viária cobre vias trafegáveis, barreiras conhecidas, mãos únicas e restrições simples de conversão. Revise manualmente restrições condicionais, multidirecionais ou de múltiplos segmentos antes de homologar outra cobertura. A geometria e as rotas são válidas dentro da região baixada. O mapa se baseia em dados locais e funciona sem depender de serviços públicos de tiles. [Licença da base do piloto](public/osm-license.txt)

O [checklist de construção](CHECKLIST.md) acompanha a entrega e os itens de homologação operacional.
