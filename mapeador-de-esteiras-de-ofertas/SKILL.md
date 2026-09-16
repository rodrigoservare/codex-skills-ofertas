---
name: mapeador-de-esteiras-de-ofertas
description: "Audita e mapeia a superfície pública de ofertas digitais antes de qualquer clonagem ou construção, com enriquecimento externo orientado quando necessário: landing pages, rotas, links, parâmetros, redirecionamentos, bundles, assets, formulários, checkouts, produtos, planos, bônus, order bumps, upsells, downsells, páginas de obrigado, áreas de acesso, políticas, scripts, rastreamento e sequência do funil. Use quando o usuário pedir para descobrir, investigar, mapear, auditar ou documentar uma oferta, funil ou esteira a partir de uma URL pública."
---

# Mapeador de Esteiras de Ofertas

## Objetivo

Mapear o que está publicamente acessível em uma oferta digital e transformar evidência dispersa em um inventário acionável e um mapa visual da esteira. Parar no relatório: não clonar, construir, publicar, comprar ou alterar qualquer peça sem autorização explícita para a etapa seguinte.

## Regra de fases

Executar sempre nesta ordem:

1. **Descobrir:** encontrar a oferta e confirmar que a URL responde.
2. **Mapear:** explorar páginas, recursos, destinos externos e configurações públicas.
3. **Consolidar:** classificar produtos, planos, bônus, bumps, upsells, downsells, páginas e sequência.
4. **Entregar:** criar o relatório, mostrar o resultado e aguardar autorização.

Tratar o relatório como um checkpoint humano. Uma autorização para auditar não autoriza clonagem, construção, checkout, publicação, compra ou contato externo.

## Preparação

1. Identificar a URL principal, o nome da oferta e o objetivo do usuário.
2. Criar uma pasta de trabalho isolada, por exemplo `work/<slug>-oferta-audit/`, e reservar `outputs/<slug>-auditoria-publica.md` para o relatório final.
3. Ler integralmente a skill `clonador-landing-pages` e reutilizar seus scripts HTTP-first `site-snapshot.mjs` e `http-snapshot.mjs`. Localizar a skill pelo catálogo ativo se o caminho variar.
4. Registrar data, URL inicial e escopo. Não solicitar credenciais; não inserir dados pessoais ou de pagamento.

## 1. Descobrir a superfície inicial

Executar um snapshot recursivo da URL inicial com cache desabilitado e concorrência adequada. Capturar:

- páginas HTML e rotas alcançadas por links;
- status HTTP, URL final e redirecionamentos;
- scripts, folhas de estilo, imagens, áudio, vídeo, iframes e fontes;
- links internos e externos;
- erros, páginas duplicadas e recursos que falharam.

Usar também o snapshot HTTP simples da URL inicial para comparar o documento entregue pelo servidor com o resultado recursivo. Extrair o texto visível sem interpretar ainda a promessa comercial.

## 2. Descobrir rotas e destinos adicionais

Não depender apenas de links HTML. Examinar bundles e fontes capturadas procurando:

- URLs absolutas;
- caminhos de rota;
- IDs de checkout ou produto;
- chamadas a APIs públicas;
- parâmetros de query, fragmentos e redirecionamentos;
- nomes como `upsell`, `downsell`, `thank`, `success`, `obrigado`, `acesso`, `login`, `oferta` e `checkout`.

Seguir cada destino externo de primeira ordem, especialmente domínios de checkout, app, vídeo, área de acesso e páginas de confirmação. Aplicar a mesma descoberta recursiva a cada domínio relevante, mantendo a origem do link.

Testar, de forma limitada e documentada, endpoints convencionais que ajudam a delimitar a superfície pública: `robots.txt`, `sitemap.xml`, `sitemap_index.xml`, `manifest.json`, `security.txt`, `/.well-known/security.txt` e poucas rotas comuns coerentes com os bundles. Não fazer enumeração massiva ou varredura agressiva.

Classificar uma rota como **encontrada**, **404**, **redirecionada**, **não alcançada** ou **não testada**. “Não encontrada” não significa que uma área privada não exista.

## 2.1 Enriquecimento externo adaptativo (opcional)

O mapeamento HTTP é o núcleo e vem primeiro. Só abrir uma investigação externa quando houver uma pergunta concreta que possa alterar a leitura da oferta, a priorização ou o próximo passo. Exemplos:

- confirmar se a oferta também aparece na Biblioteca de Anúncios ou no Google Ads Transparency;
- entender a linguagem e as buscas adjacentes do público com Autocomplete, Search ou Trends;
- verificar consumo de conteúdo relacionado em YouTube e Google Videos;
- encontrar objeções e frustrações em Reddit, Quora, avaliações ou reclamações;
- comparar preços e alternativas em Shopping, Amazon, Mercado Livre ou Shopee;
- investigar uma categoria vertical, como app, software, serviço local ou produto físico.

Aplicar a lógica do `orquestrador-pesquisa`: formular a pergunta, escolher a fonte que mede diretamente o sinal, acrescentar uma fonte independente somente se necessário e parar quando a resposta não puder mais alterar o relatório. Não executar todos os extratores nem repetir uma entrevista já resolvida pela missão desta skill.

Manter duas camadas separadas no relatório:

