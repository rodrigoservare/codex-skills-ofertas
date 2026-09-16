---
name: clonador-landing-pages
description: Clonar landing pages, quizzes, fluxos e esteiras públicas inteiras a partir de uma URL ou de um mapa aprovado, com alta fidelidade visual e comportamental, priorizando um caminho rápido e determinístico. Use quando o usuário pedir para copiar, modelar, reconstruir ou deixar uma página, fluxo, esteira ou site idêntico ou fiel a uma referência.
---

# Clonador de Landing Pages

## Objetivo

Reconstruir uma landing page, quiz, fluxo ou esteira pública de referência em um projeto local ou existente, tratando fidelidade visual, cobertura de rotas e comportamento como critério de pronto. Preservar a referência como fonte de verdade e alterar somente o que o usuário especificar.

## Regra principal de velocidade

Executar o caminho mais curto que preserve a fidelidade:

1. **HTTP primeiro:** buscar HTML, CSS, scripts públicos e assets diretamente pela URL, sem abrir navegador para fazer a coleta inicial.
2. **Transplantar em seguida:** quando o HTML/SSR ou o estado público entregue por HTTP estiver completo, reutilizar a estrutura real e reescrever somente as URLs necessárias para o projeto local.
3. **Runtime público antes do navegador:** se vier um shell, investigar bundles, estado embutido e contratos HTTP públicos observados, seguindo o método de `modo-descoberta-extracao-publica`.
4. **Navegador por último:** usar o navegador apenas para confirmar estado visual, geometria e interações que não possam ser inferidos por HTTP.
5. **Reconstruir somente quando necessário:** usar HTML/CSS/JS próprio quando o transplante não for confiável.

Usar `scripts/http-snapshot.mjs` para o baseline HTTP de uma página, `scripts/site-snapshot.mjs` para descobrir recursivamente um site público, `scripts/baixar-assets.mjs` para baixar assets deduplicados em paralelo, `scripts/transplant-html.mjs` para reescrever landing pages documentais, `scripts/transplant-site.mjs` para materializar múltiplas rotas e recursos de um site, `scripts/transplant-quiz-runtime.mjs` para questionários React/Next que entregam um shell público com runtime observável e `scripts/qa-static.mjs` para eliminar rapidamente erros de arquivos, referências e JavaScript antes da revisão visual.

O modo site inteiro usa um pool real de concorrência (sem deixar a descoberta cair para uma requisição por vez), cache HTTP reutilizável e cópia paralela dos arquivos. O cache acelera novas execuções da mesma referência sem alterar o conteúdo; para forçar dados novos, usar `--no-cache` no snapshot. O transplante usa cópia clone-on-write quando disponível e pode ser reutilizado sem reprocessar um manifesto idêntico.

## Critério de pronto

Considerar a página pronta somente quando:

- a ordem, quantidade e hierarquia das seções correspondem à referência;
- no modo site inteiro, todas as rotas HTML públicas descobertas e os documentos/recursos vinculados estão presentes ou têm uma diferença concreta registrada;
- tipografia, textos, imagens, cores, espaçamentos, dimensões, bordas, raios e sombras foram conferidos;
- desktop e mobile foram comparados nos mesmos tamanhos de viewport;

### Modos de operação

- **Fluxo rápido padrão:** para um `document` HTTP completo e um caminho já calibrado, executar snapshot → assets → transplante → entrega. Não abrir navegador nem rodar QA automaticamente.
- **Fluxo site inteiro:** quando o pedido mencionar site, portal, páginas, menu completo ou quando a página expuser mais de uma rota interna relevante, executar descoberta recursiva do domínio → inventário de páginas parametrizadas e arquivos → download deduplicado → transplante de rotas. Não parar na home; o gate estrutural fica reservado para calibração, diagnóstico ou solicitação explícita.
- **Fluxo site inteiro rápido:** manter o snapshot em um diretório de trabalho separado da saída final para evitar duplicar dezenas ou centenas de megabytes. Usar concorrência alta e cache:

  ```bash
  node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/site-snapshot.mjs \
    --url "URL_PUBLICA" \
    --out /caminho/work/site-snapshot \
    --max-pages 2000 \
    --concurrency 32

  node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/transplant-site.mjs \
    --manifest /caminho/work/site-snapshot/reference.site.json \
    --out /caminho/saida
  ```

  A primeira execução baixa a referência; execuções repetidas aproveitam o cache do snapshot e o manifesto do transplante. Usar `--force` no transplante quando for necessário reconstruir a saída.
