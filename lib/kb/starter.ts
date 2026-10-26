import type { SourceInput } from "./ingest";

/**
 * Pacote inicial da base: rascunhos para o time fiscal e o marketing revisarem.
 *
 * Entram sem `reviewedBy` — o console mostra como "sem revisão" até alguém
 * conferir. Escritos sem números de alíquota e sem artigo específico: número
 * sai do cronograma (lib/tax/schedule.ts) e artigo, do texto da lei importado
 * do site oficial. Cada seção (##) vira um trecho da base.
 */

export interface StarterSource extends Omit<SourceInput, "text"> {
  description: string;
  text: string;
}

const FAQ = `# Perguntas frequentes sobre a Reforma Tributária

## O que é a Reforma Tributária do consumo?

É a mudança na forma como o Brasil tributa o consumo de bens e serviços, aprovada pela EC 132/2023 e regulamentada pela LC 214/2025. Cinco tributos atuais — PIS, Cofins, IPI, ICMS e ISS — dão lugar a um modelo de IVA dual: a CBS, federal, e o IBS, de estados e municípios, além do Imposto Seletivo. O objetivo é simplificar, acabar com o efeito cascata e dar mais transparência ao imposto pago.

## O que é a CBS?

A CBS (Contribuição Social sobre Bens e Serviços) é o tributo federal criado pela EC 132/2023 e regulamentado pela LC 214/2025. Ela substitui o PIS e a Cofins. É não cumulativa: o imposto pago nas etapas anteriores vira crédito para quem compra, e a cobrança acontece no destino, onde o bem ou serviço é consumido.

## O que é o IBS?

O IBS (Imposto sobre Bens e Serviços) é o imposto de competência compartilhada entre estados, Distrito Federal e municípios, criado pela EC 132/2023 e regulamentado pela LC 214/2025. Ele substitui o ICMS e o ISS. É administrado pelo Comitê Gestor do IBS, segue as mesmas regras gerais da CBS (base ampla, não cumulatividade e cobrança no destino) e tem legislação única para todo o país.

## O que é o Imposto Seletivo?

O Imposto Seletivo (IS) é um tributo federal criado pela EC 132/2023 e regulamentado pela LC 214/2025 que incide sobre bens e serviços prejudiciais à saúde ou ao meio ambiente. Ele não gera crédito e é cobrado uma única vez na cadeia. A lista do que é tributado está na LC 214/2025.

## Quais tributos deixam de existir?

Com a Reforma, PIS e Cofins são substituídos pela CBS; ICMS e ISS são substituídos pelo IBS; e o IPI tem as alíquotas reduzidas a zero, com exceção dos produtos que têm industrialização incentivada na Zona Franca de Manaus (EC 132/2023). A troca não é de uma vez: acontece ao longo de uma transição.

## Como funciona a transição?

A troca dos tributos é gradual (EC 132/2023). Primeiro vem um período de teste, com CBS e IBS cobrados em valores simbólicos para ajuste de sistemas. Depois a CBS passa a ser cobrada integralmente e PIS e Cofins são extintos. Em seguida, ICMS e ISS diminuem ano a ano enquanto o IBS aumenta, até o sistema novo valer por completo. As datas e percentuais de cada fase estão no cronograma oficial da Reforma.

## O que é não cumulatividade plena?

Significa que, em regra, todo IBS e toda CBS pagos na aquisição de bens e serviços usados na atividade da empresa geram crédito para abater do imposto devido, com exceções previstas na LC 214/2025, como bens de uso e consumo pessoal. É diferente do sistema atual, em que muitas aquisições não dão direito a crédito e o imposto se acumula na cadeia (efeito cascata).

## O que é o split payment?

É o recolhimento do IBS e da CBS no momento do pagamento da operação, previsto na LC 214/2025: quando o cliente paga, a parte do imposto é separada e enviada direto ao fisco pelo meio de pagamento. Isso reduz a sonegação e muda o fluxo de caixa das empresas, que deixam de ter o imposto disponível até a data do recolhimento.

## O que é o cashback?

É a devolução de parte do IBS e da CBS a famílias de baixa renda inscritas no CadÚnico, prevista na EC 132/2023 e regulamentada na LC 214/2025. O objetivo é reduzir o peso dos tributos sobre o consumo para quem ganha menos.

## O que é a Cesta Básica Nacional?

É a lista de alimentos com alíquota zero de IBS e CBS, criada pela EC 132/2023 e definida na LC 214/2025. Há também alimentos com redução de alíquota, fora da cesta.

## Existem setores com alíquota reduzida ou regime diferente?

Sim. A EC 132/2023 e a LC 214/2025 preveem reduções de alíquota para alguns setores — por exemplo, serviços de saúde, de educação e alguns produtos agropecuários — e regimes específicos para atividades como combustíveis, serviços financeiros, planos de saúde, operações com imóveis e cooperativas. As regras de cada caso estão na LC 214/2025; para enquadrar a sua empresa, o ideal é uma análise com especialista.

## Como fica o Simples Nacional?

As empresas do Simples Nacional continuam no regime, recolhendo IBS e CBS dentro da guia única (EC 132/2023). A LC 214/2025 permite que optem por recolher IBS e CBS por fora do Simples, pelo regime regular, o que permite transferir crédito integral aos clientes — uma decisão que vale analisar caso a caso, principalmente para quem vende para outras empresas.

## O que as empresas precisam fazer para se preparar?

Revisar cadastros e regras fiscais no ERP, preparar a emissão de documentos fiscais com os novos campos de IBS, CBS e Imposto Seletivo, entender o impacto do split payment no fluxo de caixa, revisar preços e contratos de longo prazo e mapear créditos. A transição exige que o sistema de gestão calcule e registre, ao mesmo tempo, os tributos antigos e os novos durante vários anos.
`;