- **Superfície da oferta:** rotas, configuração pública, produtos, sequência e infraestrutura observados no domínio.
- **Contexto externo:** anúncios, buscas, conteúdo, voz do consumidor, preço ou riscos encontrados fora do domínio.

Contexto externo pode corroborar ou desafiar uma interpretação; não substitui a evidência HTTP e não transforma ausência pública em inexistência.

## 3. Auditar checkouts e SPAs

Para cada checkout público:

1. Capturar o HTML, status, URL final, título, campos e texto renderizado no servidor.
2. Identificar se é SPA/shell. Se for, baixar ou examinar os bundles e localizar a chamada de configuração pública.
3. Consultar somente endpoints sem autenticação descobertos no próprio documento ou bundle. Registrar método, URL, status e campos relevantes; não enviar pagamento, dados pessoais ou dados fictícios em formulários.
4. Extrair nome, preço, moeda, tipo, recorrência, métodos de pagamento, parcelamento, bumps, `upsellPage`, `thankPage`, redirecionamentos e configurações de rastreamento quando forem públicos.
5. Comparar o que a página promete com o que os metadados configuram. Registrar divergências literalmente e como **inconsistência**, sem escolher silenciosamente uma versão.

Para páginas de app, pós-compra ou vídeo, verificar se a página é realmente área de acesso ou somente uma nova oferta. Procurar login, token, gate, download, biblioteca, player protegido e CTA de compra. Se não houver evidência de entrega, escrever “área de acesso não exposta publicamente”.

## 4. Classificar a esteira

Usar as categorias abaixo e registrar evidência e origem para cada item:

- **Landing:** página de entrada, promessa, CTA e prova social.
- **Produto principal:** nome, quantidade, formato, entrega, preço cheio e preço promocional.
- **Plano/variação:** básico, premium, mensal, anual, pagamento único ou recorrente.
- **Bônus:** conteúdo adicional apresentado junto ao plano, com valor e condição.
- **Order bump:** oferta adicional no checkout antes do pagamento.
- **Upsell:** oferta posterior de maior valor, assinatura ou complemento.
- **Downsell:** oferta posterior reduzida ou de última chance.
- **Checkout:** plataforma, URL, campos, pagamentos, política e configuração pública.
- **Obrigado/pós-compra:** mensagem e destino configurados após aprovação.
- **Acesso/entrega:** e-mail, WhatsApp, download, app, área privada ou player.
- **Tracking e infraestrutura:** scripts, pixels, analytics, CDN, iframes e APIs públicas.

Marcar cada afirmação como uma destas evidências:

- **Confirmado na página:** texto ou elemento visível.
- **Confirmado na configuração:** estado público/API/bundle, mesmo que não apareça na página.
- **Inferência operacional:** conclusão razoável derivada de várias evidências; rotular como inferência.
- **Não encontrado:** procurado no escopo e ausente.
- **Não testado:** dependeria de compra, login, autorização ou estado privado.

## 5. Construir o relatório

Usar `references/relatorio-publico.md` como estrutura mínima. O relatório deve conter:

1. cabeçalho com referência, data, escopo e status;
2. conclusão executiva com a contagem da esteira;
3. mapa Mermaid da sequência e das ramificações;
4. inventário de rotas, domínios, checkouts e status;
5. produtos, planos, bônus e order bumps com preços;
6. pós-compra, upsells, downsells e destinos configurados;
7. formulários, métodos de pagamento, políticas, páginas de obrigado e acesso;
8. scripts, assets, iframes, APIs públicas e rastreamento;
9. enriquecimento externo acionado, perguntas respondidas e fontes usadas, separado da auditoria do domínio;
10. inconsistências e decisões que não devem ser assumidas;
11. superfície não pública ou não testada;
12. conclusão da etapa e gate para autorização da próxima fase.

Preservar URLs públicas clicáveis e valores exatamente como foram observados. Somar valores apenas quando isso ajudar a leitura, identificando a soma como cálculo derivado. Não transformar prova social, garantia, escassez ou descrição comercial em fato validado independentemente.

## 6. Entregar e parar

Salvar o relatório somente em `outputs/` do workspace atual, usando um slug claro. Validar que o arquivo existe e contém o mapa, a tabela de rotas, os itens da esteira e a seção de limites.

Na resposta final:

- informar que a auditoria foi concluída;
- destacar as descobertas estruturais mais relevantes;
- linkar o relatório local;
- declarar explicitamente que nenhuma clonagem ou construção foi iniciada;
- pedir autorização para a próxima etapa, se o usuário quiser prosseguir.

## Limites operacionais

- Preferir HTTP e APIs públicas antes de navegador.
- Usar navegador somente quando o HTML/runtime não expuser um estado necessário; nesse caso, ler a skill de controle de navegador vigente e usar a sessão autorizada. Não contornar CAPTCHA, login, paywall ou autenticação.
- Não fazer compra, não preencher CPF, e-mail, telefone ou cartão e não disparar mensagens externas.
- Não copiar credenciais, tokens, cookies ou dados pessoais para relatório, prompt ou arquivo.
- Não publicar, alterar DNS, criar checkout, criar produto ou clonar páginas nesta skill.
- Não declarar “completo” quando o resultado depende de pós-pagamento, conta privada ou autorização inexistente; documentar precisamente o limite.