- **Fluxo de esteira pública:** quando houver um mapa aprovado, usar suas rotas e destinos como escopo inicial, agrupar páginas por domínio/template, executar snapshots HTTP por superfície e transplantar o conjunto em uma saída navegável. Checkouts, áreas privadas e pós-compra continuam classificados conforme o estado público realmente acessível; não simulá-los como entregues.
- **Calibração/diagnóstico:** executar o gate estático e a comparação visual quando a skill estiver sendo validada pela primeira vez, quando o usuário solicitar QA, quando houver mudança relevante no extrator/transplante ou quando a resposta HTTP for `shell`/`partial`.
- A capacidade de QA permanece disponível; ela é opcional no caminho rápido, não removida da skill.
- imagens lazy-loaded, barras fixas, animações e estados interativos relevantes foram verificados;
- âncoras, FAQ, botões e links funcionam conforme o escopo pedido;
- não existe overflow horizontal, asset quebrado ou erro JavaScript introduzido;
- cada diferença restante é intencional ou foi registrada objetivamente.

Velocidade reduz retrabalho; não remove os gates de qualidade.

## Entradas e decisões

Usar, nesta ordem:

1. URL pública ou página já aberta no navegador persistente autorizado;
2. diretório do projeto de destino;
3. substituições explícitas de produto, marca, textos, imagens, links, checkout ou identidade visual.

Se o usuário não especificar substituição, preservar o conteúdo observado. Não redesenhar, modernizar ou “melhorar” a página por iniciativa própria.

Se a referência depender de login, conteúdo dinâmico ou recurso indisponível, reproduzir o estado observável acessível e registrar somente a diferença concreta.

## Entrada preferencial: mapa aprovado de esteira

Quando existir um relatório do `mapeador-de-esteiras-de-ofertas`, usá-lo como contrato de escopo:

- transformar o inventário de rotas públicas em uma lista de páginas e recursos a reconstruir;
- seguir a sequência observada, incluindo landing, quiz, checkout público, páginas de oferta, upsells e downsells públicos quando estiverem no escopo aprovado;
- preservar a distinção entre fluxo confirmado, destino configurado e estado não testado;
- revalidar as URLs antes do transplante, pois o relatório é uma fotografia temporal;
- entregar uma matriz de cobertura por rota, com clonada, adaptada, dependência externa ou não acessível.

O relatório não autoriza clonagem por si só: iniciar somente quando o usuário autorizar esta etapa. Não pesquisar novas ofertas, acionar extratores ou ampliar o escopo automaticamente durante a construção. Se uma rota pública relevante não estiver no mapa, registrar a divergência e pedir decisão apenas se ela alterar materialmente a esteira.

## Fluxo rápido obrigatório

### 1. Fazer o baseline HTTP sem navegador

Executar primeiro:

```bash
node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/http-snapshot.mjs \
  --url "URL_PUBLICA" \
  --out /caminho/do/projeto
```

O script deve salvar `reference-http.html`, `reference.http.json` e `reference.assets.json`. O inventário deve conter somente recursos observados no documento — imagens, fontes, CSS, mídia, ícones e iframes — e manter scripts separados dos assets visuais.

Classificar o retorno antes de abrir navegador:

- `document`: HTML/SSR completo ou suficientemente estrutural para transplantar;
- `shell`/`partial`: HTML sem conteúdo útil ou dependente de estado público adicional;
- `blocked`: 401, 403, 429, challenge ou falha de transporte;
- `unknown`: resposta não classificável.