const INVENT = `# Invent Software

## Quem é a Invent Software

A Invent Software é uma empresa brasileira de tecnologia fundada em 2010, especializada em soluções integradas de ERP e plataformas inteligentes para a gestão empresarial. Atende empresas de diferentes segmentos no Brasil e na América Latina, com soluções nos modelos On-Premise, WebClient e Cloud, focadas em automação, eficiência operacional, conformidade regulatória e apoio à decisão.

## Ecossistema SAP

As soluções da Invent nasceram no ecossistema do SAP Business One para otimizar e automatizar processos dentro do ERP, e estão evoluindo para o SAP Cloud ERP (antigo SAP S/4HANA Public Cloud).

## TaxPlus — gestão fiscal

O TaxPlus é a solução de gestão fiscal da Invent, parte da Suíte Fiscal e Compliance, voltada ao cumprimento, à consolidação e à transmissão automatizada das obrigações fiscais diretamente no ERP. Para saber como o TaxPlus apoia a sua empresa na adaptação à Reforma Tributária, fale com um especialista da Invent.

## BankPlus — gestão financeira

O BankPlus é a solução de gestão financeira da Invent, parte da Suíte Bancária e Financeira, que automatiza processos financeiros e bancários com segurança, flexibilidade e alta performance.

## ContractPlus — gestão de contratos

O ContractPlus é a solução da Invent para a gestão completa do ciclo de vida dos contratos diretamente no ERP.

## RHello — departamento pessoal e RH

O RHello é a plataforma de Recursos Humanos da Invent, uma solução HR Tech que automatiza o cálculo da folha de pagamento, reduz custos e aumenta a produtividade do departamento pessoal.

## Comex — comércio exterior

O Comex é a solução fiscal da Invent para empresas que importam: simplifica e automatiza processos de comércio exterior, assegurando a conformidade com as exigências legais.

## Outras plataformas

A Invent também oferece uma Plataforma de Business Intelligence, para análise de dados e geração de informações estratégicas para a liderança, e uma Plataforma de Agentes Inteligentes, com robôs e automações que otimizam rotinas operacionais.

## Onde a Invent está

A sede principal fica em Goiânia, com escritórios em Brasília, Joinville e São Paulo. Em Brasília ficam um escritório da Invent e a sede da Plataforma de Business Intelligence; em Joinville, a sede da Plataforma de Recursos Humanos. A empresa tem colaboradores em todo o território nacional.

## Valores

A cultura da Invent se apoia em cinco valores: Empatia, Crescimento, Performance, Persistência e Comprometimento.
`;

export const STARTER_SOURCES: StarterSource[] = [
  {
    slug: "faq-reforma-invent",
    title: "Perguntas frequentes sobre a Reforma Tributária (rascunho Invent)",
    citationLabel: "FAQ Invent",
    kind: "faq",
    authority: "invent",
    shape: "markdown",
    publisher: "Invent Software",
    version: "rascunho inicial — revisar com o time fiscal",
    description:
      "Explicações em linguagem simples (CBS, IBS, Imposto Seletivo, transição, split payment, Simples Nacional), sem números: alíquotas e datas vêm do cronograma.",
    text: FAQ,
  },
  {
    slug: "invent-institucional",
    title: "Invent Software — institucional e soluções",
    citationLabel: "Invent Software",
    kind: "material_invent",
    authority: "invent",
    shape: "markdown",
    publisher: "Invent Software",
    version: "rascunho inicial — revisar com marketing",
    description:
      "Quem é a Invent, ecossistema SAP e o que fazem TaxPlus, BankPlus, ContractPlus, RHello e Comex.",
    text: INVENT,
  },
];

export function starterSource(slug: string): StarterSource | undefined {
  return STARTER_SOURCES.find((source) => source.slug === slug);
}
