# Verificação bibliográfica e de fontes primárias: `congressbr` e a lacuna de dados de participação cidadã do e-Cidadania (Senado Federal)

*Relatório de verificação — data de acesso de todas as fontes: 03/07/2026. Documento-base para `docs/verificacao-tese-congressbr.md`.*

## TL;DR
- **Item 1 (verificável conclusivamente — a asserção se sustenta como fato datado):** O pacote R `congressbr` foi **arquivado no CRAN em 20/07/2020 "por violação de política"**, na versão corrente **0.2.2**, e não recebe releases desde então; sua lista de funções (`sen_*`, `cham_*`) cobre tramitação de matérias, votações nominais, senadores e comissões, mas **nenhuma função toca a camada de participação cidadã do e-Cidadania** (consultas públicas, ideias legislativas, eventos interativos).
- **Item 2 (negativa universal — calibrada como ausência de evidência):** Uma busca sistemática documentada em Zenodo, Harvard Dataverse, CRAN, PyPI e web geral, executada em 03/07/2026, **não localizou** nenhum dataset ou pacote publicado, versionado e com DOI que cubra a camada de participação cidadã do e-Cidadania. A força máxima admissível da conclusão é "não localizado nestas bases, com estas queries, nesta data" — **não** "não existe".
- **Achado crítico (sobreposição parcial, a destacar):** O próprio Senado distribui **um único CSV, atualizado diariamente, "Todas as proposições com votos na Consulta Pública"**, além de relatórios HTML/PDF por proposição; porém a **API oficial de dados abertos NÃO expõe endpoints do e-Cidadania**. Ferramentas de terceiros que tocam o e-Cidadania (ex.: o servidor MCP `senado-br-mcp`) obtêm os dados por **web scraping**, não como dataset publicado/versionado. Isso reforça — em vez de refutar — a existência da lacuna que o dataset em questão preenche.

---

## Key Findings

### Item 1 — Estado de manutenção e cobertura do `congressbr`
1. **Arquivamento (fato datado, fonte primária CRAN):** a página canônica do pacote declara textualmente: *"Package 'congressbr' was removed from the CRAN repository. Formerly available versions can be obtained from the archive. **Archived on 2020-07-20 for policy violation.**"* Portanto, o pacote **não está ativo no CRAN**; está arquivado desde 20 de julho de 2020, por violação de política (não por bounce de e-mail do mantenedor).
2. **Versão corrente:** a última versão é a **0.2.2** (confirmada no `cran-comments.md` do repositório e no espelho rdrr.io). Não há versão posterior publicada.
3. **Repositório de origem e inatividade:** o repositório oficial é o GitHub **`duarteguilherme/congressbr`** (espelhado em `RobertMyles/congressbr`; o `BugReports`/`URL` do pacote aponta para essa base). Métricas reais em 03/07/2026: **≈38 stars, 6 forks, 4 issues abertas (48 fechadas)**. A documentação do pacote foi construída pela última vez em torno de 18/07/2020, e não há releases nem commits substantivos posteriores — consistente com o arquivamento.
4. **Cobertura funcional (fonte: README oficial + reference index):** todas as funções seguem a convenção de nomes `sen_` (Senado) e `cham_` (Câmara). O inventário documentado inclui, entre outras: `sen_bills`, `sen_bills_current`, `sen_bill_search`, `sen_bill_sponsors`, `sen_votes`, `sen_senator`, `sen_senator_votes`, `sen_senator_list`, `sen_commissions`, `sen_commissions_senators`, `sen_parties`, `sen_plenary_agenda`, `sen_plenary_result`, `sen_budget`, `cham_bills`, `cham_bill_info`, `cham_votes`, `cham_plenary_bills`, além dos datasets embutidos `sen_nominal_votes`, `cham_nominal_votes` e `commissions`. **Nenhuma função ou vinheta menciona e-Cidadania, consulta pública, ideia legislativa ou evento interativo.** O escopo do artigo LARR confirma: o pacote baixa dados "on legislators, submitted and ratified law proposals, Senate and Chamber commissions" — isto é, atividade legislativa/tramitação/votações/senadores/comissões, e não participação cidadã.

**Distinção explícita:** o `congressbr` cobre *atividade legislativa* (tramitação, votações nominais, senadores, comissões, orçamento) e **não** cobre a *participação cidadã do e-Cidadania* (consultas públicas com votos por UF, ideias legislativas com apoios, eventos interativos com perguntas/comentários) — que é precisamente a lacuna que o dataset descrito no data descriptor preenche.