Quando for `document`, seguir diretamente para a construção. Quando for `shell` ou `partial`, usar os bundles, JSON embutido, manifests e contratos públicos observados. Como fallback técnico, usar a coleta HTTP-only de `/Users/rodrigoservare/.codex/skills/modo-descoberta-extracao-publica/scripts/deep_public_extract.py` com limites rasos antes de considerar o navegador.

Não abrir navegador para descobrir se um GET público já entrega o documento. Essa verificação deve acontecer no terminal.

Para um site inteiro, o baseline da home não é suficiente. Executar:

```bash
node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/site-snapshot.mjs \
  --url "URL_PUBLICA" \
  --out /caminho/work/site-snapshot \
  --max-pages 2000 \
  --concurrency 32
```

O crawler deve seguir, no mesmo host, links `href`, `src`, `srcset`, `poster`, `data-src`, `iframe`, ações de formulário e referências `url()` em CSS; classificar respostas HTML, CSS, JavaScript, imagens, fontes, mídia e documentos; preservar query strings que mudem o conteúdo; deduplicar URLs; e salvar `reference.site.json` com páginas, recursos, erros, externos e exclusões. Aumentar `--max-pages` quando o inventário indicar catálogo, paginação ou páginas parametrizadas.

Por padrão, excluir áreas privadas, administrativas, login, checkout e rotas que exigem credencial. Registrar a exclusão e manter o link original ou um fallback explícito; não fingir que uma área restrita foi clonada. Não excluir páginas públicas só porque usam `.php`, query string, modal, PDF ou nome não amigável.

### 2. Escolher o modo de construção

Escolher `transplant` quando:

- o HTML/SSR ou o estado público reconstruído estiver disponível;
- CSS, fontes e assets puderem ser localizados;
- o estado observado puder funcionar sem o runtime proprietário da referência.

No modo `transplant`:

- copiar a estrutura recebida por HTTP;
- remover scripts de analytics, tracking e submissões externas da prévia local;
- reescrever URLs de assets para caminhos locais;
- manter o comportamento visual e interativo relevante.

Escolher `reconstruct` somente quando o transplante não for confiável. Nesse modo, usar o snapshot HTTP como especificação compacta e implementar diretamente a estrutura, sem criar uma versão aproximada por tentativa.

Para um quiz que entrega `__NEXT_DATA__`, um loader e bundles públicos, mas monta as perguntas via API pública observável, escolher `transplant-quiz-runtime.mjs`: preservar o shell, copiar os chunks e CSS do mesmo domínio, remover scripts de terceiros e manter o contrato público de fluxo para preservar as telas e interações do questionário.

### 3. Fazer um snapshot visual mínimo

Somente depois de montar a primeira versão local, abrir a referência no navegador persistente autorizado para uma coleta visual consolidada em cada viewport — preferencialmente `1280×720` e `390×844`.

Em cada viewport, coletar em uma única avaliação:

- URL, título, largura útil, altura total e largura do documento;
- seções e blocos principais com `top`, `height`, `width`, classe/ID e ordem;
- textos, imagens, vídeos, iframes, links, botões, formulários e atributos relevantes;
- `src`, `srcset`, `poster`, `currentSrc`, fontes carregadas e URLs de CSS;
- computed styles dos elementos críticos: fonte, peso, tamanho, line-height, cor, fundo, padding, margin, border, radius, shadow e display;
- breakpoints aparentes, colunas, elementos fixos e regras específicas para mobile;
- interações relevantes, incluindo âncoras, FAQ, menus, play/pause e estados de abertura;
- erros de console e recursos que falharam.

Salvar snapshots compactos no projeto, por exemplo `reference.snapshot.desktop.json` e `reference.snapshot.mobile.json`. Depois dessa coleta, consultar os snapshots em vez de reabrir e medir a mesma informação.

Percorrer a referência do topo ao rodapé no máximo uma vez por viewport para disparar lazy loading. Aguardar somente o necessário para estabilização; não usar o navegador para repetir coleta já resolvida pelo HTTP.

### 4. Extrair e baixar assets em paralelo

