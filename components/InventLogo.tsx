/**
 * Logo oficial da Invent Software (arquivos em public/brand): assinatura
 * positiva em fundo claro, negativa em fundo escuro. Nunca recriar o logo.
 */
export function InventLogo({
  className,
  height = 32,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <picture>
      <source srcSet="/brand/invent-negativo.png" media="(prefers-color-scheme: dark)" />
      <img
        className={className}
        src="/brand/invent-positivo.png"
        alt="Invent Software"
        style={{ height, width: "auto", display: "block" }}
      />
    </picture>
  );
}