### Item 2 — Busca sistemática por dataset/pacote de participação cidadã do e-Cidadania
Nenhuma das bases consultadas retornou um dataset/pacote **publicado, versionado e com DOI** cobrindo a participação do e-Cidadania. Foram identificados quatro candidatos próximos, todos explicitamente **diferenciados** da lacuna (ver seção "Candidatos próximos"). O achado mais relevante é a **fonte oficial**: o Senado publica um CSV diário de votos em consultas públicas e relatórios HTML/PDF, mas **sem API estruturada** para ideias legislativas e eventos interativos — o que caracteriza a participação cidadã como *disponível de forma fragmentada, porém não empacotada como dataset científico citável*.

---

## Details

### (1) Estratégia de busca registrada (definida a priori)

**Bases cobertas:** Zenodo (zenodo.org); Harvard Dataverse (dataverse.harvard.edu) e Dataverse em geral; CRAN (busca de pacotes/arquivo); PyPI (pypi.org); Google Dataset Search; Google Scholar; SciELO (scielo.br); LILACS/BVS; web geral; GitHub/OSF/Figshare/Kaggle; e o portal oficial do Senado (dadosabertos.senado.leg.br e www12.senado.leg.br/ecidadania).

**Strings de busca (PT e EN):** combinações de {e-Cidadania, ecidadania, consulta pública, ideia legislativa, participação legislativa, participação cidadã, Senado Federal, Brazilian Senate, citizen participation, legislative crowdsourcing, public consultation} × {dataset, dados abertos, open data, R package, Python package, corpus, base de dados, DOI}.

### (2) Tabela de evidências — Item 1

| Fato | Fonte (URL) | Acesso |
|---|---|---|
| "Package 'congressbr' was removed from the CRAN repository… Archived on 2020-07-20 for policy violation." | https://cran.r-project.org/web/packages/congressbr/index.html (forma canônica: https://CRAN.R-project.org/package=congressbr) | 03/07/2026 |
| Versão corrente 0.2.2 | https://rdrr.io/cran/congressbr/ ; `cran-comments.md` em https://github.com/duarteguilherme/congressbr/blob/master/cran-comments.md | 03/07/2026 |
| Artigo: McDonnell, R. M., Duarte, G. J., & Freire, D. (2019). *Congressbr: An R Package for Analyzing Data from Brazil's Chamber of Deputies and Federal Senate*. Latin American Research Review, 54(4), 958–969. DOI 10.25222/larr.447 (CC-BY 4.0) | https://larrlasa.org/articles/10.25222/larr.447/ ; https://www.cambridge.org/core/journals/latin-american-research-review/article/697BB8D9ADD0DC4E42DD0D6EC58CB26D | 03/07/2026 |
| Escopo declarado: "downloads data on legislators, submitted and ratified law proposals, Senate and Chamber commissions" | Idem (abstract LARR) | 03/07/2026 |
| Lista de funções `sen_*`/`cham_*` (sem e-Cidadania) | https://github.com/duarteguilherme/congressbr/blob/master/README.Rmd | 03/07/2026 |
| Repositório de origem; ≈38 stars, 6 forks, 4 issues abertas; build ~18/07/2020 | https://github.com/duarteguilherme/congressbr ; https://github.com/RobertMyles/congressbr | 03/07/2026 |

*Nota de proveniência:* a citação oficial da revista (e o `citation("congressbr")` do pacote) lista três autores — McDonnell, Duarte e Freire. A página `docs/authors.html` do repositório inclui um quarto contribuidor (Julio Trecenti); para citação bibliográfica, adotar a forma oficial de três autores da LARR.

### (3) Tabela de evidências — Item 2

| Base | Query (PT/EN) | Resultados triados | Resultado | Link |
|---|---|---|---|---|
| CRAN | "congressbr"; busca de pacotes de participação/e-Cidadania | ~poucos | Só `congressbr` (arquivado; atividade legislativa) | cran.r-project.org/package=congressbr |
| PyPI | "e-cidadania senado"; "DadosAbertosBrasil"; "senado open data" | dezenas | Nenhum pacote de e-Cidadania; `DadosAbertosBrasil` cobre só dados legislativos | pypi.org/project/DadosAbertosBrasil/ |
| Zenodo | "e-Cidadania Senado"; "Brazilian Senate citizen participation" | poucos | Nada relevante (hits europeus/gerais de participação, ex. INCITE-DEM) | zenodo.org |
| Harvard Dataverse | "Brazilian Senate citizen participation e-Cidadania" | poucos | Nada de e-Cidadania; coleções BPSR e Brazilian Legislative Surveys são de outro escopo | dataverse.harvard.edu/dataverse/bpsr |
| GitHub | "scraper e-cidadania senado consultas ideias" | vários | `senado-br-mcp` (scraping, não dataset); `senatebR`/`DadosAbertosBrasil` (sem e-Cidadania) | github.com/SidneyBissoli/senado-br-mcp |
| Google Scholar / SciELO / web | "e-Cidadania participação análise dados"; "ideia legislativa dataset" | vários | Estudos qualitativos/descritivos sobre o portal (ex.: Revista Humanidades e Inovação); nenhum publica dataset estruturado do e-Cidadania | revista.unitins.br |
| Portal oficial do Senado | e-Cidadania "Resultados"; catálogo dados abertos; API dadosabertos | — | **1 CSV diário** de votos em consultas + relatórios HTML/PDF; **API sem endpoints de e-Cidadania** | www12.senado.leg.br/ecidadania/documentos/home/resultados |