Construir um inventário deduplicado usando DOM, CSS e `performance.getEntriesByType('resource')`. Incluir imagens, fontes, vídeos, posters, ícones e folhas de estilo realmente usadas.

Executar:

```bash
node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/baixar-assets.mjs \
  --manifest reference.assets.json \
  --out assets \
  --concurrency 12
```

Reutilizar arquivos já presentes, usar nomes determinísticos e registrar o mapa URL → arquivo local. Não baixar o mesmo recurso várias vezes por causa de query strings ou referências repetidas.

Quando o snapshot for classificado como `document`, transplantar diretamente:

```bash
node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/transplant-html.mjs \
  --html reference-http.html \
  --manifest assets/asset-manifest.json \
  --out index.html \
  --app app.js
```

O transplante preserva a marcação e o CSS originais, aponta os recursos para `assets/` e remove scripts de terceiros; a camada local mantém apenas as interações essenciais observáveis.

Para quiz/runtime:

```bash
node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/transplant-quiz-runtime.mjs \
  --html reference-http.html \
  --source-url "URL_PUBLICA" \
  --out /caminho/do/projeto \
  --route "locale/rota-do-quiz" \
  --hydrate-flow
```

Com `--hydrate-flow`, o transplantador consulta o JSON público do fluxo, salva uma cópia local, identifica os `schema.slug`, `innerType`, tags de perguntas e rotas de e-mail usadas por ele, resolve os imports lazy pelo runtime Webpack e baixa somente os chunks, CSS e fontes necessários. Isso evita percorrer manualmente o quiz para descobrir recursos. `--hydrate-manifest` continua disponível como fallback amplo quando for necessário copiar o catálogo inteiro de rotas do build.

O runtime local mantém a mesma estrutura do app, carrega somente os recursos públicos do próprio domínio e deixa scripts de tracking/terceiros fora da prévia.

Para site inteiro, transplantar o inventário assim:

```bash
node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/transplant-site.mjs \
  --manifest /caminho/do/projeto/reference.site.json \
  --out /caminho/do/projeto
```

O transplantador deve gerar uma saída estática com `index.html`, uma página local para cada URL HTML descoberta, `assets/` deduplicado e `site-manifest.json`. Reescrever links internos para a página local equivalente, preservar fragmentos, query strings, âncoras e `srcset`, e reescrever URLs relativas dentro dos CSS a partir da localização real do CSS. Manter scripts públicos do próprio site quando forem necessários para navegação, menu, modal, FAQ ou formulário; remover somente tracking, analytics, captcha e integrações externas que não pertençam à prévia local, registrando iframes/mapas externos como dependências observadas.

Não considerar o site clonado porque `index.html` abre. Confirmar cobertura de todas as páginas do manifesto, existência de cada recurso local, ausência de links internos quebrados, sintaxe dos JavaScript locais e tratamento explícito dos arquivos não-HTML. Para sites grandes, validar visualmente cada template representativo e pelo menos uma página parametrizada, além da home em desktop e mobile.

Para vídeo, identificar em uma só coleta `currentSrc`, `<source>`, `poster`, duração e estado de reprodução. Reutilizar o player ou a mídia observada; não transcodificar nem baixar o arquivo inteiro sem necessidade para reproduzir o estado. Para HLS, iframe ou player proprietário, preservar a integração observável e registrar o fallback técnico concreto.

### 5. Montar imediatamente a primeira versão

Criar ou reutilizar o projeto local assim que o snapshot e o inventário mínimo estiverem disponíveis. Em projeto estático, preferir:

```text
index.html
styles.css
app.js
assets/
reference.snapshot.json
reference.assets.json
```

Servir a primeira versão antes de fazer polimento. Não gastar tempo escrevendo uma especificação longa; o snapshot mensurável é a especificação.

### 6. Rodar o gate automático rápido quando aplicável

Na calibração, em um diagnóstico ou quando solicitado pelo usuário, executar antes da comparação visual:

```bash
node /Users/rodrigoservare/.codex/skills/clonador-landing-pages/scripts/qa-static.mjs \
  --project /caminho/do/projeto
```

