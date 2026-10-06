/**
 * Limite de tempo para chamadas externas no caminho do login.
 *
 * Banco ou Supabase Auth que aceitam a conexão e nunca respondem deixam a
 * página "carregando" até a Vercel matar a função (minutos). Com limite, a
 * pessoa vê em segundos uma tela que diz o que conferir.
 */
export class TimeoutError extends Error {
  readonly code: string;

  constructor(label: string, ms: number) {
    super(`${label} não respondeu em ${Math.round(ms / 1000)} segundos`);
    this.name = "TimeoutError";
    this.code = `TIMEOUT_${label.toUpperCase()}`;
  }
}

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}