*OSF/Figshare/Kaggle/Google Dataset Search:* buscas não retornaram dataset de participação do e-Cidadania; resultados próximos referem-se a dados eleitorais ou de votações nominais da Câmara/Senado (atividade legislativa), não à participação cidadã.

### (4) Candidatos próximos encontrados — e por que NÃO cobrem a lacuna

- **`congressbr`** (McDonnell, Duarte & Freire; CRAN, arquivado 2020-07-20; v0.2.2). Escopo: atividade legislativa da Câmara e do Senado. *Não* cobre e-Cidadania. Sem manutenção.
- **`senatebR`** (Vinicius Santos, 2024; GitHub `vsntos/senatebR`; nota técnica em SocArXiv, id `pe6wc`). O README descreve verbatim *"detailed data in five main dimensions"*: **Projects and Matters; Parliamentarian Information; Composition Information; Information about the Committees; Information on the Plenary.** Todas legislativas; **nenhuma menção a e-Cidadania, consulta pública, ideia legislativa ou evento interativo.**
- **`DadosAbertosBrasil`** (Gustavo Furtado; PyPI, v2.0.1; Python). Documentação oficial do módulo `senado`, verbatim: *"Este módulo permite acessar informações sobre senadores, legislaturas, partidos, orçamentos e outros dados legislativos disponibilizados pelo Senado Federal."* Sem e-Cidadania.
- **`senado-br-mcp`** (SidneyBissoli; GitHub/npm). Servidor MCP que **inclui** ferramentas de e-Cidadania, mas a própria documentação afirma verbatim que *"e-Cidadania tools use web scraping with rate limiting and caching"* — ou seja, **não é um dataset publicado, versionado nem com DOI**; é um cliente de acesso que raspa o site. Relevante notar que o autor do MCP coincide com o autor do data descriptor, o que reforça que a raspagem é instrumento de coleta, não um dataset científico concorrente já publicado.
- **Fonte oficial (e-Cidadania → "Resultados"):** há **um** CSV estruturado — *"Todas as proposições com votos na Consulta Pública"*, descrito como *"Arquivo formato csv atualizado diariamente"* — que cobre **totais de votos por proposição** (parcial). Os demais itens são relatórios HTML/PDF, muitos por proposição (ex.: "Relatório de número de votos em uma proposição por Unidade Federativa", que exige inserir manualmente o ID). **Ideias legislativas e eventos interativos existem apenas como relatórios agregados**, sem API nem dataset estruturado. A **API dados-abertos** (legis.senado.leg.br/dadosabertos) lista apenas serviços legislativos/administrativos (autorias, senadores, sessões, votações, blocos, comissões, matérias, Lexml) — **sem serviço de e-Cidadania**.

**Diferenciação-chave:** todos os candidatos ou (a) cobrem atividade legislativa e não a participação cidadã, ou (b) acessam o e-Cidadania por scraping sem publicá-lo como dataset citável. A lacuna — um dataset estruturado, versionado, com DOI, cobrindo consultas públicas com votos (inclusive por UF), ideias legislativas e eventos interativos — permanece **não preenchida por nenhum artefato publicado localizado**.

### (5) Veredictos calibrados — prontos para a introdução do paper

**Item 1 — Português (acadêmico):**
> "O pacote R *congressbr* (McDonnell, Duarte e Freire, 2019, *Latin American Research Review*, DOI 10.25222/larr.447) encontra-se sem manutenção ativa: foi arquivado no CRAN em 20 de julho de 2020, por violação de política, permanecendo na versão 0.2.2. Sua cobertura funcional limita-se à atividade legislativa — tramitação de matérias, votações nominais, senadores e comissões (funções `sen_*` e `cham_*`) —, não contemplando a camada de participação cidadã do portal e-Cidadania (consultas públicas, ideias legislativas e eventos interativos)."

