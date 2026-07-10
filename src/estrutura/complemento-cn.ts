/**
 * Complemento curado: órgãos do CONGRESSO NACIONAL em que o cadastro de servidores do Senado
 * registra lotação, mas que não aparecem no organograma do portal institucional do SF (o portal
 * só publica a árvore do Senado — para as comissões mistas ele tem apenas as Secretarias de
 * Apoio, que são unidades do SF distintas das comissões em si).
 *
 * Fonte pública: https://www.congressonacional.leg.br (comissões mistas permanentes do CN).
 * Decisão do mantenedor (10/07/2026): computar esses servidores como servidores do Senado,
 * classificados sob a estrutura própria do Congresso Nacional — uma RAIZ SEPARADA, nunca sob o
 * SF (consultas como `subordinadasA: "DGER"` não os incluem; `subordinadasA: "CN"` sim).
 *
 * Códigos negativos fixos, fora do fluxo do crawler (que gera hashes para nós sintéticos do
 * portal); um teste garante que não colidem com o snapshot. Como os nós sintéticos, o `cod`
 * nunca chega ao usuário. O casamento com o cadastro se dá pela SIGLA exata da lotação
 * (CMO/CPCMS/CMMC), que o cadastro expõe — o nome vem truncado/abreviado.
 */

import type { OrgaoNode } from "./tipos.js";

export const COMPLEMENTO_CONGRESSO: OrgaoNode[] = [
  { cod: -900000, sigla: "CN", nome: "Congresso Nacional", codSuperior: null },
  {
    cod: -900001,
    sigla: "CMO",
    nome: "Comissão Mista de Planos, Orçamentos Públicos e Fiscalização",
    codSuperior: -900000,
  },
  {
    cod: -900002,
    sigla: "CPCMS",
    nome: "Representação Brasileira no Parlamento do Mercosul",
    codSuperior: -900000,
  },
  {
    cod: -900003,
    sigla: "CMMC",
    nome: "Comissão Mista Permanente sobre Mudanças Climáticas",
    codSuperior: -900000,
  },
];
