# Estrutura do relatório público

Usar esta estrutura como checklist ao consolidar uma auditoria. Adaptar se uma seção não fizer sentido, mas registrar o motivo.

## Cabeçalho

- Oferta e URL inicial
- Data e escopo da captura
- Status da auditoria
- Limite: público/sem pagamento/sem login

## Conclusão executiva

- Quantidade de domínios, rotas e checkouts encontrados
- Quantidade de produtos, planos, bumps, upsells e downsells
- Descoberta estrutural mais relevante

## Mapa da esteira

Usar Mermaid para mostrar a entrada, os planos, os caminhos pós-compra e as ramificações. Diferenciar fluxo confirmado de destino apenas configurado.

## Inventário público

| URL | Papel | Evidência | Status |
|---|---|---|---|
| URL pública | Função observada | Página/configuração/API | HTTP ou limite |

## Oferta e monetização

### Produtos principais

| Produto | Plano | Preço | Entrega | Evidência |
|---|---|---:|---|---|

### Bônus

| Bônus | Valor exibido | Vinculação ao plano | Evidência |
|---|---:|---|---|

### Order bumps

| Bump | Preço cheio | Preço ofertado | Checkout |
|---|---:|---:|---|

### Upsells e downsells

Descrever a condição de entrada, o CTA, o preço, o checkout e o próximo destino configurado.

## Checkout e pós-compra

Registrar campos, métodos de pagamento, parcelamento, políticas, mensagem de obrigado, `upsellPage`, bumps e redirecionamentos. Separar estado público de comportamento testado após pagamento.

## Rotas, assets e infraestrutura

Registrar rotas internas, parâmetros, links externos, scripts, pixels, analytics, iframes, players, CDN, APIs públicas e recursos relevantes.

## Enriquecimento externo (se acionado)

Registrar separadamente do inventário do domínio:

| Pergunta | Extrator/superfície | Resultado observado | Sustenta ou desafia | Data |
|---|---|---|---|---|
|  |  |  |  |  |

Incluir também as fontes não acionadas quando a ausência delas limitar uma decisão importante. Não usar contexto externo para substituir uma evidência da página ou da configuração pública.

## Inconsistências

Listar divergências entre copy, página, bundle e API. Não corrigir silenciosamente nem escolher qual versão é verdadeira.

## Não encontrado ou não testado

Separar 404/ausência observada de estados que exigiriam login, compra, e-mail, token ou autorização.

## Gate

Concluir com: “Auditoria pública concluída. Nenhuma clonagem ou construção foi executada. Próxima etapa depende de autorização explícita.”