**Item 1 — English (academic):**
> "The R package *congressbr* (McDonnell, Duarte, and Freire 2019, *Latin American Research Review*, DOI 10.25222/larr.447) is no longer actively maintained: it was archived on CRAN on 20 July 2020 for a policy violation and remains at version 0.2.2. Its functional scope is confined to legislative activity—bill tracking, roll-call votes, senators, and committees (the `sen_*` and `cham_*` functions)—and does not cover the citizen-participation layer of the e-Cidadania portal (public consultations, legislative ideas, and interactive events)."

**Item 2 — Português (acadêmico):**
> "Uma busca sistemática realizada em 3 de julho de 2026 no Zenodo, no Harvard Dataverse, no CRAN, no PyPI e na web em geral — com termos em português e inglês combinando 'e-Cidadania', 'consulta pública', 'ideia legislativa' e 'participação cidadã' com 'dataset', 'dados abertos' e 'pacote' — não localizou nenhum conjunto de dados ou pacote publicado, versionado e com DOI que cubra a camada de participação cidadã do e-Cidadania. Os artefatos mais próximos (congressbr, senatebR, DadosAbertosBrasil) restringem-se à atividade legislativa, e o acesso à participação cidadã, quando existe em ferramentas de terceiros, dá-se por raspagem do portal, não por dados estruturados publicados."

**Item 2 — English (academic):**
> "A systematic search conducted on 3 July 2026 across Zenodo, Harvard Dataverse, CRAN, PyPI, and the general web—using Portuguese and English terms combining 'e-Cidadania', 'public consultation', 'legislative idea', and 'citizen participation' with 'dataset', 'open data', and 'package'—did not locate any published, versioned, DOI-bearing dataset or package covering the e-Cidadania citizen-participation layer. The closest artifacts (congressbr, senatebR, DadosAbertosBrasil) are confined to legislative activity, and where third-party tools do reach citizen-participation data they rely on web scraping of the portal rather than on published structured data."

---

## Recommendations
1. **Adotar as quatro formulações calibradas acima** na introdução, sem afirmar "não existe": usar sempre a construção "busca sistemática nestas bases, nesta data, não localizou".
2. **Posicionar explicitamente os candidatos próximos:** citar `congressbr` (arquivado), `senatebR` e `DadosAbertosBrasil` como cobrindo *atividade legislativa* e contrastá-los com a lacuna de *participação cidadã* — esse contraste fortalece a justificativa do data descriptor.
3. **Caracterizar o CSV oficial de consultas públicas como fonte primária parcial:** reconhecê-lo (totais de votos por proposição, atualizado diariamente) e diferenciá-lo de um dataset científico versionado com DOI que também estruture ideias legislativas, eventos interativos e a granularidade por UF. Enfatizar que a API oficial **não** expõe o e-Cidadania.
4. **Documentar a estratégia de busca (bases × queries × data)** como material suplementar do paper, garantindo reprodutibilidade da mini-revisão de escopo.
5. **Benchmarks que mudariam as conclusões:** se, antes da publicação, surgir no Zenodo/Dataverse/CRAN/PyPI um dataset ou pacote de participação do e-Cidadania (com DOI e entidades sobrepostas), o Item 2 deve ser rebaixado a "prioridade compartilhada" e a sobreposição caracterizada em detalhe (entidades, período, granularidade, formato, licença, versionamento). Se o CRAN readmitir o `congressbr` ou surgir release novo, atualizar o Item 1.

## Caveats (limitações da verificação)
- **Negativa universal não é demonstrável:** a conclusão do Item 2 é "não localizado nestas bases, com estas queries, em 03/07/2026", e não "não existe".
- **Fora do alcance da busca:** bases fechadas/pagas, literatura cinza, repositórios institucionais não indexados, teses e dissertações com anexos de dados, e datasets privados/sob embargo.
- **Limitação técnica:** a página Swagger/OpenAPI da API do Senado (legis.senado.leg.br/dadosabertos) bloqueia intermitentemente acesso automatizado; o veredito de "sem endpoint de e-Cidadania" apoia-se na listagem oficial de categorias de serviço do portal de dados abertos e em documentação corroborante de terceiros (que recorrem a scraping), não na enumeração ao vivo do swagger completo.
- **Exceção parcial a registrar:** o CSV diário oficial de votos em consultas públicas é uma fonte estruturada real, embora cubra apenas totais de votos por proposição — ideias legislativas e eventos interativos permanecem disponíveis apenas como relatórios.
- **Números do repositório GitHub** (stars/forks/issues) são dinâmicos e refletem o estado em 03/07/2026; podem variar.