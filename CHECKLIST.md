# Checklist de construção do MapsBrasil

- [x] Clonar o repositório independente e delimitar o piloto geográfico.
- [x] Preparar um pacote offline com vias, mapa, endereços e polígono de risco simulado.
- [x] Implementar login, convite, pedido de vínculo, aprovação e revogação por empresa.
- [x] Implementar importação de paradas, navegação curva a curva, voz e alerta local.
- [x] Implementar instalação, download verificado, reabertura offline e recuperação da rota.
- [x] Rodar testes de roteamento, importação, geofencing e isolamento entre contas e empresas.
- [x] Rodar E2E no Chromium antes do push.
- [x] Documentar a configuração do piloto e a execução das suítes.

## Resultado antes do push

- Build de produção concluído com Node.js 24.12.
- Cinco testes automatizados aprovados.
- E2E em viewport móvel com servidor local, identidades fictícias e GPS simulado. Cobriu autocadastro, aprovação, convite, revogação, bloqueio da gestão, download, reabertura com rede desligada, voz local empacotada, manobras, alerta, desvio, recálculo e chegada. Também confirmou importação e avanço entre duas paradas.
- O histórico de `main` no GitHub registra o envio do código após os testes.

## Homologação operacional

- [ ] Configurar projeto Firebase autorizado, domínio HTTPS e administradores da empresa piloto.
- [ ] Validar login federado e confirmação real de e-mail no domínio do PWA.
- [ ] Publicar um pacote de risco operacional autorizado e ampliar a cobertura viária conforme a amostra de rotas.
- [ ] Homologar GPS, voz offline, bateria, armazenamento e instalação em aparelhos físicos Android e iPhone.
