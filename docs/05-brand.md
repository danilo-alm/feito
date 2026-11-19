# Marca

Identidade visual do Feito. Os arquivos ficam em [`docs/brand/`](brand/): SVGs em `svg/` e o guia completo em `pdf/`.

- [Guia de marca](brand/pdf/guia-de-marca.pdf): paleta, tipografia, área de respiro e usos incorretos
- [Versões do logo](brand/pdf/logo-versoes.pdf)
- [Favicon e ícone do app](brand/pdf/favicon-e-icone.pdf)

## 1. Símbolo

O símbolo se chama **Visto-F**. Um visto sobe e vira a haste inclinada de um F, então concluir uma tarefa e o nome do app ficam no mesmo traço. Ele é desenhado com dois traços de 3,4 a cada 32 unidades, com pontas e juntas arredondadas.

O nome é escrito com maiúscula, porque o F do símbolo precisa ecoar no F de "Feito".

## 2. Arquivos

| Arquivo | Uso |
| --- | --- |
| `feito-horizontal.svg` | Símbolo e nome sobre fundo claro. É o uso principal. |
| `feito-horizontal-dark.svg` | Símbolo e nome sobre fundo escuro. |
| `feito-horizontal-ink.svg`, `-paper.svg` | Versão monocromática: tinta sobre fundo claro e papel sobre fundo escuro. |
| `feito-mark.svg` | Só o símbolo, sobre fundo claro. |
| `feito-mark-dark.svg` | Só o símbolo, sobre fundo escuro. |
| `feito-mark-ink.svg`, `-paper.svg` | Símbolo monocromático. |
| `feito-mark-currentcolor.svg` | Símbolo que herda a cor do texto. Use quando ele for embutido na interface. |
| `feito-mark-16.svg` | Desenho próprio para 16 px, com traço mais grosso. Use abaixo de 24 px. |
| `favicon.svg` | Favicon de 16 e 32 px: símbolo em papel sobre placa verde. |
| `app-icon-512.svg` | Ícone do app e do PWA, com cantos de raio 112. |
| `app-icon-512-maskable.svg` | Ícone `maskable` do PWA, sem cantos, porque o sistema recorta a forma. |

Os SVGs horizontais escrevem o nome com `<text>` em Inter Tight. Eles aparecem certos no navegador quando a fonte está disponível. Para impressão, imagem ou qualquer uso fora do app, converta o texto em contornos antes.

## 3. Cores

Os tons são os da interface (`src/app/globals.css`). A marca não usa nenhuma cor nova.

| Nome | Hex | Papel |
| --- | --- | --- |
| Verde Feito | `#1E5B45` | Símbolo em fundo claro e placa dos ícones. Contraste de 7,2:1 sobre o papel. |
| Verde claro | `#8CD1AB` | Símbolo e texto de marca em fundo escuro. Contraste de 9,8:1 sobre a noite. |
| Verde noite | `#2F7D5A` | Botões no modo escuro. Não é cor do símbolo. |
| Papel | `#F6F4EF` | Fundo claro e símbolo sobre a placa verde. |
| Tinta | `#2A2926` | Nome em fundo claro e versão monocromática. |
| Noite | `#1B1A18` | Fundo escuro. Sobre ele, o nome usa `#EDE9E2`. |

Vermelho, âmbar e azul são cores de prioridade e não aparecem na marca.

## 4. Tipografia

- **Inter Tight Semibold:** nome e títulos grandes, com espaçamento de −2%.
- **Inter:** toda a interface. Já é carregada pelo app.

## 5. Regras de uso

- **Área de respiro:** em volta do logo fica uma margem igual a x, o comprimento do braço de cima do F (cerca de um terço da altura do símbolo).
- **Tamanho mínimo:** 16 px para o símbolo e 20 px de altura para a versão horizontal.
- Não use cores de prioridade no logo.
- Não coloque o símbolo dentro de um círculo ou de outra moldura. A única placa permitida é a dos ícones.
- Não use o verde `#1E5B45` sobre fundo escuro. No escuro, o símbolo é `#8CD1AB`.
