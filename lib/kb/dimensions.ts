/**
 * Tamanho do vetor de embedding — compartilhado entre o schema do banco e a
 * chamada ao provedor.
 *
 * 1536 porque: o gemini-embedding-2 aceita esse tamanho (o padrão dele é 3072),
 * o text-embedding-3-small da OpenAI gera exatamente isso, e o índice HNSW do
 * pgvector só aceita até 2000 dimensões. Trocar este número exige migration em
 * kb_chunks.embedding e reingestão da base inteira.
 */
export const EMBEDDING_DIMENSIONS = 1536;