Corrigir primeiro arquivos ausentes, referências quebradas, viewport ausente e erros de sintaxe. Isso evita gastar uma rodada de navegador em uma página que ainda não carrega corretamente.

### 7. Comparar e corrigir por diferença quando houver QA

Abrir referência e cópia no mesmo viewport e comparar nesta ordem:

```text
estrutura → geometria → tipografia → cores → assets → sombras/bordas → animações → interações
```

Conferir primeiro altura total, início/fim das seções e boxes dos elementos críticos. Depois conferir aparência. Fazer correções por bloco de diferença — geometria, tipografia, mídia ou interação — e não reiniciar o mapeamento inteiro a cada ajuste.

Capturar screenshots por viewport e por blocos significativos. Se `fullPage` produzir artefato do navegador, usar capturas do viewport e blocos sobrepostos; não confundir falha da captura com falha da página.

Congelar ou esperar animações para medir geometria. Para vídeos, comparar poster/frame e comportamento do player separadamente, pois o frame em movimento não é uma diferença estrutural.

### 8. Validar e entregar no modo QA

Percorrer a cópia uma vez para confirmar lazy loading, links, âncoras, FAQ, estados interativos, ausência de overflow e console limpo. Executar `node --check app.js` quando houver JavaScript e uma requisição HTTP local.

Entregar primeiro:

- link da prévia local ou publicada, quando houver;
- links dos arquivos principais;
- resumo curto das substituições feitas;
- diferenças concretas restantes, somente se existirem.

## Regras de fidelidade

- Mapear uma vez antes de construir.
- Medir antes de opinar.
- Reutilizar a estrutura real antes de reescrever.
- Manter o layout da referência antes de otimizar código.
- Não confundir “mais bonito” com “mais fiel”.
- Não adicionar seções, benefícios, depoimentos, bônus ou componentes que não existam na referência.
- Não remover elementos apenas porque parecem desnecessários.
- Não trocar textos ou imagens sem instrução explícita, salvo placeholders técnicos necessários para a cópia.
- Desativar ações externas na prévia local quando elas enviarem dados ou criarem efeitos fora do projeto.
- Se uma diferença for causada por viewport, navegador, conteúdo dinâmico ou animação, reproduzir o estado observado e documentar a causa objetivamente.

## Não fazer

- Não abrir várias abas ou sessões descartáveis para a mesma referência.
- Não abrir navegador para a coleta inicial quando a URL for pública e o HTML puder ser obtido por HTTP.
- Não usar navegador como substituto de `fetch`, `curl` ou dos extratores HTTP existentes.
- Não reconsultar manualmente cada asset quando o inventário consolidado já o contém.
- Não capturar a página inteira repetidamente sem uma hipótese de diferença.
- Não refazer todas as seções após uma diferença localizada.
- Não iniciar pelo hero e deixar o restante para “depois” quando o DOM e o CSS da referência forem reutilizáveis.
- Não declarar uma cópia como visualmente validada sem executar o gate estático e a comparação desktop/mobile; no fluxo rápido, entregar explicitamente como transplante HTTP ainda não submetido ao modo QA.

## Resposta a solicitações típicas

Quando o usuário fornecer somente uma URL e disser “clone”, “modele”, “faça igual” ou “deixe idêntica”:

1. identificar se o escopo é uma página/fluxo ou o site público inteiro; se houver menu e rotas internas, não limitar a coleta à home;
2. executar o baseline HTTP antes do navegador;
3. para site inteiro, descobrir recursivamente as rotas públicas, incluindo páginas parametrizadas, PDFs e assets indiretos;
4. escolher transplante antes de reconstrução;
5. manter textos, assets e interações observadas;
6. criar ou usar um projeto local no diretório indicado pelo contexto;
7. executar o gate estrutural no conjunto de páginas e validar desktop/mobile quando estiver em calibração ou quando solicitado;
8. pedir decisão somente para credencial, ação externa relevante, dado indispensável ou substituição que não possa ser inferida com segurança.

Quando o usuário disser “mude apenas X”, tratar todo o restante como imutável e revalidar a geometria depois da mudança.
